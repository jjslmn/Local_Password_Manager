use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn generate_code(secret_str: &str) -> Result<(String, u64), String> {
    // 1. Decode Secret (Base32)
    // We use RFC4648 without padding check to be more permissive with user input/legacy secrets
    let secret_bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, secret_str)
        .ok_or_else(|| "Invalid Base32 Secret".to_string())?;

    // 2. Get Time
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let step = 30; // 30 second window
    let counter = now / step;
    let ttl = step - (now % step);

    // 3. HMAC-SHA1
    let mut mac = Hmac::<Sha1>::new_from_slice(&secret_bytes)
        .map_err(|e| format!("HMAC Init Error: {}", e))?;
    
    mac.update(&counter.to_be_bytes());
    let result = mac.finalize().into_bytes();

    // 4. Dynamic Truncation (RFC 4226)
    let offset = (result[result.len() - 1] & 0xf) as usize;
    let binary = ((result[offset] as u32 & 0x7f) << 24)
        | ((result[offset + 1] as u32 & 0xff) << 16)
        | ((result[offset + 2] as u32 & 0xff) << 8)
        | (result[offset + 3] as u32 & 0xff);

    let code_int = binary % 1_000_000;

    // 5. Format
    let code = format!("{:06}", code_int);

    Ok((code, ttl))
}
