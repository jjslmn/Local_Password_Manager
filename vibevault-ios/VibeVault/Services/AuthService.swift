import Foundation
import CryptoKit

/// Manages user registration, login, and session state
@MainActor
final class AuthService: ObservableObject {
    @Published var isRegistered = false
    @Published var isAuthenticated = false
    @Published var activeProfileId: Int64 = 1

    private var encryptionKey: SymmetricKey?
    private let db = DatabaseService.shared

    func checkRegistration() {
        isRegistered = (try? db.isRegistered()) ?? false
    }

    func register(username: String, password: String) throws {
        // Generate salt for password hashing
        var saltBytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, saltBytes.count, &saltBytes)
        let salt = Data(saltBytes)

        // Hash password
        let passwordHash = try CryptoService.hashPassword(password, salt: salt)

        // Generate encryption salt
        var encSaltBytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, encSaltBytes.count, &encSaltBytes)
        let encSalt = Data(encSaltBytes)

        // Save user
        let user = User(
            username: username,
            passwordHash: passwordHash,
            salt: salt.base64EncodedString().replacingOccurrences(of: "=", with: ""),
            encryptionSalt: encSalt.map { String(format: "%02hhx", $0) }.joined()
        )
        try db.createUser(user)
        isRegistered = true
    }

    func login(username: String, password: String) throws {
        guard let user = try db.getUser(username: username) else {
            throw AuthError.invalidCredentials
        }

        // Verify password
        guard try CryptoService.verifyPassword(password, hash: user.passwordHash) else {
            throw AuthError.invalidCredentials
        }

        // Derive encryption key
        guard let encSaltData = Data(hexString: user.encryptionSalt) else {
            throw AuthError.invalidEncryptionSalt
        }
        encryptionKey = try CryptoService.deriveEncryptionKey(
            password: password,
            encryptionSalt: encSaltData
        )

        // Optionally store in Keychain for Face ID unlock
        if let keyData = encryptionKey?.withUnsafeBytes({ Data($0) }) {
            try? KeychainService.store(key: .encryptionKey, data: keyData, requireBiometric: true)
        }

        isAuthenticated = true
    }

    func logout() {
        encryptionKey = nil
        KeychainService.delete(key: .encryptionKey)
        isAuthenticated = false
        activeProfileId = 1
    }

    func getEncryptionKey() -> SymmetricKey? {
        encryptionKey
    }

    /// Try to unlock using Face ID (if previously stored key)
    func unlockWithBiometrics() async throws {
        guard try await KeychainService.authenticateWithBiometrics(reason: "Unlock your vault") else {
            throw AuthError.biometricsFailed
        }
        guard let keyData = try KeychainService.retrieve(key: .encryptionKey) else {
            throw AuthError.noStoredKey
        }
        encryptionKey = SymmetricKey(data: keyData)
        isAuthenticated = true
    }

    enum AuthError: LocalizedError {
        case invalidCredentials
        case invalidEncryptionSalt
        case biometricsFailed
        case noStoredKey

        var errorDescription: String? {
            switch self {
            case .invalidCredentials: return "Invalid username or password"
            case .invalidEncryptionSalt: return "Corrupted encryption data"
            case .biometricsFailed: return "Biometric authentication failed"
            case .noStoredKey: return "No stored key — please log in with password"
            }
        }
    }
}

// MARK: - Data hex helper
extension Data {
    init?(hexString: String) {
        let len = hexString.count / 2
        var data = Data(capacity: len)
        var index = hexString.startIndex
        for _ in 0..<len {
            let nextIndex = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<nextIndex], radix: 16) else { return nil }
            data.append(byte)
            index = nextIndex
        }
        self = data
    }
}
