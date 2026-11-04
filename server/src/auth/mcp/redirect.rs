//! Redirect URI rules for MCP clients. A redirect must be declared by the
//! client (CIMD document or registration). https redirects match exactly;
//! loopback http redirects match on scheme, host, path and query with the port
//! ignored (RFC 8252 §7.3), since native clients pick a free port per sign-in.
//! `localhost` counts as loopback here, unlike the legacy flow, because
//! Claude Code and Codex register `http://localhost:<port>/callback`.

use reqwest::Url;

pub fn is_loopback_redirect(uri: &Url) -> bool {
    uri.scheme() == "http" && matches!(uri.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"))
}

pub fn redirect_allowed(requested: &str, declared: &[String]) -> bool {
    // Non-printable bytes would otherwise fail later, while building the
    // Location header.
    if requested.bytes().any(|b| !(0x21..=0x7e).contains(&b)) || requested.contains('#') {
        return false;
    }
    let Ok(url) = Url::parse(requested) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.scheme() == "https" {
        return declared.iter().any(|d| d == requested);
    }
    if !is_loopback_redirect(&url) {
        return false;
    }
    declared.iter().any(|d| {
        Url::parse(d).is_ok_and(|d| {
            is_loopback_redirect(&d)
                && d.username().is_empty()
                && d.password().is_none()
                && d.fragment().is_none()
                && d.host_str() == url.host_str()
                && d.path() == url.path()
                && d.query() == url.query()
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(requested: &str, declared: &[&str]) -> bool {
        let declared: Vec<String> = declared.iter().map(|d| d.to_string()).collect();
        redirect_allowed(requested, &declared)
    }

    #[test]
    fn redirect_rules() {
        let https = ["https://client.example/cb"];
        assert!(allowed("https://client.example/cb", &https));
        assert!(!allowed("https://client.example/cb/", &https));
        assert!(!allowed("https://client.example/cb?x=1", &https));
        assert!(!allowed(
            "https://client.example/cb#x",
            &["https://client.example/cb#x"]
        ));

        let loopback = ["http://localhost/callback"];
        assert!(allowed("http://localhost:53682/callback", &loopback));
        assert!(allowed("http://localhost/callback", &loopback));
        assert!(!allowed("http://localhost:53682/other", &loopback));
        assert!(!allowed("http://127.0.0.1:53682/callback", &loopback));
        assert!(!allowed("http://localhost:53682/callback?x=1", &loopback));
        assert!(!allowed("http://localhost:53682/callback#x", &loopback));
        assert!(!allowed("https://localhost:53682/callback", &loopback));
        assert!(allowed(
            "http://127.0.0.1:1234/cb?a=b",
            &["http://127.0.0.1/cb?a=b"]
        ));
        assert!(allowed("http://[::1]:1234/cb", &["http://[::1]:9/cb"]));

        assert!(!allowed("http://localhost:53682/callback", &[]));
        assert!(!allowed("http://localhost:53682/callback", &https));
        assert!(!allowed(
            "http://client.example/cb",
            &["http://client.example/cb"]
        ));
        assert!(!allowed(
            "http://user@localhost:1/callback",
            &["http://user@localhost/callback"]
        ));
        assert!(!allowed(
            "https://user:pw@client.example/cb",
            &["https://user:pw@client.example/cb"]
        ));
        assert!(!allowed(
            "https://client.example/c b",
            &["https://client.example/c b"]
        ));
        assert!(!allowed(
            "https://client.example/cb\r\nX: 1",
            &["https://client.example/cb\r\nX: 1"]
        ));
    }

    #[test]
    fn loopback_hosts() {
        for (uri, expected) in [
            ("http://127.0.0.1:1/cb", true),
            ("http://[::1]:1/cb", true),
            ("http://localhost:1/cb", true),
            ("https://localhost:1/cb", false),
            ("http://127.0.0.1.client.example/cb", false),
            ("http://localhost.client.example/cb", false),
            ("http://10.0.0.1/cb", false),
        ] {
            assert_eq!(
                is_loopback_redirect(&Url::parse(uri).unwrap()),
                expected,
                "{uri}"
            );
        }
    }
}
