use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce
};
use argon2::{
    password_hash::{
        PasswordHasher, SaltString
    },
    Argon2, Params
};
use std::time::{Instant};
use std::sync::Mutex;

// --- CRITICAL SECURITY CONSTANTS ---
// Argon2id Parameters for Master Password
const ARGON_M_COST: u32 = 65536; // 64 MiB
const ARGON_T_COST: u32 = 3;     // 3 Iterations
const ARGON_P_COST: u32 = 4;     // 4 Parallel Threads

pub struct SecurityManager {
    rate_limiter: Mutex<RateLimiter>,
}

impl SecurityManager {
    pub fn new() -> Self {
        Self {
            rate_limiter: Mutex::new(RateLimiter::new()),
        }
    }

    /// Derives a 32-byte key from the master password using Argon2id.
    /// Returns (Key, Salt)
    pub fn derive_key(&self, password: &str, salt_opt: Option<String>) -> Result<(Vec<u8>, String), String> {
        let salt = match salt_opt {
             Some(s) => SaltString::from_b64(&s).map_err(|e| format!("Salt Decode Error: {}", e))?,
             None => SaltString::generate(&mut OsRng),
        };

        let params = Params::new(ARGON_M_COST, ARGON_T_COST, ARGON_P_COST, Some(32))
            .map_err(|e| e.to_string())?;
        
        let argon2 = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);

        let password_hash = argon2.hash_password(password.as_bytes(), &salt)
            .map_err(|e| e.to_string())?;
        
        // Extract the raw output key (32 bytes)
        let hash = password_hash.hash.ok_or("Hash output missing")?;
        let key_bytes = hash.as_bytes().to_vec();

        Ok((key_bytes, salt.as_str().to_string()))
    }

    /// Encrypts data using AES-256-GCM.
    /// Returns (Ciphertext+Tag, Nonce)
    pub fn encrypt(&self, key_bytes: &[u8], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        if key_bytes.len() != 32 {
            return Err("Invalid key length".to_string());
        }
        let key = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bits; unique per message

        let ciphertext = cipher.encrypt(&nonce, plaintext)
            .map_err(|e| e.to_string())?;

        Ok((ciphertext, nonce.to_vec()))
    }

    /// Encrypts vault entry data using AES-256-GCM.
    /// Returns (Ciphertext, Nonce)
    pub fn encrypt_vault_entry(&self, json_data: &str, key_bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        self.encrypt(key_bytes, json_data.as_bytes())
    }

    /// Decrypts vault entry data using AES-256-GCM.
    /// Returns the decrypted JSON string.
    pub fn decrypt_vault_entry(&self, encrypted_data: &[u8], nonce: &[u8], key: &[u8]) -> Result<String, String> {
        let plaintext = self.decrypt(key, encrypted_data, nonce)?;
        String::from_utf8(plaintext).map_err(|e| format!("UTF-8 Error: {}", e))
    }

    /// Decrypts data using AES-256-GCM.
    pub fn decrypt(&self, key_bytes: &[u8], ciphertext: &[u8], nonce_bytes: &[u8]) -> Result<Vec<u8>, String> {
        if key_bytes.len() != 32 {
            return Err("Invalid key length".to_string());
        }
        let key = Key::<Aes256Gcm>::from_slice(key_bytes);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| e.to_string())?;

        Ok(plaintext)
    }

    pub fn check_rate_limit(&self) -> Result<(), u64> {
        let limiter = self.rate_limiter.lock().unwrap();
        limiter.check()
    }

    pub fn report_failed_attempt(&self) {
        let mut limiter = self.rate_limiter.lock().unwrap();
        limiter.record_failure();
    }
    
    pub fn report_success(&self) {
        let mut limiter = self.rate_limiter.lock().unwrap();
        limiter.reset();
    }
}

// --- RATE LIMITER ---
struct RateLimiter {
    attempts: u32,
    last_failure: Option<Instant>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            attempts: 0,
            last_failure: None,
        }
    }

    fn check(&self) -> Result<(), u64> {
        if self.attempts < 3 {
             return Ok(());
        }

        if let Some(last) = self.last_failure {
            let elapsed = last.elapsed().as_secs();
            // 4th attempt: 1s, 5th: 2s, 6th: 4s ...
            // Formula: 2^(attempts - 4)
            let wait_time = if self.attempts >= 4 {
                2u64.pow(self.attempts - 4)
            } else {
                0
            };
            
            // Cap at 60s
            let wait_time = wait_time.min(60);

            if elapsed < wait_time {
                return Err(wait_time - elapsed);
            }
        }
        Ok(())
    }

    fn record_failure(&mut self) {
        self.attempts += 1;
        self.last_failure = Some(Instant::now());
    }

    fn reset(&mut self) {
        self.attempts = 0;
        self.last_failure = None;
    }
}
