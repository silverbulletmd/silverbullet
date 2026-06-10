//! Connection resolution and authentication for the `sb` CLI.
//!
//! This module provides [`SpaceConnection`] — an authenticated HTTP client
//! bound to a SilverBullet server URL — and [`resolve`], which builds one from
//! the parsed CLI flags and loaded config.

use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder};

use crate::{
    cli::GlobalFlags,
    config::{self, Config},
    crypto,
};

// ---------------------------------------------------------------------------
// Auth enum
// ---------------------------------------------------------------------------

/// Credentials to attach to outgoing requests.
#[derive(Debug, Clone)]
pub enum Auth {
    /// No authentication.
    None,
    /// HTTP `Authorization: Bearer <token>` header.
    Bearer(String),
    /// HTTP `Cookie: <name>=<value>` header (JWT session cookie).
    Cookie { name: String, value: String },
}

// ---------------------------------------------------------------------------
// SpaceConnection
// ---------------------------------------------------------------------------

/// An authenticated reqwest client bound to a SilverBullet server.
pub struct SpaceConnection {
    pub client: Client,
    /// Server base URL with no trailing slash.
    pub base_url: String,
    pub auth: Auth,
    pub timeout: Duration,
}

impl SpaceConnection {
    /// Apply auth credentials to a [`RequestBuilder`], returning the modified builder.
    pub fn apply_auth(&self, req: RequestBuilder) -> RequestBuilder {
        match &self.auth {
            Auth::None => req,
            Auth::Bearer(token) => req.header("Authorization", format!("Bearer {token}")),
            Auth::Cookie { name, value } => req.header("Cookie", format!("{name}={value}")),
        }
    }
}

// ---------------------------------------------------------------------------
// login_for_jwt
// ---------------------------------------------------------------------------

/// POST `{base}/.auth` with form-encoded credentials, return `(cookie_name, jwt)`.
///
/// The response must set a `Set-Cookie` header containing a part that begins
/// with `auth_`.  Redirects must be disabled on `client` so we can read the
/// `Set-Cookie` directly (the Rust server sets the cookie on the redirect
/// response, not the final page).
pub fn login_for_jwt(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
) -> Result<(String, String), String> {
    let body = format!(
        "username={}&password={}",
        url_encode(username),
        url_encode(password),
    );
    let resp = client
        .post(format!("{base_url}/.auth"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|e| format!("login request failed: {e}"))?;

    let status = resp.status().as_u16();
    let set_cookie = resp
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if set_cookie.is_empty() {
        return Err(format!(
            "login failed (status {status}): no auth cookie returned"
        ));
    }

    // Parse "auth_xxx=<jwt>; Path=/; HttpOnly" — look for the part beginning
    // with "auth_".
    for part in set_cookie.split(';') {
        let part = part.trim();
        if part.starts_with("auth_") {
            if let Some(eq) = part.find('=') {
                let name = part[..eq].to_string();
                let value = part[eq + 1..].to_string();
                return Ok((name, value));
            }
        }
    }

    Err("login failed: could not extract auth token from cookie".to_string())
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/// Build the shared reqwest blocking client (redirects disabled, given timeout).
pub fn new_client(timeout: std::time::Duration) -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|e| format!("building http client: {e}"))
}

