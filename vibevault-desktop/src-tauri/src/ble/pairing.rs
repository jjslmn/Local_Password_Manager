use p256::{
    ecdh::EphemeralSecret,
    PublicKey,
};
use rand::RngCore;
use sha2::Sha256;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use zeroize::Zeroize;

type HmacSha256 = Hmac<Sha256>;

const HKDF_INFO: &[u8] = b"vibevault-sync-v1";

/// Represents an in-progress pairing session
pub struct PairingSession {
    /// Our ECDH private key (ephemeral)
    secret: EphemeralSecret,
    /// Our ECDH public key (sent to peer)
    pub our_public_key: PublicKey,
    /// 6-digit numeric pairing code displayed on screen
    pub pairing_code: String,
}

/// Result of a successful pairing
#[derive(Debug)]
pub struct PairingResult {
    /// Derived symmetric key for encrypting sync data
    pub session_key: [u8; 32],
    /// Shared secret to store (encrypted) for future re-pairing
    pub shared_secret: Vec<u8>,
    /// Peer's public key (stored for identification)
    pub peer_public_key: Vec<u8>,
}

impl Drop for PairingResult {
    fn drop(&mut self) {
        self.session_key.zeroize();
        self.shared_secret.zeroize();
    }
}

impl PairingSession {
    /// Create a new pairing session: generates ECDH keypair + 6-digit code
    pub fn new() -> Self {
        let secret = EphemeralSecret::random(&mut rand::thread_rng());
        let our_public_key = PublicKey::from(&secret);

        // Generate 6-digit pairing code
        let mut code_bytes = [0u8; 4];
        rand::thread_rng().fill_bytes(&mut code_bytes);
        let code_num = u32::from_le_bytes(code_bytes) % 1_000_000;
        let pairing_code = format!("{:06}", code_num);

        PairingSession {
            secret,
            our_public_key,
            pairing_code,
        }
    }

    /// Get our public key as compressed SEC1 bytes (33 bytes)
    pub fn our_public_key_bytes(&self) -> Vec<u8> {
        use p256::elliptic_curve::sec1::ToEncodedPoint;
        self.our_public_key
            .to_encoded_point(true)
            .as_bytes()
            .to_vec()
    }

    /// Verify peer's HMAC(pairing_code, peer_public_key) and complete ECDH
    ///
    /// The peer sends: their public key bytes + HMAC-SHA256(code, pubkey)
    /// We verify the HMAC to confirm both sides have the same pairing code.
    pub fn complete_pairing(
        self,
        peer_public_key_bytes: &[u8],
        peer_hmac: &[u8],
    ) -> Result<PairingResult, String> {
        // Verify HMAC: peer should have signed their public key with the pairing code
        let mut mac = HmacSha256::new_from_slice(self.pairing_code.as_bytes())
            .map_err(|_| "HMAC init failed")?;
        mac.update(peer_public_key_bytes);
        mac.verify_slice(peer_hmac)
            .map_err(|_| "Pairing code mismatch")?;

        // Parse peer's public key
        let peer_public_key = PublicKey::from_sec1_bytes(peer_public_key_bytes)
            .map_err(|_| "Invalid peer public key")?;

        // ECDH: derive shared secret
        let shared_secret = self.secret.diffie_hellman(&peer_public_key);
        let shared_bytes = shared_secret.raw_secret_bytes();

        // HKDF-SHA256 to derive session key
        let hkdf = Hkdf::<Sha256>::new(None, shared_bytes);
        let mut session_key = [0u8; 32];
        hkdf.expand(HKDF_INFO, &mut session_key)
            .map_err(|_| "HKDF expand failed")?;

        Ok(PairingResult {
            session_key,
            shared_secret: shared_bytes.to_vec(),
            peer_public_key: peer_public_key_bytes.to_vec(),
        })
    }

    /// Compute our HMAC for sending to the peer (so they can verify us too)
    pub fn compute_our_hmac(&self) -> Vec<u8> {
        let our_pk_bytes = self.our_public_key_bytes();
        let mut mac = HmacSha256::new_from_slice(self.pairing_code.as_bytes())
            .expect("HMAC init should not fail with pairing code");
        mac.update(&our_pk_bytes);
        mac.finalize().into_bytes().to_vec()
    }
}

/// Derive a session key from a stored shared secret (for re-pairing without code)
pub fn derive_session_key_from_secret(shared_secret: &[u8]) -> Result<[u8; 32], String> {
    let hkdf = Hkdf::<Sha256>::new(None, shared_secret);
    let mut session_key = [0u8; 32];
    hkdf.expand(HKDF_INFO, &mut session_key)
        .map_err(|_| "HKDF expand failed")?;
    Ok(session_key)
}

/// Encrypt a sync payload with the session key (AES-256-GCM transport layer)
pub fn encrypt_transport(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    crate::crypto::encrypt_aes256_gcm(key, plaintext)
}

/// Decrypt a sync payload with the session key
pub fn decrypt_transport(
    key: &[u8; 32],
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, String> {
    crate::crypto::decrypt_aes256_gcm(key, ciphertext, nonce)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pairing_roundtrip() {
        // Simulate desktop and phone each creating a session
        let desktop = PairingSession::new();
        let phone_code = desktop.pairing_code.clone();

        // Phone creates its own keypair and computes HMAC with the code
        let phone_secret = EphemeralSecret::random(&mut rand::thread_rng());
        let phone_pk = PublicKey::from(&phone_secret);
        use p256::elliptic_curve::sec1::ToEncodedPoint;
        let phone_pk_bytes = phone_pk.to_encoded_point(true).as_bytes().to_vec();

        let mut mac = HmacSha256::new_from_slice(phone_code.as_bytes()).unwrap();
        mac.update(&phone_pk_bytes);
        let phone_hmac = mac.finalize().into_bytes().to_vec();

        // Desktop completes pairing
        let result = desktop.complete_pairing(&phone_pk_bytes, &phone_hmac);
        assert!(result.is_ok());

        let pairing = result.unwrap();
        assert_eq!(pairing.session_key.len(), 32);
        assert!(!pairing.session_key.iter().all(|&b| b == 0));
    }

    #[test]
    fn test_pairing_wrong_code_fails() {
        let desktop = PairingSession::new();

        // Phone uses a DIFFERENT code
        let wrong_code = "000000";
        let phone_secret = EphemeralSecret::random(&mut rand::thread_rng());
        let phone_pk = PublicKey::from(&phone_secret);
        use p256::elliptic_curve::sec1::ToEncodedPoint;
        let phone_pk_bytes = phone_pk.to_encoded_point(true).as_bytes().to_vec();

        let mut mac = HmacSha256::new_from_slice(wrong_code.as_bytes()).unwrap();
        mac.update(&phone_pk_bytes);
        let phone_hmac = mac.finalize().into_bytes().to_vec();

        let result = desktop.complete_pairing(&phone_pk_bytes, &phone_hmac);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Pairing code mismatch");
    }

    #[test]
    fn test_derive_session_key_deterministic() {
        let secret = vec![1u8; 32];
        let key1 = derive_session_key_from_secret(&secret).unwrap();
        let key2 = derive_session_key_from_secret(&secret).unwrap();
        assert_eq!(key1, key2);
    }
}
