import Foundation
import GRDB

/// Vault entry stored in SQLite — matches the desktop schema exactly
struct VaultEntry: Codable, FetchableRecord, PersistableRecord, Identifiable {
    var id: Int64?
    var uuid: String           // site name label
    var dataBlob: Data         // encrypted JSON payload
    var nonce: Data            // AES-256-GCM nonce (12 bytes)
    var profileId: Int64
    var entryUuid: String?     // UUIDv4 for sync identity
    var createdAt: String
    var updatedAt: String
    var deletedAt: String?     // nil = active, timestamp = tombstone
    var syncVersion: Int64

    static let databaseTableName = "vault_entries"

    enum Columns: String, ColumnExpression {
        case id, uuid, dataBlob = "data_blob", nonce, profileId = "profile_id"
        case entryUuid = "entry_uuid", createdAt = "created_at", updatedAt = "updated_at"
        case deletedAt = "deleted_at", syncVersion = "sync_version"
    }
}

/// Decrypted vault entry data (parsed from JSON inside dataBlob)
struct VaultEntryData: Codable {
    var username: String?
    var password: String?
    var totpSecret: String?
    var notes: String?
}

/// Combined entry for display (VaultEntry + decrypted data)
struct DisplayEntry: Identifiable {
    let entry: VaultEntry
    let data: VaultEntryData
    var id: Int64? { entry.id }
    var siteName: String { entry.uuid }
}
