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
use base64::{Engine as _, engine::general_purpose};

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

        // 2. Create Vault Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS vault_entries (
                id INTEGER PRIMARY KEY,
                uuid TEXT NOT NULL,
                data_blob BLOB NOT NULL,
                nonce BLOB NOT NULL
            )",
            [],
        ).expect("Failed to create vault table");

        DatabaseManager { conn }
    }
}

// --- APP STATE ---
struct AppState {
    db: Arc<Mutex<Option<DatabaseManager>>>,
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

    // 1. Generate clean salt
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt_str = general_purpose::STANDARD.encode(salt_bytes).replace("=", "");
    
    // 2. Hash Password
    let salt = SaltString::from_b64(&salt_str).map_err(|_| "Salt Error")?;
    let argon2 = Argon2::default();
    let password_hash = argon2.hash_password(pass.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    // 3. Save User
    db.conn.execute(
        "INSERT INTO users (username, password_hash, salt) VALUES (?1, ?2, ?3)",
        params![username, password_hash, salt_str],
    ).map_err(|e| e.to_string())?;

    Ok("User registered".to_string())
}

#[tauri::command]
fn unlock_vault(state: State<AppState>, username: String, pass: String) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let hash: String = db.conn.query_row(
        "SELECT password_hash FROM users WHERE username = ?1",
        params![username],
        |row| row.get(0),
    ).map_err(|_| "User not found")?;

    let parsed_hash = PasswordHash::new(&hash).map_err(|_| "Hash error")?;
    Argon2::default().verify_password(pass.as_bytes(), &parsed_hash)
        .map_err(|_| "Invalid Password")?;

    Ok("Unlocked".to_string())
}

// --- VAULT COMMANDS ---

#[tauri::command]
fn get_all_vault_entries(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    let mut stmt = db.conn.prepare("SELECT id, uuid, data_blob FROM vault_entries").map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        let id: i64 = row.get(0)?;
        let uuid: String = row.get(1)?;
        let blob: Vec<u8> = row.get(2)?;
        Ok(serde_json::json!({
            "id": id,
            "uuid": uuid,
            "data_blob": blob
        }))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}

#[tauri::command]
fn save_entry(state: State<AppState>, uuid: String, blob: Vec<u8>, nonce: Vec<u8>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    db.conn.execute(
        "INSERT INTO vault_entries (uuid, data_blob, nonce) VALUES (?1, ?2, ?3)",
        params![uuid, blob, nonce],
    ).map_err(|e| e.to_string())?;

    Ok("Saved".to_string())
}

#[tauri::command]
fn update_entry(state: State<AppState>, id: i64, uuid: String, blob: Vec<u8>, nonce: Vec<u8>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "Lock failed")?;
    let db = db_guard.as_ref().ok_or("DB not init")?;

    db.conn.execute(
        "UPDATE vault_entries SET uuid = ?1, data_blob = ?2, nonce = ?3 WHERE id = ?4",
        params![uuid, blob, nonce, id],
    ).map_err(|e| e.to_string())?;

    Ok("Updated".to_string())
}

#[tauri::command]
fn get_totp_token(secret: String) -> Result<String, String> {
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
            save_entry,
            update_entry,
            get_all_vault_entries,
            get_totp_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
