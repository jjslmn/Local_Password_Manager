use rusqlite::{params, Connection, Result};
use std::path::Path;

// PUBLIC STRUCTS
#[derive(Debug)]
pub struct DbVaultEntry {
    pub id: i64,
    pub uuid: String,
    pub data_blob: Vec<u8>,
    pub nonce: Vec<u8>,
    pub created_at: Option<i64>,
}

#[derive(Debug)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub salt: String,
}

pub struct DatabaseManager {
    pub conn: Connection,
}

impl DatabaseManager {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Init Tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS vault_entries (
                id INTEGER PRIMARY KEY,
                uuid TEXT NOT NULL UNIQUE,
                data_blob BLOB NOT NULL,
                nonce BLOB NOT NULL,
                created_at INTEGER
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL
            )",
            [],
        )?;

        Ok(DatabaseManager { conn })
    }

    // USER METHODS
    pub fn get_user(&self) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare("SELECT id, username, password_hash, salt FROM users LIMIT 1")?;
        let mut rows = stmt.query([])?;

        if let Some(row) = rows.next()? {
            Ok(Some(User {
                id: row.get(0)?,
                username: row.get(1)?,
                password_hash: row.get(2)?,
                salt: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn register_user(&self, username: &str, hash: &str, salt: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO users (username, password_hash, salt) VALUES (?1, ?2, ?3)",
            params![username, hash, salt],
        )?;
        Ok(())
    }

    // VAULT METHODS
    pub fn save_entry(&self, uuid: &str, blob: &[u8], nonce: &[u8]) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO vault_entries (uuid, data_blob, nonce, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![uuid, blob, nonce, 0],
        )?;
        Ok(())
    }

    pub fn get_all_vault_entries(&self) -> Result<Vec<DbVaultEntry>> {
        let mut stmt = self.conn.prepare("SELECT id, uuid, data_blob, nonce, created_at FROM vault_entries")?;
        let entry_iter = stmt.query_map([], |row| {
            Ok(DbVaultEntry {
                id: row.get(0)?,
                uuid: row.get(1)?,
                data_blob: row.get(2)?,
                nonce: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;

        let mut entries = Vec::new();
        for entry in entry_iter {
            entries.push(entry?);
        }
        Ok(entries)
    }

    pub fn get_vault_entry(&self, uuid: &str) -> Result<DbVaultEntry> {
        let mut stmt = self.conn.prepare("SELECT id, uuid, data_blob, nonce, created_at FROM vault_entries WHERE uuid = ?1")?;
        let mut rows = stmt.query(params![uuid])?;

        if let Some(row) = rows.next()? {
            Ok(DbVaultEntry {
                id: row.get(0)?,
                uuid: row.get(1)?,
                data_blob: row.get(2)?,
                nonce: row.get(3)?,
                created_at: row.get(4)?,
            })
        } else {
            Err(rusqlite::Error::QueryReturnedNoRows)
        }
    }
    
    pub fn update_entry(&self, uuid: &str, blob: &[u8], nonce: &[u8]) -> Result<()> {
        // Reuse logic or specific update query
        self.conn.execute(
            "UPDATE vault_entries SET data_blob = ?1, nonce = ?2 WHERE uuid = ?3",
            params![blob, nonce, uuid],
        )?;
        Ok(())
    }

    pub fn delete_all_vault_entries(&self) -> Result<()> {
        self.conn.execute("DELETE FROM vault_entries", [])?;
        Ok(())
    }
}
