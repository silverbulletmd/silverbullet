//! Shared constructors for outbound HTTP clients, so every client trusts the
//! same certificates.
//!
//! Clients trust the bundled Mozilla roots plus the operating system's trust
//! store (reqwest's `rustls-tls-native-roots` feature). Two environment
//! variables extend this:
//!
//! * `SB_CA_CERTS`: path to a PEM file with one or more extra CA certificates
//!   to trust, in addition to the defaults.
//! * `SB_ACCEPT_INVALID_CERTS`: when `true`/`1`, skip certificate validation
//!   entirely. Only meant for testing against self-signed setups.

use std::sync::LazyLock;

pub const CA_CERTS_ENV: &str = "SB_CA_CERTS";
pub const ACCEPT_INVALID_CERTS_ENV: &str = "SB_ACCEPT_INVALID_CERTS";

#[derive(Default)]
struct TlsSettings {
    extra_roots: Vec<reqwest::Certificate>,
    accept_invalid_certs: bool,
}

// Read once so a misconfiguration is logged once rather than per client.
static SETTINGS: LazyLock<TlsSettings> = LazyLock::new(|| {
    let settings = TlsSettings {
        extra_roots: std::env::var_os(CA_CERTS_ENV)
            .map(|path| load_ca_bundle(&path))
            .unwrap_or_default(),
        accept_invalid_certs: std::env::var(ACCEPT_INVALID_CERTS_ENV).is_ok_and(|v| is_truthy(&v)),
    };
    if settings.accept_invalid_certs {
        tracing::warn!(
            "{ACCEPT_INVALID_CERTS_ENV} is set: TLS certificates are NOT validated for outbound connections"
        );
    }
    settings
});

fn is_truthy(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn load_ca_bundle(path: &std::ffi::OsStr) -> Vec<reqwest::Certificate> {
    let shown = std::path::Path::new(path).display();
    let pem = match std::fs::read(path) {
        Ok(pem) => pem,
        Err(e) => {
            tracing::error!("Cannot read {CA_CERTS_ENV} file {shown}: {e}");
            return Vec::new();
        }
    };
    match reqwest::Certificate::from_pem_bundle(&pem) {
        Ok(certs) if !certs.is_empty() => {
            tracing::info!(
                "Trusting {} extra CA certificate(s) from {shown}",
                certs.len()
            );
            certs
        }
        Ok(_) => {
            tracing::error!("{CA_CERTS_ENV} file {shown} contains no PEM certificates");
            Vec::new()
        }
        Err(e) => {
            tracing::error!("Invalid {CA_CERTS_ENV} file {shown}: {e}");
            Vec::new()
        }
    }
}

/// An async client builder with the shared TLS trust settings applied.
pub fn client_builder() -> reqwest::ClientBuilder {
    let settings = &*SETTINGS;
    let mut builder = reqwest::Client::builder();
    for cert in &settings.extra_roots {
        builder = builder.add_root_certificate(cert.clone());
    }
    builder.danger_accept_invalid_certs(settings.accept_invalid_certs)
}

/// A blocking client builder with the shared TLS trust settings applied.
pub fn blocking_client_builder() -> reqwest::blocking::ClientBuilder {
    let settings = &*SETTINGS;
    let mut builder = reqwest::blocking::Client::builder();
    for cert in &settings.extra_roots {
        builder = builder.add_root_certificate(cert.clone());
    }
    builder.danger_accept_invalid_certs(settings.accept_invalid_certs)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_CA: &str = "-----BEGIN CERTIFICATE-----
MIIBeTCCAR+gAwIBAgIUIaNk3YuRjvbc5aLxqvkM28PsvUAwCgYIKoZIzj0EAwIw
EjEQMA4GA1UEAwwHdGVzdC1jYTAeFw0yNjExMjMwOTUyMDlaFw0zNjExMjAwOTUy
MDlaMBIxEDAOBgNVBAMMB3Rlc3QtY2EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AATKfIewCH1MT4U5cAknLGDJQFa9ITyCxd3VjrBjVf7bRqL6EfXJ18N3HlsLovj1
C7wT0Dh4ADPePUyIkkDFaE0go1MwUTAdBgNVHQ4EFgQUjwo1iVCYzS36LmKJJrcS
G4aZtKswHwYDVR0jBBgwFoAUjwo1iVCYzS36LmKJJrcSG4aZtKswDwYDVR0TAQH/
BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiA3KSFEuKh5x/O9/jMJR5bfzA3raI7V
dEFZtbRaEhJKKAIhAOujpJuejt9q6QDNlp5oX0Mx0CW1AM1Z4VlcKTxfauzO
-----END CERTIFICATE-----
";

    #[test]
    fn truthy_values() {
        for v in ["1", "true", "TRUE", " yes ", "on"] {
            assert!(is_truthy(v), "{v}");
        }
        for v in ["", "0", "false", "no", "off", "maybe"] {
            assert!(!is_truthy(v), "{v}");
        }
    }

    #[test]
    fn loads_bundle_and_rejects_bad_files() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = dir.path().join("bundle.pem");
        std::fs::write(&bundle, format!("{TEST_CA}{TEST_CA}")).unwrap();
        assert_eq!(load_ca_bundle(bundle.as_os_str()).len(), 2);

        let empty = dir.path().join("empty.pem");
        std::fs::write(&empty, "not a certificate").unwrap();
        assert!(load_ca_bundle(empty.as_os_str()).is_empty());

        assert!(load_ca_bundle(dir.path().join("missing.pem").as_os_str()).is_empty());
    }

    #[test]
    fn builders_build() {
        client_builder().build().unwrap();
        blocking_client_builder().build().unwrap();
    }
}
