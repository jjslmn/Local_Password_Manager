import Foundation
import GRDB

struct User: Codable, FetchableRecord, PersistableRecord {
    var username: String
    var passwordHash: String
    var salt: String
    var encryptionSalt: String

    static let databaseTableName = "users"

    enum Columns: String, ColumnExpression {
        case username, passwordHash = "password_hash", salt
        case encryptionSalt = "encryption_salt"
    }
}
