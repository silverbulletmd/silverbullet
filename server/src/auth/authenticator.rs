use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

/// Claims carried in a session JWT.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub username: String,
    /// Expiry, Unix seconds (validated automatically).
    pub exp: usize,
}

/// Issues and verifies HS256 session tokens with a persisted signing secret.
pub struct Authenticator {
    secret: Vec<u8>,
    /// Base64 of 16 random bytes; stable across auth-config changes. Handed to
    /// the login page so the browser can derive a content-encryption key.
    salt: String,
    /// Hex SHA-256 of the auth config that produced this secret; used to detect
    /// config changes.
    #[allow(dead_code)]
    pub(crate) config_hash: String,
}

/// On-disk shape of `.silverbullet.auth.json` (modernized; not compatible with
/// the legacy format — existing deployments re-authenticate once).
#[derive(serde::Serialize, serde::Deserialize)]
struct AuthFile {
    /// Base64 of the raw HS256 secret bytes.
    secret: String,
    /// Hex SHA-256 of the auth config that generated `secret`.
    config_hash: String,
    /// Base64 of 16 random bytes; stable across config changes.
    #[serde(default)]
    salt: String,
}

const AUTH_FILE_NAME: &str = ".silverbullet.auth.json";

impl Authenticator {
    /// Construct from raw secret bytes with an empty salt (test/legacy helper).
    pub fn from_secret_bytes(secret: Vec<u8>, config_hash: String) -> Self {
        Self::from_parts(secret, String::new(), config_hash)
    }

    /// Construct from secret + base64 salt + config hash.
    pub fn from_parts(secret: Vec<u8>, salt: String, config_hash: String) -> Self {
        Self {
            secret,
            salt,
            config_hash,
        }
    }

    /// The base64 encryption salt handed to the login page.
    pub fn salt(&self) -> &str {
        &self.salt
    }

    /// Issue a token for `username` expiring `expiry_secs` from now.
    pub fn issue_jwt(
        &self,
        username: &str,
        expiry_secs: u64,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let exp = now_secs().saturating_add(expiry_secs) as usize;
        self.issue_jwt_with_exp(username, exp)
    }

    /// Issue a token with an explicit absolute `exp` (Unix seconds). Exposed for
    /// deterministic tests.
    pub fn issue_jwt_with_exp(
        &self,
        username: &str,
        exp: usize,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let claims = Claims {
            username: username.to_string(),
            exp,
        };
        encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(&self.secret),
        )
    }

    /// Verify a token's signature and expiry, returning its claims.
    ///
    /// Validation uses the library defaults: signature is verified, `exp` is
    /// required and enforced (with the default ±60s clock-skew leeway), and the
    /// algorithm is pinned to HS256 (so `alg=none` / algorithm-confusion tokens
    /// are rejected).
    pub fn verify_jwt(&self, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        let data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(&self.secret),
            &Validation::new(Algorithm::HS256),
        )?;
        Ok(data.claims)
    }

    /// Load the signing secret from `<space_dir>/.silverbullet.auth.json`,
    /// generating (and persisting) a fresh one when the file is absent or when
    /// the stored config hash no longer matches `config` (which invalidates all
    /// previously-issued tokens). The salt is always read from the existing file
    /// and only regenerated when it is absent — ensuring it survives config
    /// changes. If the file cannot be written (e.g. a read-only space) a fresh
    /// ephemeral secret is used and a warning is logged — sessions then do not
    /// survive a restart.
    pub fn load_or_init(
        space_dir: &Path,
        config: &crate::auth::config::AuthConfig,
    ) -> std::io::Result<Self> {
        let path = space_dir.join(AUTH_FILE_NAME);
        let want_hash = config.security_hash();

        let existing: Option<AuthFile> = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<AuthFile>(&bytes).ok());

        let secret = existing
            .as_ref()
            .filter(|f| f.config_hash == want_hash)
            .and_then(|f| {
                base64::engine::general_purpose::STANDARD
                    .decode(&f.secret)
                    .ok()
            });
        let (secret, secret_fresh) = match secret {
            Some(s) => (s, false),
            None => {
                if existing.is_some() {
                    tracing::info!(
                        "auth config changed or file unreadable; regenerating signing secret"
                    );
                }
                (random_bytes(32), true)
            }
        };

        let stored_salt = existing
            .as_ref()
            .map(|f| f.salt.clone())
            .filter(|s| !s.is_empty());
        let (salt, salt_fresh) = match stored_salt {
            Some(s) => (s, false),
            None => (
                base64::engine::general_purpose::STANDARD.encode(random_bytes(16)),
                true,
            ),
        };

        let auth = Self::from_parts(secret.clone(), salt.clone(), want_hash.clone());

        if existing.is_none() || secret_fresh || salt_fresh {
            let file = AuthFile {
                secret: base64::engine::general_purpose::STANDARD.encode(&secret),
                config_hash: want_hash,
                salt,
            };
            match serde_json::to_vec_pretty(&file)
                .map_err(std::io::Error::other)
                .and_then(|b| write_private(&path, &b))
            {
                Ok(()) => {}
                Err(e) => tracing::warn!(
                    "could not persist {AUTH_FILE_NAME}: {e}; using an ephemeral secret"
                ),
            }
        }
        Ok(auth)
    }
}

