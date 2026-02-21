import Foundation
import GRDB

/// Manages SQLite database with the same schema as the desktop app
final class DatabaseService {
    static let shared = DatabaseService()

    private var dbPool: DatabasePool?

    private init() {}

    var pool: DatabasePool {
        guard let pool = dbPool else {
            fatalError("DatabaseService not initialized. Call setup() first.")
        }
        return pool
    }

    func setup() throws {
        let fileManager = FileManager.default
        let dbDir = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("VibeVault", isDirectory: true)
        try fileManager.createDirectory(at: dbDir, withIntermediateDirectories: true)

        let dbPath = dbDir.appendingPathComponent("vibevault.db").path
        dbPool = try DatabasePool(path: dbPath)

        try runMigrations()
    }

    private func runMigrations() throws {
        try pool.write { db in
            // Users table
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    encryption_salt TEXT NOT NULL DEFAULT ''
                )
            """)

            // Profiles table
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS profiles (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)

            // Default profile
            let profileCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM profiles") ?? 0
            if profileCount == 0 {
                try db.execute(sql: "INSERT INTO profiles (name) VALUES ('Personal')")
            }

            // Vault entries (same schema as desktop)
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS vault_entries (
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
                )
            """)

            // Paired devices
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS paired_devices (
                    id INTEGER PRIMARY KEY,
                    device_name TEXT NOT NULL,
                    device_id TEXT NOT NULL UNIQUE,
                    public_key BLOB NOT NULL,
                    shared_secret BLOB NOT NULL,
                    paired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_sync_at TEXT
                )
            """)

            // Sync log
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS sync_log (
                    id INTEGER PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    entries_sent INTEGER DEFAULT 0,
                    entries_received INTEGER DEFAULT 0,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    error_message TEXT
                )
            """)
        }
    }

    // MARK: - User Operations

    func isRegistered() throws -> Bool {
        try pool.read { db in
            let count = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM users") ?? 0
            return count > 0
        }
    }

    func getUser(username: String) throws -> User? {
        try pool.read { db in
            try User.filter(Column("username") == username).fetchOne(db)
        }
    }

    func createUser(_ user: User) throws {
        try pool.write { db in
            try user.insert(db)
        }
    }

    // MARK: - Profile Operations

    func getAllProfiles() throws -> [Profile] {
        try pool.read { db in
            try Profile.order(Column("id")).fetchAll(db)
        }
    }

    func getProfileEntryCount(profileId: Int64) throws -> Int {
        try pool.read { db in
            try Int.fetchOne(db, sql:
                "SELECT COUNT(*) FROM vault_entries WHERE profile_id = ? AND deleted_at IS NULL",
                arguments: [profileId]
            ) ?? 0
        }
    }

    // MARK: - Vault Operations

    func getActiveEntries(profileId: Int64) throws -> [VaultEntry] {
        try pool.read { db in
            try VaultEntry
                .filter(Column("profile_id") == profileId)
                .filter(Column("deleted_at") == nil)
                .fetchAll(db)
        }
    }

    func saveEntry(_ entry: inout VaultEntry) throws {
        try pool.write { db in
            try entry.insert(db)
        }
    }

    func updateEntry(_ entry: VaultEntry) throws {
        try pool.write { db in
            try entry.update(db)
        }
    }

    func softDeleteEntry(id: Int64, profileId: Int64) throws {
        let now = ISO8601DateFormatter().string(from: Date())
        try pool.write { db in
            try db.execute(sql: """
                UPDATE vault_entries
                SET deleted_at = ?, updated_at = ?, sync_version = sync_version + 1
                WHERE id = ? AND profile_id = ? AND deleted_at IS NULL
            """, arguments: [now, now, id, profileId])
        }
    }
}
