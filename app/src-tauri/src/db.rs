use rusqlite::{params, Connection};
use uuid::Uuid;

pub struct DatabaseManager {
    pub conn: Connection,
}

impl DatabaseManager {
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        use tauri::Manager;
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        std::fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
        let db_path = app_dir.join("vibevault.db");

        let conn =
            Connection::open(db_path).map_err(|e| format!("Failed to open DB: {}", e))?;

        Self::run_migrations(&conn)?;

        Ok(DatabaseManager { conn })
    }

    fn run_migrations(conn: &Connection) -> Result<(), String> {
        // 1. Create Users Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL
            )",
            [],
        )
        .map_err(|e| format!("Failed to create users table: {}", e))?;

        // 1b. Migration: Add encryption_salt column if missing
        if !Self::column_exists(conn, "users", "encryption_salt") {
            conn.execute(
                "ALTER TABLE users ADD COLUMN encryption_salt TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|e| format!("Failed to add encryption_salt column: {}", e))?;
        }

        // 2. Create Profiles Table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .map_err(|e| format!("Failed to create profiles table: {}", e))?;

        // 3. Insert default 'Personal' profile if profiles table is empty
        let profile_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM profiles", [], |row| row.get(0))
            .unwrap_or(0);

        if profile_count == 0 {
            conn.execute("INSERT INTO profiles (name) VALUES ('Personal')", [])
                .map_err(|e| format!("Failed to create default profile: {}", e))?;
        }

        // 4. Create Vault Table (with profile_id if new, or migrate if existing)
        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='vault_entries'",
                [],
                |row| row.get::<_, i64>(0).map(|c| c > 0),
            )
            .unwrap_or(false);

        if !table_exists {
            conn.execute(
                "CREATE TABLE vault_entries (
                    id INTEGER PRIMARY KEY,
                    uuid TEXT NOT NULL,
                    data_blob BLOB NOT NULL,
                    nonce BLOB NOT NULL,
                    profile_id INTEGER NOT NULL DEFAULT 1,
                    entry_uuid TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted_at TEXT,
                    sync_version INTEGER NOT NULL DEFAULT 1,
                    FOREIGN KEY (profile_id) REFERENCES profiles(id)
                )",
                [],
            )
            .map_err(|e| format!("Failed to create vault table: {}", e))?;
        } else {
            // Migration: Add profile_id column if missing
            if !Self::column_exists(conn, "vault_entries", "profile_id") {
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1",
                    [],
                )
                .map_err(|e| format!("Failed to add profile_id column: {}", e))?;
            }

            // Migration: Add sync metadata columns
            if !Self::column_exists(conn, "vault_entries", "entry_uuid") {
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN entry_uuid TEXT",
                    [],
                )
                .map_err(|e| format!("Failed to add entry_uuid column: {}", e))?;
            }
            if !Self::column_exists(conn, "vault_entries", "created_at") {
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
                    [],
                )
                .map_err(|e| format!("Failed to add created_at column: {}", e))?;
            }
            if !Self::column_exists(conn, "vault_entries", "updated_at") {
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
                    [],
                )
                .map_err(|e| format!("Failed to add updated_at column: {}", e))?;
            }
            if !Self::column_exists(conn, "vault_entries", "deleted_at") {
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN deleted_at TEXT",
                    [],
                )
                .map_err(|e| format!("Failed to add deleted_at column: {}", e))?;
            }
            if !Self::column_exists(conn, "vault_entries", "sync_version") {
                conn.execute(
                    "ALTER TABLE vault_entries ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1",
                    [],
                )
                .map_err(|e| format!("Failed to add sync_version column: {}", e))?;
            }

            // Backfill entry_uuid for existing rows that don't have one
            Self::backfill_entry_uuids(conn)?;
        }

        // 5. Create paired_devices table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS paired_devices (
                id INTEGER PRIMARY KEY,
                device_name TEXT NOT NULL,
                device_id TEXT NOT NULL UNIQUE,
                public_key BLOB NOT NULL,
                shared_secret BLOB NOT NULL,
                paired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_sync_at TEXT
            )",
            [],
        )
        .map_err(|e| format!("Failed to create paired_devices table: {}", e))?;

        // 6. Create sync_log table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY,
                device_id TEXT NOT NULL,
                direction TEXT NOT NULL,
                entries_sent INTEGER DEFAULT 0,
                entries_received INTEGER DEFAULT 0,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                error_message TEXT
            )",
            [],
        )
        .map_err(|e| format!("Failed to create sync_log table: {}", e))?;

        // 7. Create indexes for common queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_vault_entry_uuid ON vault_entries (entry_uuid)",
            [],
        )
        .map_err(|e| format!("Failed to create entry_uuid index: {}", e))?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_vault_profile_deleted ON vault_entries (profile_id, deleted_at)",
            [],
        )
        .map_err(|e| format!("Failed to create profile/deleted index: {}", e))?;

        Ok(())
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'",
                table, column
            ),
            [],
            |row| row.get::<_, i64>(0).map(|c| c > 0),
        )
        .unwrap_or(false)
    }

    fn backfill_entry_uuids(conn: &Connection) -> Result<(), String> {
        let mut stmt = conn
            .prepare("SELECT id FROM vault_entries WHERE entry_uuid IS NULL")
            .map_err(|e| format!("Failed to prepare backfill query: {}", e))?;

        let ids: Vec<i64> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("Failed to query rows for backfill: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        for id in ids {
            let new_uuid = Uuid::new_v4().to_string();
            conn.execute(
                "UPDATE vault_entries SET entry_uuid = ?1 WHERE id = ?2",
                params![new_uuid, id],
            )
            .map_err(|e| format!("Failed to backfill entry_uuid: {}", e))?;
        }

        Ok(())
    }

    /// Purge tombstoned entries older than 90 days
    pub fn cleanup_tombstones(&self) -> Result<usize, String> {
        self.conn
            .execute(
                "DELETE FROM vault_entries WHERE deleted_at IS NOT NULL
                 AND deleted_at < datetime('now', '-90 days')",
                [],
            )
            .map_err(|e| e.to_string())
    }
}
