use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::auth::validate_session;
use crate::AppState;

// --- Types for frontend communication ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairedDevice {
    pub id: i64,
    pub device_name: String,
    pub device_id: String,
    pub paired_at: String,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncHistoryEntry {
    pub id: i64,
    pub device_id: String,
    pub direction: String,
    pub entries_sent: i64,
    pub entries_received: i64,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncProgress {
    pub state: String, // "advertising", "pairing", "transferring", "complete", "error"
    pub chunks_transferred: u32,
    pub total_chunks: u32,
    pub message: String,
}

// --- Tauri Commands ---

#[tauri::command]
pub fn get_paired_devices(
    state: State<AppState>,
    token: String,
) -> Result<Vec<PairedDevice>, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let mut stmt = db
        .conn
        .prepare(
            "SELECT id, device_name, device_id, paired_at, last_sync_at
             FROM paired_devices ORDER BY paired_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PairedDevice {
                id: row.get(0)?,
                device_name: row.get(1)?,
                device_id: row.get(2)?,
                paired_at: row.get(3)?,
                last_sync_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut devices = Vec::new();
    for row in rows {
        devices.push(row.map_err(|e| e.to_string())?);
    }
    Ok(devices)
}

#[tauri::command]
pub fn forget_device(
    state: State<AppState>,
    token: String,
    device_id: String,
) -> Result<String, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    db.conn
        .execute(
            "DELETE FROM paired_devices WHERE device_id = ?1",
            params![device_id],
        )
        .map_err(|e| e.to_string())?;

    Ok("Device forgotten".to_string())
}

#[tauri::command]
pub fn get_sync_history(
    state: State<AppState>,
    token: String,
) -> Result<Vec<SyncHistoryEntry>, String> {
    validate_session(&state, &token)?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let mut stmt = db
        .conn
        .prepare(
            "SELECT id, device_id, direction, entries_sent, entries_received,
                    status, started_at, completed_at, error_message
             FROM sync_log ORDER BY started_at DESC LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SyncHistoryEntry {
                id: row.get(0)?,
                device_id: row.get(1)?,
                direction: row.get(2)?,
                entries_sent: row.get(3)?,
                entries_received: row.get(4)?,
                status: row.get(5)?,
                started_at: row.get(6)?,
                completed_at: row.get(7)?,
                error_message: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}
