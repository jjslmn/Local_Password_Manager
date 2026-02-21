import Foundation
import CryptoKit
import Argon2Swift

/// Handles all cryptographic operations — must match the desktop Rust implementation exactly.
///
/// Critical compatibility notes:
/// - Argon2id params: m=19456, t=2, p=1 (Rust `argon2` crate defaults)
/// - AES-256-GCM with 12-byte random nonces
/// - Key derivation: Argon2id hash_password_into(password, encryption_salt) -> 32-byte key
final class CryptoService {

    // MARK: - Argon2id Parameters (MUST match Rust defaults)

    /// Memory cost in KiB — Rust argon2 default = 19456 (19 MiB)
    private static let memoryCost: UInt32 = 19456
    /// Time cost (iterations) — Rust argon2 default = 2
    private static let timeCost: UInt32 = 2
    /// Parallelism — Rust argon2 default = 1
    private static let parallelism: UInt32 = 1
    /// Hash output length
    private static let hashLength: Int = 32

    // MARK: - Password Hashing (for authentication)

    /// Hash a password with Argon2id for authentication (same as Rust's hash_password)
    static func hashPassword(_ password: String, salt: Data) throws -> String {
        let result = try Argon2Swift.hashPasswordBytes(
            password: password.data(using: .utf8)!,
            salt: Salt(bytes: salt),
            length: hashLength,
            type: .id,
            version: .V13,
            iterations: Int(timeCost),
            memory: Int(memoryCost),
            parallelism: Int(parallelism)
        )
        return result.encodedString()
    }

    /// Verify a password against a stored Argon2id hash
    static func verifyPassword(_ password: String, hash: String) throws -> Bool {
        return try Argon2Swift.verifyHashString(
            password: password,
            hash: hash,
            type: .id
        )
    }

    // MARK: - Key Derivation (for vault encryption)

    /// Derive a 32-byte encryption key from password + encryption_salt.
    /// This MUST produce the same output as Rust's Argon2::hash_password_into()
    static func deriveEncryptionKey(password: String, encryptionSalt: Data) throws -> SymmetricKey {
        let result = try Argon2Swift.hashPasswordBytes(
            password: password.data(using: .utf8)!,
            salt: Salt(bytes: encryptionSalt),
            length: hashLength,
            type: .id,
            version: .V13,
            iterations: Int(timeCost),
            memory: Int(memoryCost),
            parallelism: Int(parallelism)
        )
        return SymmetricKey(data: result.hashData())
    }

    // MARK: - AES-256-GCM Encryption

    /// Encrypt data with AES-256-GCM (matches Rust encrypt_blob)
    static func encrypt(_ plaintext: Data, key: SymmetricKey) throws -> (ciphertext: Data, nonce: Data) {
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(plaintext, using: key, nonce: nonce)
        // Combined = nonce + ciphertext + tag, but Rust stores ciphertext+tag separately from nonce
        // Rust's aes-gcm appends the 16-byte tag to ciphertext
        let ciphertextWithTag = sealed.ciphertext + sealed.tag
        return (ciphertextWithTag, Data(nonce))
    }

    /// Decrypt data with AES-256-GCM (matches Rust decrypt_blob)
    static func decrypt(_ ciphertext: Data, nonce: Data, key: SymmetricKey) throws -> Data {
        let gcmNonce = try AES.GCM.Nonce(data: nonce)
        // Rust's aes-gcm stores ciphertext with tag appended (last 16 bytes)
        let sealed = try AES.GCM.SealedBox(nonce: gcmNonce, ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
        return try AES.GCM.open(sealed, using: key)
    }

    // MARK: - ECDH (for BLE pairing)

    /// Generate an ECDH P-256 keypair for pairing
    static func generateECDHKeyPair() -> P256.KeyAgreement.PrivateKey {
        P256.KeyAgreement.PrivateKey()
    }

    /// Perform ECDH key agreement and derive a session key via HKDF-SHA256
    static func deriveSessionKey(
        privateKey: P256.KeyAgreement.PrivateKey,
        peerPublicKey: P256.KeyAgreement.PublicKey
    ) throws -> SymmetricKey {
        let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: peerPublicKey)
        return sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: "vibevault-sync-v1".data(using: .utf8)!,
            outputByteCount: 32
        )
    }

    // MARK: - HMAC (for pairing code verification)

    /// Compute HMAC-SHA256(code, publicKeyBytes) for pairing verification
    static func computePairingHMAC(code: String, publicKeyBytes: Data) -> Data {
        let key = SymmetricKey(data: code.data(using: .utf8)!)
        let hmac = HMAC<SHA256>.authenticationCode(for: publicKeyBytes, using: key)
        return Data(hmac)
    }

    /// Verify an HMAC from the peer
    static func verifyPairingHMAC(code: String, publicKeyBytes: Data, hmac: Data) -> Bool {
        let key = SymmetricKey(data: code.data(using: .utf8)!)
        return HMAC<SHA256>.isValidAuthenticationCode(hmac, authenticating: publicKeyBytes, using: key)
    }

    // MARK: - Utility

    /// Generate a cryptographically random 6-digit pairing code
    static func generatePairingCode() -> String {
        var bytes = [UInt8](repeating: 0, count: 4)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let num = UInt32(bytes[0]) | (UInt32(bytes[1]) << 8) | (UInt32(bytes[2]) << 16) | (UInt32(bytes[3]) << 24)
        return String(format: "%06d", num % 1_000_000)
    }
}
