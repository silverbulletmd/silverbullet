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

/// An authenticated reqwest client bound to a SilverBullet server.
pub struct SpaceConnection {
    pub client: Client,
    /// Server base URL with no trailing slash.
    pub base_url: String,
    pub auth: Auth,
    pub timeout: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ConnectionError {
    pub authentication: bool,
    pub message: String,
}

impl ConnectionError {
    pub fn authentication(message: impl Into<String>) -> Self {
        Self {
            authentication: true,
            message: message.into(),
        }
    }

    pub fn operational(message: impl Into<String>) -> Self {
        Self {
            authentication: false,
            message: message.into(),
        }
    }
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
    login_for_jwt_typed(client, base_url, username, password).map_err(|error| error.message)
}

fn login_for_jwt_typed(
    client: &Client,
    base_url: &str,
    username: &str,
    password: &str,
) -> Result<(String, String), ConnectionError> {
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
        .map_err(|error| ConnectionError::operational(format!("login request failed: {error}")))?;

    let status = resp.status().as_u16();
    let set_cookie = resp
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if set_cookie.is_empty() {
        let message = format!("login failed (status {status}): no auth cookie returned");
        return if status >= 500 {
            Err(ConnectionError::operational(message))
        } else {
            Err(ConnectionError::authentication(message))
        };
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

    Err(ConnectionError::operational(
        "login failed: could not extract auth token from cookie",
    ))
}

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
    resolve_typed(flags, cfg).map_err(|error| error.message)
}

pub fn resolve_typed(
    flags: &GlobalFlags,
    cfg: &Config,
) -> Result<SpaceConnection, ConnectionError> {
    let timeout = Duration::from_secs(flags.timeout);

    let client = new_client(timeout).map_err(ConnectionError::operational)?;

    if let Some(ref raw_url) = flags.url {
        let base_url = raw_url.trim_end_matches('/').to_string();
        let auth = flags.token.clone().map(Auth::Bearer).unwrap_or(Auth::None);
        return Ok(SpaceConnection {
            client,
            base_url,
            auth,
            timeout,
        });
    }

    let space =
        config::resolve_space(cfg, flags.space.as_deref()).map_err(ConnectionError::operational)?;
    let base_url = space.url.trim_end_matches('/').to_string();

    // A space with no URL is folder-based: it's served by a local SilverBullet
    // app instance on a per-space port, and resolving that (ping/launch the app,
    // inject the localhost URL + token) is App-CLI logic the standalone Core
    // `sb` deliberately does not implement. Fail with a clear message instead of
    // letting reqwest choke on an empty base URL ("builder error").
    if base_url.is_empty() {
        return Err(ConnectionError::operational(format!(
            "space \"{}\" has no URL — it is a folder-based space served by the \
             SilverBullet app. Open it in the app, pass --url <url>, or select a \
             space that has a URL.",
            space.name
        )));
    }

    if let Some(ref tok) = flags.token {
        return Ok(SpaceConnection {
            client,
            base_url,
            auth: Auth::Bearer(tok.clone()),
            timeout,
        });
    }

    let auth = match space.auth.method.as_str() {
        "browser" => Auth::Bearer(crate::browser_credentials::access_token_typed(space)?),
        "token" if !space.auth.encrypted_token.is_empty() => {
            let key = crypto::load_or_create_key(&config::config_dir()).map_err(|error| {
                ConnectionError::operational(format!("loading encryption key: {error}"))
            })?;
            let token =
                crypto::decrypt_with_key(&key, &space.auth.encrypted_token).map_err(|error| {
                    ConnectionError::authentication(decrypt_failure_msg(
                        "token",
                        &space.name,
                        error,
                    ))
                })?;
            Auth::Bearer(token)
        }
        "password" => {
            let key = crypto::load_or_create_key(&config::config_dir()).map_err(|error| {
                ConnectionError::operational(format!("loading encryption key: {error}"))
            })?;
            let password = crypto::decrypt_with_key(&key, &space.auth.encrypted_password).map_err(
                |error| {
                    ConnectionError::authentication(decrypt_failure_msg(
                        "password",
                        &space.name,
                        error,
                    ))
                },
            )?;
            let (cookie_name, jwt) =
                login_for_jwt_typed(&client, &base_url, &space.auth.username, &password)?;
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

/// Authentication-tag failures usually mean a missing or incompatible key.
/// Point the user to re-adding the space instead of showing only aead::Error.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
    };

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

            let mut req_line = String::new();
            reader.read_line(&mut req_line).unwrap();
            let mut parts = req_line.trim().splitn(3, ' ');
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();

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

            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                use std::io::Read;
                reader.read_exact(&mut body).unwrap();
            }

            writer.write_all(response.as_bytes()).unwrap();

            RecordedRequest { method, path, body }
        });

        (base_url, handle)
    }

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
        let body_str = String::from_utf8(req.body).unwrap();
        assert!(body_str.contains("username=alice"));
        assert!(body_str.contains("password=s3cr3t"));
    }

    #[test]
    fn login_for_jwt_no_cookie_errors() {
        let response = concat!("HTTP/1.1 200 OK\r\n", "Content-Length: 0\r\n", "\r\n",);
        let (base_url, handle) = mock_server(response);
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let err = login_for_jwt(&client, &base_url, "bad", "pw").unwrap_err();
        let _ = handle.join();
        assert!(err.contains("no auth cookie returned"), "err was: {err}");
    }

    #[test]
    fn typed_login_marks_rejected_password_as_authentication_failure() {
        let response = concat!("HTTP/1.1 200 OK\r\n", "Content-Length: 0\r\n", "\r\n",);
        let (base_url, handle) = mock_server(response);
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        let error = login_for_jwt_typed(&client, &base_url, "sample-user", "wrong")
            .expect_err("rejected credentials should fail");
        let _ = handle.join();

        assert!(error.authentication);
        assert!(error.message.contains("no auth cookie returned"));
    }

    #[test]
    fn typed_login_keeps_transport_failure_operational() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        let error = login_for_jwt_typed(&client, &base_url, "sample-user", "secret")
            .expect_err("unreachable server should fail");

        assert!(!error.authentication);
        assert!(error.message.contains("login request failed"));
    }

    #[test]
    fn url_encode_basic() {
        assert_eq!(url_encode("hello world"), "hello+world");
        assert_eq!(url_encode("a@b"), "a%40b");
        assert_eq!(url_encode("safe-._*"), "safe-._*");
    }
}
