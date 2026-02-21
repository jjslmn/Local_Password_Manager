#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{State, Manager};
use std::sync::{Mutex, Arc};
use rusqlite::{params, Connection};
use totp_rs::{Algorithm, TOTP};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2
};
use rand::RngCore;
use std::time::{Duration, Instant};
use zeroize::Zeroize;
use base64::{Engine as _, engine::general_purpose};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};

// --- DATABASE MANAGER ---
struct DatabaseManager {
    conn: Connection,
}

impl DatabaseManager {
    fn new(app_handle: &tauri::AppHandle) -> Self {
        let app_dir = app_handle.path().app_data_dir().expect("Failed to get app data dir");
        std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
        let db_path = app_dir.join("vibevault.db");

        let conn = Connection::open(db_path).expect("Failed to open DB");

        // 1. Create Users Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL
            )",
            [],
        ).expect("Failed to create users table");

        // 1b. Migration: Add encryption_salt column if missing
        let has_enc_salt: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='encryption_salt'",
            [],
            |row| row.get::<_, i64>(0).map(|c| c > 0),
        ).unwrap_or(false);

        if !has_enc_salt {
            conn.execute(
                "ALTER TABLE users ADD COLUMN encryption_salt TEXT NOT NULL DEFAULT ''",
                [],
            ).expect("Failed to add encryption_salt column");
        }

        // 2. Create Profiles Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        ).expect("Failed to create profiles table");

        // 3. Insert default 'Personal' profile if profiles table is empty
        let profile_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM profiles",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        if profile_count == 0 {
            conn.execute(
                "INSERT INTO profiles (name) VALUES ('Personal')",
                [],
            ).expect("Failed to create default profile");
        }

        // 4. Create Vault Table (with profile_id if new, or migrate if existing)
        // Check if vault_entries table exists
        let table_exists: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vault_entries'",
            [],
            |row| row.get::<_, i64>(0).map(|c| c > 0),
        ).unwrap_or(false);

        if !table_exists {
            // Create new table with profile_id
            conn.execute(
                "CREATE TABLE vault_entries (
                    id INTEGER PRIMARY KEY,
                    uuid TEXT NOT NULL,
                    data_blob BLOB NOT NULL,
                    nonce BLOB NOT NULL,
                    profile_id INTEGER NOT NULL DEFAULT 1,
                    FOREIGN KEY (profile_id) REFERENCES profiles(id)
                )",
                [],
            ).expect("Failed to create vault table");
        } else {
            // Check if profile_id column exists
            let has_profile_id: bool = conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('vault_entries') WHERE name='profile_id'",
                [],
                |row| row.get::<_, i64>(0).map(|c| c > 0),
            ).unwrap_or(false);

            if !has_profile_id {
                // Migration: Add profile_id column to existing table
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1",
                    [],
                ).expect("Failed to add profile_id column");

                // All existing entries are now assigned to default profile (id=1)
            }
        }

        DatabaseManager { conn }
    }
}

// --- SESSION STATE ---
struct SessionState {
    token: String,
    encryption_key: [u8; 32],
}

impl Drop for SessionState {
    fn drop(&mut self) {
        self.encryption_key.zeroize();
        self.token.zeroize();
    }
}

// --- APP STATE ---
struct AppState {
    db: Arc<Mutex<Option<DatabaseManager>>>,
    active_profile_id: Arc<Mutex<i64>>,
    session: Arc<Mutex<Option<SessionState>>>,
    failed_attempts: Arc<Mutex<(u32, Option<Instant>)>>,
}

// --- HELPERS ---

/// Validate session token and return the encryption key
fn validate_session(state: &State<AppState>, token: &str) -> Result<[u8; 32], String> {
    let session_guard = state.session.lock().map_err(|_| "Lock failed")?;
    let session = session_guard.as_ref().ok_or("Session expired. Please log in again.")?;

    // Constant-time comparison to prevent timing attacks
    if token.len() != session.token.len() {
        return Err("Session expired. Please log in again.".to_string());
    }
    let mut diff = 0u8;
    for (a, b) in token.bytes().zip(session.token.bytes()) {
        diff |= a ^ b;
    }
    if diff != 0 {
        return Err("Session expired. Please log in again.".to_string());
    }

    Ok(session.encryption_key)
}

