use std::sync::MutexGuard;
use tauri::State;
use rusqlite::params;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::RngCore;
use base64::{Engine as _, engine::general_purpose};
use zeroize::Zeroize;
use std::time::{Duration, Instant};

use crate::{AppState, SessionState};
use crate::db::DatabaseManager;
use crate::vault::migrate_plaintext_entries;

/// Validate session token and return the encryption key.
/// Also enforces auto-lock timeout — if too much time has passed since
/// the last activity, the session is cleared and an error is returned.
pub fn validate_session(state: &State<AppState>, token: &str) -> Result<[u8; 32], String> {
    // Check auto-lock timeout
    {
        let last = state.last_activity.lock().map_err(|_| "Lock failed")?;
        let timeout = *state.auto_lock_seconds.lock().map_err(|_| "Lock failed")?;
        if timeout > 0 && last.elapsed() > Duration::from_secs(timeout) {
            // Clear the expired session
            drop(last);
            let mut session_guard = state.session.lock().map_err(|_| "Lock failed")?;
            *session_guard = None;
            return Err("Session expired. Please log in again.".to_string());
        }
    }

    let session_guard = state.session.lock().map_err(|_| "Lock failed")?;
    let session = session_guard
        .as_ref()
        .ok_or("Session expired. Please log in again.")?;

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

    // Update last activity timestamp
    if let Ok(mut last) = state.last_activity.lock() {
        *last = Instant::now();
    }

    Ok(session.encryption_key)
}

/// Validate session, lock DB, and get active profile in one call.
/// Returns (db_guard, encryption_key, active_profile_id).
/// Caller accesses the DB via `db_guard.as_ref().unwrap()` (validated here).
pub fn get_db_and_session<'a>(
    state: &'a State<AppState>,
    token: &str,
) -> Result<(MutexGuard<'a, Option<DatabaseManager>>, [u8; 32], i64), String> {
    let key = validate_session(state, token)?;
    let active_profile = *state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    if db_guard.is_none() {
        return Err("DB not init".to_string());
    }
    Ok((db_guard, key, active_profile))
}

#[tauri::command]
pub fn check_registration_status(state: State<AppState>) -> Result<bool, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let count: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(count > 0)
}

#[tauri::command]
pub fn register_user(
    state: State<AppState>,
    username: String,
    pass: String,
) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // 1. Generate clean salt for password hashing
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt_str = general_purpose::STANDARD
        .encode(salt_bytes)
        .replace("=", "");

    // 2. Hash Password
    let salt = SaltString::from_b64(&salt_str).map_err(|_| "Salt Error")?;
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(pass.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    // 3. Generate encryption salt (separate from auth salt)
    let mut enc_salt_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut enc_salt_bytes);
    let enc_salt_hex = hex::encode(enc_salt_bytes);

    // 4. Save User
    db.conn
        .execute(
            "INSERT INTO users (username, password_hash, salt, encryption_salt) VALUES (?1, ?2, ?3, ?4)",
            params![username, password_hash, salt_str, enc_salt_hex],
        )
        .map_err(|_| "Registration failed")?;

    Ok("User registered".to_string())
}

#[tauri::command]
pub fn unlock_vault(
    state: State<AppState>,
    username: String,
    pass: String,
) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    // Brute-force protection: read persisted attempt counter from DB
    {
        let (failed_count, last_failed_at): (u32, Option<String>) = db
            .conn
            .query_row(
                "SELECT failed_count, last_failed_at FROM login_attempts WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, None));

        if failed_count >= 3 {
            if let Some(ref ts) = last_failed_at {
                if let Ok(last) = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S") {
                    let now = chrono::Utc::now().naive_utc();
                    let delay_secs = 1i64 << (failed_count - 3).min(4);
                    let elapsed = (now - last).num_seconds();
                    if elapsed < delay_secs {
                        let remaining = delay_secs - elapsed + 1;
                        return Err(format!(
                            "Too many failed attempts. Wait {} seconds.",
                            remaining
                        ));
                    }
                }
            }
        }
    }

    // Authenticate
    let auth_result: Result<String, String> = (|| {
        let (hash, enc_salt_hex): (String, String) = db
            .conn
            .query_row(
                "SELECT password_hash, encryption_salt FROM users WHERE username = ?1",
                params![username],
                |row| Ok((row.get(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|_| "Invalid username or password".to_string())?;

        let parsed_hash =
            PasswordHash::new(&hash).map_err(|_| "Invalid username or password".to_string())?;
        Argon2::default()
            .verify_password(pass.as_bytes(), &parsed_hash)
            .map_err(|_| "Invalid username or password".to_string())?;

        Ok(enc_salt_hex)
    })();

    let enc_salt_hex = match auth_result {
        Ok(salt) => {
            // Reset counter on success
            let _ = db.conn.execute(
                "UPDATE login_attempts SET failed_count = 0, last_failed_at = NULL WHERE id = 1",
                [],
            );
            salt
        }
        Err(e) => {
            // Increment persisted counter
            let _ = db.conn.execute(
                "UPDATE login_attempts SET failed_count = failed_count + 1, last_failed_at = datetime('now') WHERE id = 1",
                [],
            );
            return Err(e);
        }
    };

    // Handle existing users who don't have an encryption_salt yet
    let enc_salt_hex = if enc_salt_hex.is_empty() {
        let mut enc_salt_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut enc_salt_bytes);
        let new_hex = hex::encode(enc_salt_bytes);
        db.conn
            .execute(
                "UPDATE users SET encryption_salt = ?1 WHERE username = ?2",
                params![new_hex, username],
            )
            .map_err(|e| e.to_string())?;
        new_hex
    } else {
        enc_salt_hex
    };

    // Derive encryption key from password + encryption_salt using Argon2id
    let enc_salt_bytes =
        hex::decode(&enc_salt_hex).map_err(|_| "Invalid encryption salt")?;
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

    // Clean up old tombstones
    let _ = db.cleanup_tombstones();

    // Store session and reset activity timer
    drop(db_guard);
    let mut session_guard = state.session.lock().map_err(|_| "Lock failed")?;
    *session_guard = Some(SessionState {
        token: session_token.clone(),
        encryption_key,
    });
    if let Ok(mut last) = state.last_activity.lock() {
        *last = Instant::now();
    }

    // Zeroize local copy
    encryption_key.zeroize();

    Ok(session_token)
}

#[tauri::command]
pub fn lock_vault(state: State<AppState>) -> Result<String, String> {
    let mut session_guard = state.session.lock().map_err(|_| "Lock failed")?;
    *session_guard = None;
    drop(session_guard);

    let mut active_id = state.active_profile_id.lock().map_err(|_| "Lock failed")?;
    *active_id = 1;

    Ok("Locked".to_string())
}

/// Called by the frontend on user interaction to reset the inactivity timer.
#[tauri::command]
pub fn touch_activity(state: State<AppState>) -> Result<(), String> {
    let mut last = state.last_activity.lock().map_err(|_| "Lock failed")?;
    *last = Instant::now();
    Ok(())
}

#[tauri::command]
pub fn get_auto_lock_seconds(state: State<AppState>) -> Result<u64, String> {
    let timeout = *state.auto_lock_seconds.lock().map_err(|_| "Lock failed")?;
    Ok(timeout)
}

#[tauri::command]
pub fn set_auto_lock_seconds(state: State<AppState>, token: String, seconds: u64) -> Result<String, String> {
    validate_session(&state, &token)?;
    let mut timeout = state.auto_lock_seconds.lock().map_err(|_| "Lock failed")?;
    *timeout = seconds;
    Ok(format!("Auto-lock set to {} seconds", seconds))
}
