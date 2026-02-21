use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::DatabaseManager;

/// Sync payload exchanged between devices
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncPayload {
    pub version: u32,
    /// Hex-encoded encryption_salt — included on first sync only
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_salt: Option<String>,
    pub entries: Vec<SyncEntry>,
}

/// A single vault entry in the sync payload (still vault-encrypted)
#[derive(Debug, Serialize, Deserialize)]
pub struct SyncEntry {
    pub entry_uuid: String,
    pub uuid: String, // site name
    #[serde(with = "base64_bytes")]
    pub data_blob: Vec<u8>,
    #[serde(with = "base64_bytes")]
    pub nonce: Vec<u8>,
    pub profile_name: String,
    pub sync_version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

/// Base64 encoding/decoding for Vec<u8> fields in JSON
mod base64_bytes {
    use base64::{engine::general_purpose, Engine as _};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &Vec<u8>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let encoded = general_purpose::STANDARD.encode(bytes);
        serializer.serialize_str(&encoded)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        general_purpose::STANDARD
            .decode(&s)
            .map_err(serde::de::Error::custom)
    }
}

/// Result of merging a sync payload into the local database
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct MergeResult {
    pub inserted: u32,
    pub updated: u32,
    pub deleted: u32,
    pub skipped: u32,
    pub conflicts: u32,
}

/// Export vault entries for sync. If `since` is provided, only entries modified after that timestamp.
pub fn export_vault(
    db: &DatabaseManager,
    since: Option<&str>,
) -> Result<Vec<SyncEntry>, String> {
    let query = if since.is_some() {
        "SELECT ve.entry_uuid, ve.uuid, ve.data_blob, ve.nonce, p.name,
                ve.sync_version, ve.created_at, ve.updated_at, ve.deleted_at
         FROM vault_entries ve
         JOIN profiles p ON ve.profile_id = p.id
         WHERE ve.entry_uuid IS NOT NULL AND ve.updated_at > ?1"
    } else {
        "SELECT ve.entry_uuid, ve.uuid, ve.data_blob, ve.nonce, p.name,
                ve.sync_version, ve.created_at, ve.updated_at, ve.deleted_at
         FROM vault_entries ve
         JOIN profiles p ON ve.profile_id = p.id
         WHERE ve.entry_uuid IS NOT NULL"
    };

    let mut stmt = db.conn.prepare(query).map_err(|e| e.to_string())?;

    let rows = if let Some(ts) = since {
        stmt.query_map(params![ts], map_sync_entry)
    } else {
        stmt.query_map([], map_sync_entry)
    }
    .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}