/// Encrypt data with AES-256-GCM, returns (ciphertext, nonce)
fn encrypt_blob(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Encryption init failed")?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext)
        .map_err(|_| "Encryption failed")?;
    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypt data with AES-256-GCM
fn decrypt_blob(key: &[u8; 32], ciphertext: &[u8], nonce_bytes: &[u8]) -> Result<Vec<u8>, String> {
    if nonce_bytes.len() != 12 {
        return Err("Invalid nonce length".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Decryption init failed")?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — wrong password or corrupted data".to_string())
}

/// Migrate plaintext entries to encrypted (called after unlock)
fn migrate_plaintext_entries(db: &DatabaseManager, key: &[u8; 32]) -> Result<(), String> {
    let mut stmt = db.conn.prepare(
        "SELECT id, data_blob, nonce FROM vault_entries WHERE length(nonce) = 0"
    ).map_err(|e| e.to_string())?;

    let rows: Vec<(i64, Vec<u8>, Vec<u8>)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    for (id, plaintext_blob, _nonce) in rows {
        let (ciphertext, new_nonce) = encrypt_blob(key, &plaintext_blob)?;
        db.conn.execute(
            "UPDATE vault_entries SET data_blob = ?1, nonce = ?2 WHERE id = ?3",
            params![ciphertext, new_nonce, id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// --- USER MANAGEMENT COMMANDS ---

#[tauri::command]
fn check_registration_status(state: State<AppState>) -> Result<bool, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // Check if any user exists
    let count: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM users",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(count > 0)
}

#[tauri::command]
fn register_user(state: State<AppState>, username: String, pass: String) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // 1. Generate clean salt for password hashing
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt_str = general_purpose::STANDARD.encode(salt_bytes).replace("=", "");

    // 2. Hash Password
    let salt = SaltString::from_b64(&salt_str).map_err(|_| "Salt Error")?;
    let argon2 = Argon2::default();
    let password_hash = argon2.hash_password(pass.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    // 3. Generate encryption salt (separate from auth salt)
    let mut enc_salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut enc_salt_bytes);
    let enc_salt_hex = hex::encode(enc_salt_bytes);

    // 4. Save User
    db.conn.execute(
        "INSERT INTO users (username, password_hash, salt, encryption_salt) VALUES (?1, ?2, ?3, ?4)",
        params![username, password_hash, salt_str, enc_salt_hex],
    ).map_err(|_| "Registration failed")?;

    Ok("User registered".to_string())
}

#[tauri::command]
fn unlock_vault(state: State<AppState>, username: String, pass: String) -> Result<String, String> {
    // Brute-force protection: enforce delay after repeated failures
    {
        let guard = state.failed_attempts.lock().map_err(|_| "Lock failed")?;
        let (attempts, last_failed) = &*guard;
        if *attempts >= 3 {
            if let Some(last) = last_failed {
                // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
                let delay = Duration::from_secs(1u64 << (*attempts - 3).min(4));
                if last.elapsed() < delay {
                    let remaining = (delay - last.elapsed()).as_secs() + 1;
                    return Err(format!("Too many failed attempts. Wait {} seconds.", remaining));
                }
            }
        }
    }

    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // Authenticate — use closure to consolidate failure handling
    let auth_result: Result<String, String> = (|| {
        let (hash, enc_salt_hex): (String, String) = db.conn.query_row(
            "SELECT password_hash, encryption_salt FROM users WHERE username = ?1",
            params![username],
            |row| Ok((row.get(0)?, row.get::<_, String>(1)?)),
        ).map_err(|_| "Invalid username or password".to_string())?;

        let parsed_hash = PasswordHash::new(&hash)
            .map_err(|_| "Invalid username or password".to_string())?;
        Argon2::default().verify_password(pass.as_bytes(), &parsed_hash)
            .map_err(|_| "Invalid username or password".to_string())?;

        Ok(enc_salt_hex)
    })();

    let enc_salt_hex = match auth_result {
        Ok(salt) => {
            // Reset failed attempts on success
            let mut guard = state.failed_attempts.lock().map_err(|_| "Lock failed")?;
            *guard = (0, None);
            salt
        }
        Err(e) => {
            // Record failed attempt
            let mut guard = state.failed_attempts.lock().map_err(|_| "Lock failed")?;
            guard.0 += 1;
            guard.1 = Some(Instant::now());
            return Err(e);
        }
    };

    // Handle existing users who don't have an encryption_salt yet
    let enc_salt_hex = if enc_salt_hex.is_empty() {
        let mut enc_salt_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut enc_salt_bytes);
        let new_hex = hex::encode(enc_salt_bytes);
        db.conn.execute(
            "UPDATE users SET encryption_salt = ?1 WHERE username = ?2",
            params![new_hex, username],
        ).map_err(|e| e.to_string())?;
        new_hex
    } else {
        enc_salt_hex
    };

    // Derive encryption key from password + encryption_salt using Argon2id
    let enc_salt_bytes = hex::decode(&enc_salt_hex)
        .map_err(|_| "Invalid encryption salt")?;
    let mut encryption_key = [0u8; 32];
    Argon2::default()
        .hash_password_into(pass.as_bytes(), &enc_salt_bytes, &mut encryption_key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    // Generate session token
    let mut token_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut token_bytes);
    let session_token = hex::encode(token_bytes);
    token_bytes.zeroize();

    // Migrate any plaintext entries before storing session
    migrate_plaintext_entries(db, &encryption_key)?;

    // Store session
    drop(db_guard); // Release DB lock before acquiring session lock
    let mut session_guard = state.session.lock().map_err(|_| "Lock failed")?;
    *session_guard = Some(SessionState {
        token: session_token.clone(),
        encryption_key,
    });

    // Zeroize local copy of encryption key (SessionState has its own copy)
    encryption_key.zeroize();

    Ok(session_token)
}

#[tauri::command]
fn lock_vault(state: State<AppState>) -> Result<String, String> {
    // Clear session (fail-safe: no token required)
    let mut session_guard = state.session.lock().map_err(|_| "Lock failed")?;
    *session_guard = None;
    drop(session_guard);

    // Reset active profile to default
    let mut active_id = state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    *active_id = 1;

    Ok("Locked".to_string())
}

// --- VAULT COMMANDS ---

#[tauri::command]
fn get_all_vault_entries(state: State<AppState>, token: String) -> Result<Vec<serde_json::Value>, String> {
    let key = validate_session(&state, &token)?;
    let active_profile = *state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let mut stmt = db.conn.prepare(
        "SELECT id, uuid, data_blob, nonce FROM vault_entries WHERE profile_id = ?1"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![active_profile], |row| {
        let id: i64 = row.get(0)?;
        let uuid: String = row.get(1)?;
        let blob: Vec<u8> = row.get(2)?;
        let nonce: Vec<u8> = row.get(3)?;
        Ok((id, uuid, blob, nonce))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        let (id, uuid, blob, nonce) = row.map_err(|e| e.to_string())?;

        // Decrypt: empty nonce = legacy plaintext fallback
        let plaintext = if nonce.is_empty() {
            blob
        } else {
            decrypt_blob(&key, &blob, &nonce)?
        };

        entries.push(serde_json::json!({
            "id": id,
            "uuid": uuid,
            "data_blob": plaintext
        }));
    }
    Ok(entries)
}

#[tauri::command]
fn save_entry(state: State<AppState>, token: String, uuid: String, blob: Vec<u8>, profile_id: Option<i64>) -> Result<String, String> {
    let key = validate_session(&state, &token)?;
    let active_profile = *state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    let target_profile = profile_id.unwrap_or(active_profile);
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let (ciphertext, nonce) = encrypt_blob(&key, &blob)?;

    db.conn.execute(
        "INSERT INTO vault_entries (uuid, data_blob, nonce, profile_id) VALUES (?1, ?2, ?3, ?4)",
        params![uuid, ciphertext, nonce, target_profile],
    ).map_err(|e| e.to_string())?;

    Ok("Saved".to_string())
}

#[tauri::command]
fn update_entry(state: State<AppState>, token: String, id: i64, uuid: String, blob: Vec<u8>) -> Result<String, String> {
    let key = validate_session(&state, &token)?;
    let active_profile = *state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let (ciphertext, nonce) = encrypt_blob(&key, &blob)?;

    // Validate entry belongs to active profile
    let rows_updated = db.conn.execute(
        "UPDATE vault_entries SET uuid = ?1, data_blob = ?2, nonce = ?3 WHERE id = ?4 AND profile_id = ?5",
        params![uuid, ciphertext, nonce, id, active_profile],
    ).map_err(|e| e.to_string())?;

    if rows_updated == 0 {
        return Err("Entry not found or belongs to different profile".to_string());
    }

    Ok("Updated".to_string())
}

#[tauri::command]
fn delete_entry(state: State<AppState>, token: String, id: i64) -> Result<String, String> {
    validate_session(&state, &token)?;
    let active_profile = *state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // Validate entry belongs to active profile
    let rows_deleted = db.conn.execute(
        "DELETE FROM vault_entries WHERE id = ?1 AND profile_id = ?2",
        params![id, active_profile],
    ).map_err(|e| e.to_string())?;

    if rows_deleted == 0 {
        return Err("Entry not found or belongs to different profile".to_string());
    }

    Ok("Deleted".to_string())
}

// --- PROFILE COMMANDS ---

#[tauri::command]
fn create_profile(state: State<AppState>, token: String, name: String) -> Result<i64, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    db.conn.execute(
        "INSERT INTO profiles (name) VALUES (?1)",
        params![name],
    ).map_err(|e| e.to_string())?;

    let id = db.conn.last_insert_rowid();
    Ok(id)
}

#[tauri::command]
fn get_all_profiles(state: State<AppState>, token: String) -> Result<Vec<serde_json::Value>, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let mut stmt = db.conn.prepare(
        "SELECT p.id, p.name, p.created_at, COUNT(v.id) as entry_count
         FROM profiles p
         LEFT JOIN vault_entries v ON v.profile_id = p.id
         GROUP BY p.id
         ORDER BY p.id"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let id: i64 = row.get(0)?;
        let name: String = row.get(1)?;
        let created_at: String = row.get(2)?;
        let entry_count: i64 = row.get(3)?;
        Ok(serde_json::json!({
            "id": id,
            "name": name,
            "createdAt": created_at,
            "entryCount": entry_count
        }))
    }).map_err(|e| e.to_string())?;

    let mut profiles = Vec::new();
    for row in rows {
        profiles.push(row.map_err(|e| e.to_string())?);
    }
    Ok(profiles)
}

#[tauri::command]
fn rename_profile(state: State<AppState>, token: String, id: i64, name: String) -> Result<String, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    db.conn.execute(
        "UPDATE profiles SET name = ?1 WHERE id = ?2",
        params![name, id],
    ).map_err(|e| e.to_string())?;

    Ok("Renamed".to_string())
}