/// Write `bytes` to `path` with owner-only permissions (`0600` on Unix), so the
/// persisted signing secret is not readable by other local users. New files are
/// created `0600` directly; a pre-existing file has its mode tightened before
/// the secret is written, leaving no window where it is world-readable.
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

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    getrandom::getrandom(&mut buf).expect("OS RNG must be available");
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::config::AuthConfig;
    use tempfile::tempdir;

    fn fresh() -> Authenticator {
        Authenticator::from_secret_bytes(vec![7u8; 32], "hash-abc".into())
    }

    fn cfg(token: &str) -> AuthConfig {
        AuthConfig::try_parse(Some("u:p"), Some(token), None, None, None)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn issued_token_verifies_and_round_trips_username() {
        let a = fresh();
        let token = a.issue_jwt("alice", 3600).unwrap();
        let claims = a.verify_jwt(&token).unwrap();
        assert_eq!(claims.username, "alice");
    }

    #[test]
    fn expired_token_is_rejected() {
        let a = fresh();
        // exp in the past.
        let token = a.issue_jwt_with_exp("bob", 1_000).unwrap();
        assert!(a.verify_jwt(&token).is_err());
    }

    #[test]
    fn token_signed_with_other_secret_is_rejected() {
        let a = fresh();
        let other = Authenticator::from_secret_bytes(vec![9u8; 32], "hash-xyz".into());
        let token = other.issue_jwt("eve", 3600).unwrap();
        assert!(a.verify_jwt(&token).is_err());
    }

    #[test]
    fn tampered_token_is_rejected() {
        let a = fresh();
        let mut token = a.issue_jwt("alice", 3600).unwrap();
        token.push('x');
        assert!(a.verify_jwt(&token).is_err());
    }

    #[test]
    fn secret_persists_across_reloads() {
        let dir = tempdir().unwrap();
        let c = cfg("t1");
        let a1 = Authenticator::load_or_init(dir.path(), &c).unwrap();
        let token = a1.issue_jwt("alice", 3600).unwrap();
        // Reload with the SAME config: the persisted secret is reused, so the
        // earlier token still verifies.
        let a2 = Authenticator::load_or_init(dir.path(), &c).unwrap();
        assert_eq!(a2.verify_jwt(&token).unwrap().username, "alice");
    }

    #[test]
    fn changing_config_invalidates_tokens() {
        let dir = tempdir().unwrap();
        let a1 = Authenticator::load_or_init(dir.path(), &cfg("t1")).unwrap();
        let token = a1.issue_jwt("alice", 3600).unwrap();
        // Reload with a DIFFERENT config (token changed) → secret regenerated →
        // the old token no longer verifies.
        let a2 = Authenticator::load_or_init(dir.path(), &cfg("t2")).unwrap();
        assert!(a2.verify_jwt(&token).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn auth_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        Authenticator::load_or_init(dir.path(), &cfg("t1")).unwrap();
        let meta = std::fs::metadata(dir.path().join(AUTH_FILE_NAME)).unwrap();
        assert_eq!(
            meta.permissions().mode() & 0o777,
            0o600,
            "the persisted signing secret must not be world-readable"
        );
    }

    #[test]
    fn salt_is_present_and_stable_across_reloads() {
        let dir = tempdir().unwrap();
        let c = cfg("t1");
        let a1 = Authenticator::load_or_init(dir.path(), &c).unwrap();
        let salt1 = a1.salt().to_string();
        assert!(!salt1.is_empty(), "a fresh authenticator must have a salt");
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&salt1)
            .unwrap();
        assert_eq!(raw.len(), 16);
        let a2 = Authenticator::load_or_init(dir.path(), &c).unwrap();
        assert_eq!(a2.salt(), salt1);
    }

    #[test]
    fn salt_survives_a_config_change_even_though_secret_rotates() {
        let dir = tempdir().unwrap();
        let a1 = Authenticator::load_or_init(dir.path(), &cfg("t1")).unwrap();
        let token = a1.issue_jwt("alice", 3600).unwrap();
        let salt1 = a1.salt().to_string();
        let a2 = Authenticator::load_or_init(dir.path(), &cfg("t2")).unwrap();
        assert!(a2.verify_jwt(&token).is_err(), "secret must rotate");
        assert_eq!(a2.salt(), salt1, "salt must be stable");
    }
}