/// Build a [`SpaceConnection`] from the shared [`GlobalFlags`] and loaded config.
///
/// Takes `&GlobalFlags` (not `&Cli`) so a downstream binary — the App's CLI —
/// can flatten the same flags into its own parser and reuse this resolver
/// unchanged.
///
/// Resolution order:
/// 1. If `--url` is set, use it directly (with optional `--token`).
/// 2. Otherwise, call [`config::resolve_space`] to find the configured space
///    and decrypt credentials.
///
/// If `--token` is set even when resolving a named space, it takes priority.
pub fn resolve(flags: &GlobalFlags, cfg: &Config) -> Result<SpaceConnection, String> {
    let timeout = Duration::from_secs(flags.timeout);

    // Build a client with redirects disabled and the configured timeout.
    let client = new_client(timeout)?;

    if let Some(ref raw_url) = flags.url {
        // --url was given: skip config lookup entirely.
        let base_url = raw_url.trim_end_matches('/').to_string();
        let auth = flags.token.clone().map(Auth::Bearer).unwrap_or(Auth::None);
        return Ok(SpaceConnection {
            client,
            base_url,
            auth,
            timeout,
        });
    }

    // Load config and find the space.
    let space = config::resolve_space(cfg, flags.space.as_deref())?;
    let base_url = space.url.trim_end_matches('/').to_string();

    // A space with no URL is folder-based: it's served by a local SilverBullet
    // app instance on a per-space port, and resolving that (ping/launch the app,
    // inject the localhost URL + token) is App-CLI logic the standalone Core
    // `sb` deliberately does not implement. Fail with a clear message instead of
    // letting reqwest choke on an empty base URL ("builder error").
    if base_url.is_empty() {
        return Err(format!(
            "space \"{}\" has no URL — it is a folder-based space served by the \
             SilverBullet app. Open it in the app, pass --url <url>, or select a \
             space that has a URL.",
            space.name
        ));
    }

    // --token always wins, even for named spaces.
    if let Some(ref tok) = flags.token {
        return Ok(SpaceConnection {
            client,
            base_url,
            auth: Auth::Bearer(tok.clone()),
            timeout,
        });
    }

    let auth = match space.auth.method.as_str() {
        "token" if !space.auth.encrypted_token.is_empty() => {
            let key = crypto::load_or_create_key(&config::config_dir())
                .map_err(|e| format!("loading encryption key: {e}"))?;
            let token = crypto::decrypt_with_key(&key, &space.auth.encrypted_token)
                .map_err(|e| decrypt_failure_msg("token", &space.name, e))?;
            Auth::Bearer(token)
        }
        "password" => {
            let key = crypto::load_or_create_key(&config::config_dir())
                .map_err(|e| format!("loading encryption key: {e}"))?;
            let password = crypto::decrypt_with_key(&key, &space.auth.encrypted_password)
                .map_err(|e| decrypt_failure_msg("password", &space.name, e))?;
            let (cookie_name, jwt) =
                login_for_jwt(&client, &base_url, &space.auth.username, &password)?;
            Auth::Cookie {
                name: cookie_name,
                value: jwt,
            }
        }
        _ => Auth::None,
    };

    Ok(SpaceConnection {
        client,
        base_url,
        auth,
        timeout,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a helpful error when a stored credential can't be decrypted: an
/// authentication-tag failure almost always means
/// the key file was regenerated, or the secret was encrypted on a different
/// machine / an older SilverBullet that used the legacy hostname-derived key.
/// Point the user at re-adding the space rather than leaving a bare `aead::Error`.
fn decrypt_failure_msg(what: &str, space_name: &str, inner: impl std::fmt::Display) -> String {
    let key_path = config::config_dir().join("key");
    format!(
        "decrypting {what} for space \"{space_name}\" failed: {inner}\n\n\
         This usually means the encryption key file at {} was regenerated, or the\n\
         secret was encrypted on a different machine or an older SilverBullet version.\n\
         To recover, re-add this space's credentials (e.g. `sb space rm {space_name}`\n\
         then `sb space add`, or update the password in the SilverBullet app).",
        key_path.display()
    )
}

/// Percent-encode a string for use in an `application/x-www-form-urlencoded`
/// body.  We only encode the characters that must be encoded; ASCII
/// alphanumerics and `*`, `-`, `.`, `_` are left as-is per RFC 3986 / HTML5
/// percent-encoding.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'*' => {
                out.push(byte as char);
            }
            b' ' => out.push('+'),
            b => {
                use std::fmt::Write as _;
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
    };

    // -----------------------------------------------------------------------
    // Minimal mock HTTP server helpers
    // -----------------------------------------------------------------------

    /// A recorded HTTP request from the mock server.
    #[derive(Debug)]
    struct RecordedRequest {
        method: String,
        path: String,
        body: Vec<u8>,
    }

    /// Spawn a one-shot mock HTTP server that accepts exactly one connection,
    /// records the request, and returns the given response.
    ///
    /// Returns `(base_url, join_handle)`.  Call `.join()` on the handle to
    /// retrieve the [`RecordedRequest`].
    fn mock_server(response: &'static str) -> (String, thread::JoinHandle<RecordedRequest>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let port = listener.local_addr().unwrap().port();
        let base_url = format!("http://127.0.0.1:{port}");

        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
            let mut writer = stream;

            // Read request line
            let mut req_line = String::new();
            reader.read_line(&mut req_line).unwrap();
            let mut parts = req_line.trim().splitn(3, ' ');
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();

            // Read headers (parse content-length only; we don't need to store them)
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(colon) = trimmed.find(':') {
                    let name = trimmed[..colon].trim();
                    let value = trimmed[colon + 1..].trim();
                    if name.to_lowercase() == "content-length" {
                        content_length = value.parse().unwrap_or(0);
                    }
                }
            }

            // Read body up to Content-Length
            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                use std::io::Read;
                reader.read_exact(&mut body).unwrap();
            }

            // Write the canned response
            writer.write_all(response.as_bytes()).unwrap();

            RecordedRequest { method, path, body }
        });

        (base_url, handle)
    }

    // -----------------------------------------------------------------------
    // login_for_jwt
    // -----------------------------------------------------------------------

    #[test]
    fn login_for_jwt_parses_cookie() {
        let response = concat!(
            "HTTP/1.1 302 Found\r\n",
            "Set-Cookie: auth_host=theJWT; Path=/; HttpOnly\r\n",
            "Content-Length: 0\r\n",
            "\r\n",
        );
        let (base_url, handle) = mock_server(response);
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let (name, value) = login_for_jwt(&client, &base_url, "alice", "s3cr3t").unwrap();
        let req = handle.join().unwrap();
        assert_eq!(name, "auth_host");
        assert_eq!(value, "theJWT");
        assert_eq!(req.method, "POST");
        assert!(req.path.contains(".auth"));
        // Form body should be URL-encoded
        let body_str = String::from_utf8(req.body).unwrap();
        assert!(body_str.contains("username=alice"));
        assert!(body_str.contains("password=s3cr3t"));
    }

    #[test]
    fn login_for_jwt_no_cookie_errors() {
        let response = concat!(
            "HTTP/1.1 401 Unauthorized\r\n",
            "Content-Length: 0\r\n",
            "\r\n",
        );
        let (base_url, handle) = mock_server(response);
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let err = login_for_jwt(&client, &base_url, "bad", "pw").unwrap_err();
        let _ = handle.join();
        assert!(err.contains("no auth cookie returned"), "err was: {err}");
    }

    // -----------------------------------------------------------------------
    // url_encode
    // -----------------------------------------------------------------------

    #[test]
    fn url_encode_basic() {
        assert_eq!(url_encode("hello world"), "hello+world");
        assert_eq!(url_encode("a@b"), "a%40b");
        assert_eq!(url_encode("safe-._*"), "safe-._*");
    }
}
