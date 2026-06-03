//! AES-256-GCM encrypt/decrypt for the `sb` CLI's stored credentials.
//!
//! The on-disk string format is three base64 (STANDARD alphabet) parts
//! separated by colons: `base64(iv):base64(tag):base64(ciphertext)`. This is
//! the Node.js-style layout where the 16-byte GCM authentication tag is stored
//! separately from the ciphertext (rather than appended, as the `aes-gcm`
//! crate produces it). The IV/nonce is 12 bytes.
//!
//! This format is compatible with the Go implementation in `cli/config.go`
//! (`Encrypt`/`Decrypt`), so tokens written by either tool can be read by the
//! other when they share the same 32-byte key file.
//!
//! The 32-byte AES key is stored as raw bytes in `<config_dir>/key`
//! (mode 0600 on unix), generated on first use.

use std::path::Path;

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

const KEY_LEN: usize = 32;
const IV_LEN: usize = 12;
const TAG_LEN: usize = 16;

/// Encrypt `plaintext` with `key`, producing `base64(iv):base64(tag):base64(ciphertext)`.
pub fn encrypt_with_key(key: &[u8; 32], plaintext: &str) -> Result<String, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));

    let mut iv = [0u8; IV_LEN];
    getrandom::getrandom(&mut iv).map_err(|e| format!("generating iv: {e}"))?;
    let nonce = Nonce::from_slice(&iv);

    let sealed = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("aes-gcm encrypt: {e}"))?;

    // The `aes-gcm` crate appends the 16-byte tag to the ciphertext. Split it
    // back out to match the Node.js/Go on-disk format.
    let tag_start = sealed.len().saturating_sub(TAG_LEN);
    let (ct, tag) = sealed.split_at(tag_start);

    Ok(format!(
        "{}:{}:{}",
        B64.encode(iv),
        B64.encode(tag),
        B64.encode(ct)
    ))
}

/// Decrypt an `base64(iv):base64(tag):base64(ciphertext)` string with `key`.
pub fn decrypt_with_key(key: &[u8; 32], encoded: &str) -> Result<String, String> {
    let mut parts = encoded.splitn(3, ':');
    let iv_b64 = parts.next().ok_or("invalid encrypted format")?;
    let tag_b64 = parts.next().ok_or("invalid encrypted format")?;
    let ct_b64 = parts.next().ok_or("invalid encrypted format")?;

    let iv = B64
        .decode(iv_b64)
        .map_err(|e| format!("decoding iv: {e}"))?;
    let tag = B64
        .decode(tag_b64)
        .map_err(|e| format!("decoding tag: {e}"))?;
    let ct = B64
        .decode(ct_b64)
        .map_err(|e| format!("decoding ciphertext: {e}"))?;

    if iv.len() != IV_LEN || tag.len() != TAG_LEN {
        return Err("invalid encrypted format".to_string());
    }

    // Re-append the tag to the ciphertext, the layout `aes-gcm` expects.
    let mut sealed = ct;
    sealed.extend_from_slice(&tag);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(&iv);
    let pt = cipher
        .decrypt(nonce, sealed.as_ref())
        .map_err(|e| format!("aes-gcm decrypt: {e}"))?;

    String::from_utf8(pt).map_err(|e| format!("decrypted bytes are not valid utf-8: {e}"))
}

/// Load the AES key from `<config_dir>/key`, generating and persisting a fresh
/// 32-byte random key if the file is missing. On unix the key file is written
/// with mode 0600.
pub fn load_or_create_key(config_dir: &Path) -> Result<[u8; KEY_LEN], String> {
    let path = config_dir.join("key");

    match std::fs::read(&path) {
        Ok(bytes) => {
            if bytes.len() != KEY_LEN {
                return Err(format!(
                    "key file {} has wrong length: expected {KEY_LEN}, got {}",
                    path.display(),
                    bytes.len()
                ));
            }
            let mut out = [0u8; KEY_LEN];
            out.copy_from_slice(&bytes);
            Ok(out)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(config_dir)
                .map_err(|e| format!("creating config dir {}: {e}", config_dir.display()))?;
            let mut key = [0u8; KEY_LEN];
            getrandom::getrandom(&mut key).map_err(|e| format!("generating key: {e}"))?;
            write_private(&path, &key)
                .map_err(|e| format!("writing key file {}: {e}", path.display()))?;
            Ok(key)
        }
        Err(e) => Err(format!("reading key file {}: {e}", path.display())),
    }
}

/// Write `bytes` to `path` with owner-only permissions (mode 0600) on unix.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        f.write_all(bytes)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let key = [7u8; 32];
        let ct = encrypt_with_key(&key, "s3cret-token").unwrap();
        assert_eq!(ct.split(':').count(), 3, "format is iv:tag:ct");
        assert_eq!(decrypt_with_key(&key, &ct).unwrap(), "s3cret-token");
    }

    #[test]
    fn wrong_key_fails() {
        let ct = encrypt_with_key(&[1u8; 32], "x").unwrap();
        assert!(decrypt_with_key(&[2u8; 32], &ct).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let key = [3u8; 32];
        let mut ct = encrypt_with_key(&key, "hello").unwrap();
        ct.push('A');
        assert!(decrypt_with_key(&key, &ct).is_err());
    }

    #[test]
    fn key_file_is_created_and_stable() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = load_or_create_key(dir.path()).unwrap();
        let k2 = load_or_create_key(dir.path()).unwrap();
        assert_eq!(k1, k2, "key must persist across loads");
        assert!(dir.path().join("key").exists());
    }

    #[cfg(unix)]
    #[test]
    fn key_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        load_or_create_key(dir.path()).unwrap();
        let mode = std::fs::metadata(dir.path().join("key"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    // Frozen cross-impl fixture: a literal `base64(iv):base64(tag):base64(ct)`
    // string that the Go `cli/config.go` `Encrypt` and the App's
    // `src/auth_config.rs` `encrypt_with_key` both emit for this exact
    // key+iv+plaintext. AES-256-GCM is fully deterministic given a fixed
    // key+nonce, and all three impls share the identical byte layout (12-byte
    // IV, 16-byte tag stored separately, STANDARD base64), so this literal is
    // reproducible by any of them. Decrypting it here proves our byte layout
    // matches the reference impls without needing to run them.
    //
    // Fixture parameters: key = [0x01; 32], iv = [0x02; 12],
    // plaintext = "hello world".
    const FIXTURE_KEY: [u8; 32] = [1u8; 32];
    const FIXTURE: &str = "AgICAgICAgICAgIC:UHsi9GfW1lrkYcA+fUy0Jw==:b7OlJSV3tpKhoNg=";

    #[test]
    fn decrypts_value_from_reference_impl() {
        assert_eq!(
            decrypt_with_key(&FIXTURE_KEY, FIXTURE).unwrap(),
            "hello world",
            "cross-impl fixture must decrypt to the known plaintext"
        );
    }
}
