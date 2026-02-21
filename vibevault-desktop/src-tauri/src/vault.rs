use tauri::State;
use rusqlite::params;
use uuid::Uuid;

use crate::AppState;
use crate::auth::{validate_session, get_db_and_session};
use crate::crypto::{encrypt_aes256_gcm, decrypt_aes256_gcm};
use crate::db::DatabaseManager;

/// Migrate plaintext entries to encrypted (called after unlock)
pub fn migrate_plaintext_entries(db: &DatabaseManager, key: &[u8; 32]) -> Result<(), String> {
    let mut stmt = db
        .conn
        .prepare("SELECT id, data_blob, nonce FROM vault_entries WHERE length(nonce) = 0")
        .map_err(|e| e.to_string())?;

    let rows: Vec<(i64, Vec<u8>, Vec<u8>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (id, plaintext_blob, _nonce) in rows {
        let (ciphertext, new_nonce) = encrypt_aes256_gcm(key, &plaintext_blob)?;
        db.conn
            .execute(
                "UPDATE vault_entries SET data_blob = ?1, nonce = ?2 WHERE id = ?3",
                params![ciphertext, new_nonce, id],
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn get_all_vault_entries(
    state: State<AppState>,
    token: String,
) -> Result<Vec<serde_json::Value>, String> {
    let (db_guard, key, active_profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    let mut stmt = db
        .conn
        .prepare(
            "SELECT id, uuid, data_blob, nonce, entry_uuid FROM vault_entries
             WHERE profile_id = ?1 AND deleted_at IS NULL",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![active_profile], |row| {
            let id: i64 = row.get(0)?;
            let uuid: String = row.get(1)?;
            let blob: Vec<u8> = row.get(2)?;
            let nonce: Vec<u8> = row.get(3)?;
            let entry_uuid: Option<String> = row.get(4)?;
            Ok((id, uuid, blob, nonce, entry_uuid))
        })
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        let (id, uuid, blob, nonce, entry_uuid) = row.map_err(|e| e.to_string())?;

        // Decrypt: empty nonce = legacy plaintext fallback
        let plaintext = if nonce.is_empty() {
            blob
        } else {
            decrypt_aes256_gcm(&key, &blob, &nonce)?
        };

        entries.push(serde_json::json!({
            "id": id,
            "uuid": uuid,
            "data_blob": plaintext,
            "entry_uuid": entry_uuid
        }));
    }
    Ok(entries)
}

#[tauri::command]
pub fn save_entry(
    state: State<AppState>,
    token: String,
    uuid: String,
    blob: Vec<u8>,
    profile_id: Option<i64>,
) -> Result<String, String> {
    let (db_guard, key, active_profile) = get_db_and_session(&state, &token)?;
    let target_profile = profile_id.unwrap_or(active_profile);
    let db = db_guard.as_ref().unwrap();

    let (ciphertext, nonce) = encrypt_aes256_gcm(&key, &blob)?;
    let entry_uuid = Uuid::new_v4().to_string();
    let now = now_iso();

    db.conn
        .execute(
            "INSERT INTO vault_entries (uuid, data_blob, nonce, profile_id, entry_uuid, created_at, updated_at, sync_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)",
            params![uuid, ciphertext, nonce, target_profile, entry_uuid, now, now],
        )
        .map_err(|e| e.to_string())?;

    Ok("Saved".to_string())
}

#[tauri::command]
pub fn update_entry(
    state: State<AppState>,
    token: String,
    id: i64,
    uuid: String,
    blob: Vec<u8>,
) -> Result<String, String> {
    let (db_guard, key, active_profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    let (ciphertext, nonce) = encrypt_aes256_gcm(&key, &blob)?;
    let now = now_iso();

    // Update entry, bump sync_version, update timestamp
    let rows_updated = db
        .conn
        .execute(
            "UPDATE vault_entries
             SET uuid = ?1, data_blob = ?2, nonce = ?3, updated_at = ?4, sync_version = sync_version + 1
             WHERE id = ?5 AND profile_id = ?6 AND deleted_at IS NULL",
            params![uuid, ciphertext, nonce, now, id, active_profile],
        )
        .map_err(|e| e.to_string())?;

    if rows_updated == 0 {
        return Err("Entry not found or belongs to different profile".to_string());
    }

    Ok("Updated".to_string())
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, token: String, id: i64) -> Result<String, String> {
    let (db_guard, _key, active_profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    let now = now_iso();

    // Soft delete: set deleted_at timestamp instead of removing the row
    let rows_updated = db
        .conn
        .execute(
            "UPDATE vault_entries
             SET deleted_at = ?1, updated_at = ?1, sync_version = sync_version + 1
             WHERE id = ?2 AND profile_id = ?3 AND deleted_at IS NULL",
            params![now, id, active_profile],
        )
        .map_err(|e| e.to_string())?;

    if rows_updated == 0 {
        return Err("Entry not found or belongs to different profile".to_string());
    }

    Ok("Deleted".to_string())
}

#[tauri::command]
pub fn get_totp_token(
    state: State<AppState>,
    token: String,
    secret: String,
) -> Result<String, String> {
    validate_session(&state, &token)?;
    let clean_secret = secret.replace(" ", "").replace("=", "").to_uppercase();
    let secret_bytes =
        base32::decode(base32::Alphabet::RFC4648 { padding: false }, &clean_secret)
            .ok_or("Invalid Base32 Secret")?;

    let totp =
        totp_rs::TOTP::new_unchecked(totp_rs::Algorithm::SHA1, 6, 1, 30, secret_bytes);
    Ok(totp.generate_current().map_err(|e| e.to_string())?)
}
