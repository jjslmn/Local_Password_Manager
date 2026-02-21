import Foundation
import GRDB

struct PairedDevice: Codable, FetchableRecord, PersistableRecord, Identifiable {
    var id: Int64?
    var deviceName: String
    var deviceId: String
    var publicKey: Data
    var sharedSecret: Data
    var pairedAt: String
    var lastSyncAt: String?

    static let databaseTableName = "paired_devices"

    enum Columns: String, ColumnExpression {
        case id, deviceName = "device_name", deviceId = "device_id"
        case publicKey = "public_key", sharedSecret = "shared_secret"
        case pairedAt = "paired_at", lastSyncAt = "last_sync_at"
    }
}
