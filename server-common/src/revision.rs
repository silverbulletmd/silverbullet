use sha2::{Digest, Sha256};

pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

pub fn etag_for_hash(hash: &str) -> String {
    format!("\"sha256:{hash}\"")
}

pub fn hash_from_etag(etag: &str) -> Option<String> {
    let s = etag.trim();
    if s.starts_with("W/") {
        return None;
    }
    let s = s.trim_matches('"');
    s.strip_prefix("sha256:").map(str::to_ascii_lowercase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_known_vector() {
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn etag_roundtrip() {
        let etag = etag_for_hash("abc123");
        assert_eq!(etag, "\"sha256:abc123\"");
        assert_eq!(hash_from_etag(&etag).as_deref(), Some("abc123"));
    }

    #[test]
    fn etag_parse_lenient_but_not_weak() {
        assert_eq!(hash_from_etag("sha256:ff00").as_deref(), Some("ff00"));
        assert_eq!(hash_from_etag("\"sha256:ff00\"").as_deref(), Some("ff00"));
        assert_eq!(hash_from_etag("W/\"sha256:ff00\""), None);
        assert_eq!(hash_from_etag("\"md5:ff00\""), None);
        assert_eq!(hash_from_etag("*"), None);
    }

    #[test]
    fn etag_parse_normalizes_hex_case() {
        assert_eq!(
            hash_from_etag("\"sha256:FF00AB\"").as_deref(),
            Some("ff00ab")
        );
    }
}
