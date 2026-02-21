import Foundation
import GRDB

struct Profile: Codable, FetchableRecord, PersistableRecord, Identifiable {
    var id: Int64?
    var name: String
    var createdAt: String

    static let databaseTableName = "profiles"
}
