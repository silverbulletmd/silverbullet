//! Cookie-name derivation and `Set-Cookie` construction for the standalone
//! server's session cookies. The cookie name is derived from the request
//! `Host` and the space's URL prefix (`auth_<host><prefix>`), so a browser
//! keeps one session per host:port and per prefix-bound space sharing a host.
//! An empty prefix yields the legacy host-only `auth_<host>` name.

use axum::http::HeaderMap;
use regex::Regex;
use std::sync::OnceLock;

/// `auth_<host><prefix>` with every non-word (`\W`) char replaced by `_`.
/// The prefix slug keeps sessions separate when multiple spaces share a host
/// under different URL prefixes. Empty prefix ⇒ the legacy `auth_<host>` name.
pub fn scoped_auth_cookie_name(host: &str, url_prefix: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\W").unwrap());
    format!(
        "auth_{}{}",
        re.replace_all(host, "_"),
        re.replace_all(url_prefix, "_")
    )
}

/// Legacy unscoped name (single-space servers without a URL prefix).
pub fn auth_cookie_name(host: &str) -> String {
    scoped_auth_cookie_name(host, "")
}

/// The request `Host` header, or `""` when absent.
pub fn request_host(headers: &HeaderMap) -> String {
    headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

/// Whether the request arrived over TLS, accounting for an upstream proxy that
/// terminates TLS and forwards `X-Forwarded-Proto: https`. Direct-TLS detection
/// is intentionally out of scope here: it
/// is not observable from the request headers alone, and this server is meant to
/// run behind a TLS-terminating proxy.
pub fn is_secure_request(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

/// Attributes for a `Set-Cookie` header value.
pub struct CookieOptions {
    pub path: String,
    /// Seconds until expiry. `Some(0)` (or negative) deletes the cookie;
    /// `None` makes a session cookie.
    pub max_age_secs: Option<i64>,
    pub http_only: bool,
    pub secure: bool,
    pub same_site: &'static str,
}

/// Build a `Set-Cookie` header *value* (`name=value; attributes…`).
pub fn set_cookie_value(name: &str, value: &str, opts: &CookieOptions) -> String {
    let mut s = format!(
        "{name}={value}; Path={}; SameSite={}",
        opts.path, opts.same_site
    );
    if let Some(age) = opts.max_age_secs {
        s.push_str(&format!("; Max-Age={age}"));
    }
    if opts.http_only {
        s.push_str("; HttpOnly");
    }
    if opts.secure {
        s.push_str("; Secure");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn cookie_name_sanitizes_host() {
        assert_eq!(auth_cookie_name("localhost:3000"), "auth_localhost_3000");
        assert_eq!(auth_cookie_name("example.com"), "auth_example_com");
        assert_eq!(auth_cookie_name(""), "auth_");
    }

    #[test]
    fn request_host_reads_header_or_empty() {
        let mut h = HeaderMap::new();
        assert_eq!(request_host(&h), "");
        h.insert("host", HeaderValue::from_static("h:8080"));
        assert_eq!(request_host(&h), "h:8080");
    }

    #[test]
    fn secure_only_when_forwarded_https() {
        let mut h = HeaderMap::new();
        assert!(!is_secure_request(&h));
        h.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        assert!(is_secure_request(&h));
        h.insert("x-forwarded-proto", HeaderValue::from_static("http"));
        assert!(!is_secure_request(&h));
    }

    #[test]
    fn set_cookie_value_includes_attributes() {
        let opts = CookieOptions {
            path: "/".into(),
            max_age_secs: Some(3600),
            http_only: true,
            secure: false,
            same_site: "Lax",
        };
        let v = set_cookie_value("auth_h", "jwt", &opts);
        assert!(v.starts_with("auth_h=jwt; Path=/; SameSite=Lax"));
        assert!(v.contains("; Max-Age=3600"));
        assert!(v.contains("; HttpOnly"));
        assert!(!v.contains("; Secure"));
    }

    #[test]
    fn delete_cookie_uses_zero_max_age() {
        let opts = CookieOptions {
            path: "/".into(),
            max_age_secs: Some(0),
            http_only: true,
            secure: false,
            same_site: "Lax",
        };
        let v = set_cookie_value("auth_h", "", &opts);
        assert!(v.contains("; Max-Age=0"));
    }

    #[test]
    fn scoped_name_with_empty_prefix_matches_legacy() {
        assert_eq!(
            scoped_auth_cookie_name("localhost:3000", ""),
            auth_cookie_name("localhost:3000")
        );
        assert_eq!(scoped_auth_cookie_name("localhost", ""), "auth_localhost");
    }

    #[test]
    fn scoped_name_slugifies_prefix() {
        assert_eq!(
            scoped_auth_cookie_name("localhost", "/work"),
            "auth_localhost_work"
        );
        assert_eq!(
            scoped_auth_cookie_name("h.example.com", "/a/b"),
            "auth_h_example_com_a_b"
        );
        assert_eq!(
            scoped_auth_cookie_name("localhost", "/.admin"),
            "auth_localhost__admin"
        );
    }
}