#[tauri::command]
fn delete_profile(state: State<AppState>, token: String, id: i64) -> Result<String, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // Check if profile has any entries
    let entry_count: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM vault_entries WHERE profile_id = ?1",
        params![id],
        |row| row.get(0),
    ).unwrap_or(0);

    if entry_count > 0 {
        return Err("Cannot delete profile with entries. Move or delete entries first.".to_string());
    }

    // Check if it's the last profile
    let profile_count: i64 = db.conn.query_row(
        "SELECT COUNT(*) FROM profiles",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    if profile_count <= 1 {
        return Err("Cannot delete the last profile.".to_string());
    }

    db.conn.execute(
        "DELETE FROM profiles WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;

    Ok("Deleted".to_string())
}

#[tauri::command]
fn get_active_profile(state: State<AppState>, token: String) -> Result<i64, String> {
    validate_session(&state, &token)?;
    let active_id = state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    Ok(*active_id)
}

#[tauri::command]
fn set_active_profile(state: State<AppState>, token: String, id: i64) -> Result<String, String> {
    validate_session(&state, &token)?;
    let mut active_id = state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    *active_id = id;
    Ok("Active profile set".to_string())
}

#[tauri::command]
fn get_totp_token(state: State<AppState>, token: String, secret: String) -> Result<String, String> {
    validate_session(&state, &token)?;
    let clean_secret = secret.replace(" ", "").replace("=", "").to_uppercase();
    let secret_bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, &clean_secret)
        .ok_or("Invalid Base32 Secret")?;

    // Use new_unchecked to allow secrets shorter than 128 bits (e.g., 80-bit secrets)
    let totp = TOTP::new_unchecked(Algorithm::SHA1, 6, 1, 30, secret_bytes);
    Ok(totp.generate_current().map_err(|e| e.to_string())?)
}

// --- MAIN ---
fn main() {
    let app_state = AppState {
        db: Arc::new(Mutex::new(None)),
        active_profile_id: Arc::new(Mutex::new(1)), // Default to profile 1 (Personal)
        session: Arc::new(Mutex::new(None)),
        failed_attempts: Arc::new(Mutex::new((0, None))),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            let handle = app.handle();
            let db_mgr = DatabaseManager::new(handle);
            let state = app.state::<AppState>();
            *state.db.lock().unwrap() = Some(db_mgr);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_registration_status,
            register_user,
            unlock_vault,
            lock_vault,
            save_entry,
            update_entry,
            delete_entry,
            get_all_vault_entries,
            get_totp_token,
            create_profile,
            get_all_profiles,
            rename_profile,
            delete_profile,
            get_active_profile,
            set_active_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
