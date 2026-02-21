use tauri::State;
use rusqlite::params;

use crate::AppState;
use crate::auth::{validate_session, get_db_and_session};

#[tauri::command]
pub fn create_profile(
    state: State<AppState>,
    token: String,
    name: String,
) -> Result<i64, String> {
    let (db_guard, _key, _profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    db.conn
        .execute("INSERT INTO profiles (name) VALUES (?1)", params![name])
        .map_err(|e| e.to_string())?;

    let id = db.conn.last_insert_rowid();
    Ok(id)
}

#[tauri::command]
pub fn get_all_profiles(
    state: State<AppState>,
    token: String,
) -> Result<Vec<serde_json::Value>, String> {
    let (db_guard, _key, _profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    let mut stmt = db
        .conn
        .prepare(
            "SELECT p.id, p.name, p.created_at, COUNT(v.id) as entry_count
             FROM profiles p
             LEFT JOIN vault_entries v ON v.profile_id = p.id AND v.deleted_at IS NULL
             GROUP BY p.id
             ORDER BY p.id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
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
        })
        .map_err(|e| e.to_string())?;

    let mut profiles = Vec::new();
    for row in rows {
        profiles.push(row.map_err(|e| e.to_string())?);
    }
    Ok(profiles)
}

#[tauri::command]
pub fn rename_profile(
    state: State<AppState>,
    token: String,
    id: i64,
    name: String,
) -> Result<String, String> {
    let (db_guard, _key, _profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    db.conn
        .execute(
            "UPDATE profiles SET name = ?1 WHERE id = ?2",
            params![name, id],
        )
        .map_err(|e| e.to_string())?;

    Ok("Renamed".to_string())
}

#[tauri::command]
pub fn delete_profile(
    state: State<AppState>,
    token: String,
    id: i64,
) -> Result<String, String> {
    let (db_guard, _key, _profile) = get_db_and_session(&state, &token)?;
    let db = db_guard.as_ref().unwrap();

    // Check if profile has any active entries
    let entry_count: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM vault_entries WHERE profile_id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if entry_count > 0 {
        return Err(
            "Cannot delete profile with entries. Move or delete entries first.".to_string(),
        );
    }

    // Check if it's the last profile
    let profile_count: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))
        .unwrap_or(0);

    if profile_count <= 1 {
        return Err("Cannot delete the last profile.".to_string());
    }

    db.conn
        .execute("DELETE FROM profiles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok("Deleted".to_string())
}

#[tauri::command]
pub fn get_active_profile(state: State<AppState>, token: String) -> Result<i64, String> {
    validate_session(&state, &token)?;
    let active_id = state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    Ok(*active_id)
}

#[tauri::command]
pub fn set_active_profile(
    state: State<AppState>,
    token: String,
    id: i64,
) -> Result<String, String> {
    validate_session(&state, &token)?;
    let mut active_id = state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    *active_id = id;
    Ok("Active profile set".to_string())
}
