#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod ble;
mod crypto;
mod db;
mod profiles;
mod sync;
mod vault;

use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::Manager;
use zeroize::Zeroize;

use db::DatabaseManager;

// --- SESSION STATE ---
pub struct SessionState {
    pub token: String,
    pub encryption_key: [u8; 32],
}

impl Drop for SessionState {
    fn drop(&mut self) {
        self.encryption_key.zeroize();
        self.token.zeroize();
    }
}

// --- APP STATE ---
pub struct AppState {
    pub db: Arc<Mutex<Option<DatabaseManager>>>,
    pub active_profile_id: Arc<Mutex<i64>>,
    pub session: Arc<Mutex<Option<SessionState>>>,
    pub failed_attempts: Arc<Mutex<(u32, Option<Instant>)>>,
}

// --- MAIN ---
fn main() {
    let app_state = AppState {
        db: Arc::new(Mutex::new(None)),
        active_profile_id: Arc::new(Mutex::new(1)),
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
            auth::check_registration_status,
            auth::register_user,
            auth::unlock_vault,
            auth::lock_vault,
            vault::save_entry,
            vault::update_entry,
            vault::delete_entry,
            vault::get_all_vault_entries,
            vault::get_totp_token,
            profiles::create_profile,
            profiles::get_all_profiles,
            profiles::rename_profile,
            profiles::delete_profile,
            profiles::get_active_profile,
            profiles::set_active_profile,
            sync::get_paired_devices,
            sync::forget_device,
            sync::get_sync_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
