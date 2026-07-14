//! Argon2id password hashing for multi-space per-space credentials. PHC-format
//! strings (`$argon2id$v=19$…`) are stored in `spaces.json`; plaintext never
//! lands on disk in multi-space mode.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

/// Hash a plaintext password to an argon2id PHC string (default params).
pub fn hash_password(plain: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("password hashing failed: {e}"))
}

/// Verify a plaintext password against a PHC string. Any parse/verify error is
/// a mismatch (never panics on malformed input).
pub fn verify_password(plain: &str, phc: &str) -> bool {
    PasswordHash::new(phc)
        .map(|h| {
            Argon2::default()
                .verify_password(plain.as_bytes(), &h)
                .is_ok()
        })
        .unwrap_or(false)
}

/// Whether `phc` parses as a valid PHC hash string (config validation).
pub fn is_valid_phc(phc: &str) -> bool {
    PasswordHash::new(phc).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_verifies_and_wrong_password_fails() {
        let phc = hash_password("s3cret").unwrap();
        assert!(phc.starts_with("$argon2id$"), "{phc}");
        assert!(verify_password("s3cret", &phc));
        assert!(!verify_password("wrong", &phc));
    }

    #[test]
    fn hashes_are_salted_uniquely() {
        assert_ne!(hash_password("x").unwrap(), hash_password("x").unwrap());
    }

    #[test]
    fn phc_validity_check() {
        assert!(is_valid_phc(&hash_password("x").unwrap()));
        assert!(!is_valid_phc("not-a-hash"));
        assert!(!is_valid_phc(""));
    }

    #[test]
    fn garbage_phc_never_verifies() {
        assert!(!verify_password("x", "garbage"));
    }
}