fn map_sync_entry(row: &rusqlite::Row) -> rusqlite::Result<SyncEntry> {
    Ok(SyncEntry {
        entry_uuid: row.get(0)?,
        uuid: row.get(1)?,
        data_blob: row.get(2)?,
        nonce: row.get(3)?,
        profile_name: row.get(4)?,
        sync_version: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

/// Import sync entries into the local database using last-write-wins conflict resolution.
pub fn import_vault(
    db: &DatabaseManager,
    entries: &[SyncEntry],
) -> Result<MergeResult, String> {
    let mut result = MergeResult::default();

    for entry in entries {
        // Ensure profile exists (match by name)
        let profile_id = ensure_profile(db, &entry.profile_name)?;

        // Look up local entry by entry_uuid
        let local: Option<(i64, String, i64, Option<String>)> = db
            .conn
            .query_row(
                "SELECT id, updated_at, sync_version, deleted_at FROM vault_entries WHERE entry_uuid = ?1",
                params![entry.entry_uuid],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .ok();

        match local {
            None => {
                // Not found locally → insert
                db.conn
                    .execute(
                        "INSERT INTO vault_entries
                         (uuid, data_blob, nonce, profile_id, entry_uuid, created_at, updated_at, deleted_at, sync_version)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            entry.uuid,
                            entry.data_blob,
                            entry.nonce,
                            profile_id,
                            entry.entry_uuid,
                            entry.created_at,
                            entry.updated_at,
                            entry.deleted_at,
                            entry.sync_version,
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                result.inserted += 1;
            }
            Some((local_id, local_updated_at, local_sync_version, local_deleted_at)) => {
                // Conflict resolution: last write wins
                let should_update = match compare_timestamps(&entry.updated_at, &local_updated_at) {
                    std::cmp::Ordering::Greater => true,
                    std::cmp::Ordering::Less => false,
                    std::cmp::Ordering::Equal => {
                        // Tie: compare sync_version, higher wins; still tied → keep local
                        entry.sync_version > local_sync_version
                    }
                };

                if should_update {
                    // Check if this is a tombstone propagation
                    if entry.deleted_at.is_some() && local_deleted_at.is_none() {
                        // Remote is deleted, local is active → soft-delete locally
                        db.conn
                            .execute(
                                "UPDATE vault_entries
                                 SET deleted_at = ?1, updated_at = ?2, sync_version = ?3
                                 WHERE id = ?4",
                                params![
                                    entry.deleted_at,
                                    entry.updated_at,
                                    entry.sync_version,
                                    local_id,
                                ],
                            )
                            .map_err(|e| e.to_string())?;
                        result.deleted += 1;
                    } else {
                        // Update with remote data
                        db.conn
                            .execute(
                                "UPDATE vault_entries
                                 SET uuid = ?1, data_blob = ?2, nonce = ?3, profile_id = ?4,
                                     updated_at = ?5, deleted_at = ?6, sync_version = ?7
                                 WHERE id = ?8",
                                params![
                                    entry.uuid,
                                    entry.data_blob,
                                    entry.nonce,
                                    profile_id,
                                    entry.updated_at,
                                    entry.deleted_at,
                                    entry.sync_version,
                                    local_id,
                                ],
                            )
                            .map_err(|e| e.to_string())?;
                        result.updated += 1;
                    }
                    result.conflicts += 1;
                } else {
                    result.skipped += 1;
                }
            }
        }
    }

    Ok(result)
}

/// Ensure a profile with the given name exists, returning its ID
fn ensure_profile(db: &DatabaseManager, name: &str) -> Result<i64, String> {
    // Try to find existing
    let existing: Option<i64> = db
        .conn
        .query_row(
            "SELECT id FROM profiles WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )
        .ok();

    match existing {
        Some(id) => Ok(id),
        None => {
            db.conn
                .execute("INSERT INTO profiles (name) VALUES (?1)", params![name])
                .map_err(|e| e.to_string())?;
            Ok(db.conn.last_insert_rowid())
        }
    }
}

/// Compare ISO 8601 / RFC 3339 timestamps as strings (lexicographic works for ISO dates)
fn compare_timestamps(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

/// Get the encryption_salt for the registered user (needed for first sync)
pub fn get_encryption_salt(db: &DatabaseManager) -> Result<String, String> {
    db.conn
        .query_row(
            "SELECT encryption_salt FROM users LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("Failed to get encryption_salt: {}", e))
}

/// Record last sync time for a paired device
pub fn update_last_sync(db: &DatabaseManager, device_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    db.conn
        .execute(
            "UPDATE paired_devices SET last_sync_at = ?1 WHERE device_id = ?2",
            params![now, device_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the last sync timestamp for a paired device (for delta sync)
pub fn get_last_sync_at(db: &DatabaseManager, device_id: &str) -> Result<Option<String>, String> {
    db.conn
        .query_row(
            "SELECT last_sync_at FROM paired_devices WHERE device_id = ?1",
            params![device_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())
}

/// Log a sync operation
pub fn log_sync(
    db: &DatabaseManager,
    device_id: &str,
    direction: &str,
    entries_sent: u32,
    entries_received: u32,
    status: &str,
    error_message: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let completed = if status != "failed" {
        Some(now.clone())
    } else {
        None
    };
    db.conn
        .execute(
            "INSERT INTO sync_log (device_id, direction, entries_sent, entries_received, status, started_at, completed_at, error_message)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                device_id,
                direction,
                entries_sent,
                entries_received,
                status,
                now,
                completed,
                error_message,
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
