use std::sync::RwLock;

use crate::types::{FileMeta, SpaceError, SpacePrimitives};

/// How to authenticate HTTP requests to the remote server.
#[derive(Clone)]
pub enum AuthCredential {
    /// Bearer token sent via Authorization header (token auth).
    Bearer(String),
    /// JWT sent as a cookie (password auth). Contains the cookie header value.
    Cookie(String),
}

/// Slugify one component of the auth cookie name: every non-word character
/// becomes `_`. Mirrors the server's `\W` regex replacement (word chars are
/// Unicode alphanumerics plus `_`).
fn slug(s: &str) -> String {
    s.replace(|c: char| !(c.is_alphanumeric() || c == '_'), "_")
}

/// Build the cookie header value for password-based JWT auth.
///
/// The server names the session cookie `auth_{host}{url_prefix}` (see
/// `scoped_auth_cookie_name` in the server crate's `auth::cookie`), so that
/// several prefix-bound spaces sharing a host keep separate sessions. The URL
/// prefix is the path component of `base_url`, and it MUST be part of the name
/// here too — deriving from the host alone sends `auth_host=<jwt>` to a server
/// expecting `auth_host_prefix`, which authenticates cleanly and then 401s on
/// every subsequent request.
///
/// A trailing slash is trimmed so `https://h/space/` and `https://h/space`
/// agree; a root path yields the legacy host-only `auth_{host}` name.
pub fn auth_cookie_header(base_url: &str, jwt: &str) -> String {
    let name_body = reqwest::Url::parse(base_url)
        .ok()
        .map(|u| {
            let host = u.host_str().unwrap_or("");
            let port_suffix = u.port().map(|p| format!(":{p}")).unwrap_or_default();
            let prefix = u.path().trim_end_matches('/');
            format!("{}{}", slug(&format!("{host}{port_suffix}")), slug(prefix))
        })
        .unwrap_or_default();
    format!("auth_{name_body}={jwt}")
}

/// Optional re-auth info for password-based auth (username/password stored for JWT refresh).
struct ReAuthInfo {
    /// The remote base URL (without /.fs suffix), used to call /.auth
    remote_base_url: String,
    username: String,
    password: String,
}

/// SpacePrimitives implementation backed by a remote SilverBullet server over HTTP.
/// Uses `reqwest::blocking` for synchronous operation on the sync thread.
pub struct HttpSpacePrimitives {
    client: reqwest::blocking::Client,
    base_url: String,
    credential: RwLock<Option<AuthCredential>>,
    re_auth: Option<ReAuthInfo>,
}

impl HttpSpacePrimitives {
    pub fn new(base_url: &str, credential: Option<AuthCredential>) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build HTTP client");
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            credential: RwLock::new(credential),
            re_auth: None,
        }
    }

    /// Create with re-authentication support for password-based auth.
    /// `remote_base_url` is the server root (without /.fs), used to call /.auth.
    pub fn new_with_reauth(
        base_url: &str,
        credential: Option<AuthCredential>,
        remote_base_url: &str,
        username: &str,
        password: &str,
    ) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build HTTP client");
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            credential: RwLock::new(credential),
            re_auth: Some(ReAuthInfo {
                remote_base_url: remote_base_url.trim_end_matches('/').to_string(),
                username: username.to_string(),
                password: password.to_string(),
            }),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        let url = if path.is_empty() {
            format!("{}/", self.base_url)
        } else {
            format!("{}/{}", self.base_url, encode_page_uri(path))
        };
        tracing::debug!("[http] {method} {url}");
        let mut req = self.client.request(method, &url);
        req = req.header("X-Sync-Mode", "true");
        let cred = self.credential.read().unwrap();
        match cred.as_ref() {
            Some(AuthCredential::Bearer(token)) => {
                req = req.header("Authorization", format!("Bearer {token}"));
            }
            Some(AuthCredential::Cookie(cookie)) => {
                tracing::debug!(
                    "[http] Sending Cookie header: {}=<jwt>",
                    cookie.split('=').next().unwrap_or("?")
                );
                req = req.header("Cookie", cookie);
            }
            None => {}
        }
        req
    }

    fn parse_file_meta(path: &str, headers: &reqwest::header::HeaderMap) -> FileMeta {
        let last_modified = headers
            .get("X-Last-Modified")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64);
        let created = headers
            .get("X-Created")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64);
        let size = headers
            .get("X-Content-Length")
            .or_else(|| headers.get("Content-Length"))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0i64);
        let content_type = headers
            .get("Content-Type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let perm = headers
            .get("X-Permission")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("ro")
            .to_string();

        FileMeta {
            name: path.to_string(),
            created,
            last_modified,
            content_type,
            size,
            perm,
        }
    }

    /// Check a response status code and return the appropriate error.
    fn check_response_status(status: reqwest::StatusCode, context: &str) -> Result<(), SpaceError> {
        if status.is_success() {
            return Ok(());
        }
        match status {
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                Err(SpaceError::Unauthorized)
            }
            reqwest::StatusCode::NOT_FOUND => Err(SpaceError::NotFound),
            _ => Err(SpaceError::WriteError(format!(
                "{context} failed: {status}"
            ))),
        }
    }

    fn map_error(e: reqwest::Error) -> SpaceError {
        if e.status() == Some(reqwest::StatusCode::NOT_FOUND) {
            SpaceError::NotFound
        } else if e.status() == Some(reqwest::StatusCode::UNAUTHORIZED)
            || e.status() == Some(reqwest::StatusCode::FORBIDDEN)
        {
            SpaceError::Unauthorized
        } else {
            SpaceError::WriteError(e.to_string())
        }
    }

    /// Attempt to re-authenticate using stored username/password, update the credential, and return true on success.
    fn try_reauth(&self) -> bool {
        let info = match &self.re_auth {
            Some(info) => info,
            None => return false,
        };
        tracing::info!("[http] Attempting JWT re-authentication");
        match authenticate_blocking(&info.remote_base_url, &info.username, &info.password) {
            Ok(jwt) => {
                let cookie = auth_cookie_header(&info.remote_base_url, &jwt);
                *self.credential.write().unwrap() = Some(AuthCredential::Cookie(cookie));
                tracing::info!("[http] Re-authentication successful");
                true
            }
            Err(e) => {
                tracing::warn!("[http] Re-authentication failed: {e}");
                false
            }
        }
    }
}

/// Authenticate against a SilverBullet server using username/password, returning a JWT.
/// Posts to `{base_url}/.auth` and extracts the `auth_*` cookie value from the response
/// (servers name the cookie `auth_{host}{url_prefix}`, see `auth_cookie_header`).
///
/// This is the single implementation of the credential exchange; async callers
/// should wrap it in `spawn_blocking`. Pair the returned JWT with
/// `auth_cookie_header` to build a `Cookie` credential.
pub fn authenticate_blocking(
    base_url: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let auth_url = format!("{base_url}/.auth");
    let form_body = format!(
        "username={}&password={}",
        percent_encoding::utf8_percent_encode(username, percent_encoding::NON_ALPHANUMERIC),
        percent_encoding::utf8_percent_encode(password, percent_encoding::NON_ALPHANUMERIC),
    );
    let resp = client
        .post(&auth_url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form_body)
        .send()
        .map_err(|e| format!("Auth request failed: {e}"))?;

    let jwt = resp.headers().get_all("set-cookie").iter().find_map(|v| {
        let s = v.to_str().ok()?;
        if s.starts_with("auth_") {
            let cookie_value = s.split(';').next()?;
            let (_, jwt) = cookie_value.split_once('=')?;
            Some(jwt.to_string())
        } else {
            None
        }
    });

    if !resp.status().is_success() {
        return Err(format!("Auth failed: {}", resp.status()));
    }

    let body_text = resp.text().unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_default();
    if parsed.get("status").and_then(|s| s.as_str()) == Some("error") {
        let err = parsed
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("Authentication failed");
        return Err(err.to_string());
    }

    jwt.ok_or_else(|| "No auth cookie in response".to_string())
}

/// Percent-encode a file path for use in URLs, matching TS `encodePageURI`.
pub fn encode_page_uri(path: &str) -> String {
    // Encode each path segment individually, preserving `/`
    path.split('/')
        .map(|segment| {
            percent_encoding::utf8_percent_encode(segment, percent_encoding::NON_ALPHANUMERIC)
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("/")
}

impl SpacePrimitives for HttpSpacePrimitives {
    fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
        let resp = self
            .request(reqwest::Method::GET, "")
            .send()
            .map_err(Self::map_error)?;
        if let Err(e) = Self::check_response_status(resp.status(), "fetch_file_list") {
            if matches!(e, SpaceError::Unauthorized) && self.try_reauth() {
                let resp = self
                    .request(reqwest::Method::GET, "")
                    .send()
                    .map_err(Self::map_error)?;
                Self::check_response_status(resp.status(), "fetch_file_list")?;
                let files: Vec<FileMeta> = resp
                    .json()
                    .map_err(|e| SpaceError::WriteError(e.to_string()))?;
                return Ok(files);
            }
            return Err(e);
        }
        let files: Vec<FileMeta> = resp
            .json()
            .map_err(|e| SpaceError::WriteError(e.to_string()))?;
        Ok(files)
    }

    fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
        let resp = self
            .request(reqwest::Method::GET, path)
            .header("X-Get-Meta", "true")
            .send()
            .map_err(Self::map_error)?;
        if let Err(e) = Self::check_response_status(resp.status(), "get_file_meta") {
            if matches!(e, SpaceError::Unauthorized) && self.try_reauth() {
                let resp = self
                    .request(reqwest::Method::GET, path)
                    .header("X-Get-Meta", "true")
                    .send()
                    .map_err(Self::map_error)?;
                Self::check_response_status(resp.status(), "get_file_meta")?;
                return Ok(Self::parse_file_meta(path, resp.headers()));
            }
            return Err(e);
        }
        Ok(Self::parse_file_meta(path, resp.headers()))
    }

    fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
        let resp = self
            .request(reqwest::Method::GET, path)
            .header("Accept", "application/octet-stream")
            .send()
            .map_err(Self::map_error)?;
        if let Err(e) = Self::check_response_status(resp.status(), "read_file") {
            if matches!(e, SpaceError::Unauthorized) && self.try_reauth() {
                let resp = self
                    .request(reqwest::Method::GET, path)
                    .header("Accept", "application/octet-stream")
                    .send()
                    .map_err(Self::map_error)?;
                Self::check_response_status(resp.status(), "read_file")?;
                let meta = Self::parse_file_meta(path, resp.headers());
                let data = resp
                    .bytes()
                    .map_err(|e| SpaceError::WriteError(e.to_string()))?
                    .to_vec();
                return Ok((data, meta));
            }
            return Err(e);
        }
        let meta = Self::parse_file_meta(path, resp.headers());
        let data = resp
            .bytes()
            .map_err(|e| SpaceError::WriteError(e.to_string()))?
            .to_vec();
        Ok((data, meta))
    }

    fn write_file(
        &self,
        path: &str,
        data: &[u8],
        meta: Option<&FileMeta>,
    ) -> Result<FileMeta, SpaceError> {
        let build_req = |this: &Self| {
            let mut req = this
                .request(reqwest::Method::PUT, path)
                .header("Content-Type", "application/octet-stream");
            if let Some(m) = meta {
                req = req
                    .header("X-Created", m.created.to_string())
                    .header("X-Last-Modified", m.last_modified.to_string())
                    .header("X-Perm", &m.perm);
            }
            req
        };
        let resp = build_req(self)
            .body(data.to_vec())
            .send()
            .map_err(Self::map_error)?;
        if let Err(e) = Self::check_response_status(resp.status(), "write_file") {
            if matches!(e, SpaceError::Unauthorized) && self.try_reauth() {
                let resp = build_req(self)
                    .body(data.to_vec())
                    .send()
                    .map_err(Self::map_error)?;
                Self::check_response_status(resp.status(), "write_file")?;
                return Ok(Self::parse_file_meta(path, resp.headers()));
            }
            return Err(e);
        }
        Ok(Self::parse_file_meta(path, resp.headers()))
    }

    fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
        let resp = self
            .request(reqwest::Method::DELETE, path)
            .send()
            .map_err(Self::map_error)?;
        if let Err(e) = Self::check_response_status(resp.status(), "delete_file") {
            if matches!(e, SpaceError::Unauthorized) && self.try_reauth() {
                let resp = self
                    .request(reqwest::Method::DELETE, path)
                    .send()
                    .map_err(Self::map_error)?;
                Self::check_response_status(resp.status(), "delete_file")?;
                return Ok(());
            }
            return Err(e);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie_name(base_url: &str) -> String {
        let header = auth_cookie_header(base_url, "jwt");
        header.split_once('=').unwrap().0.to_string()
    }

    #[test]
    fn cookie_name_includes_url_prefix() {
        // A prefix-based space must scope the cookie to its prefix, matching the
        // server's `auth_{host}{prefix}`. Deriving from the host alone 401s.
        assert_eq!(
            cookie_name("https://sb.zef.pub/silverspace-manual"),
            "auth_sb_zef_pub_silverspace_manual"
        );
        assert_eq!(
            cookie_name("https://h.example.com/a/b"),
            "auth_h_example_com_a_b"
        );
    }

    #[test]
    fn cookie_name_ignores_trailing_slash() {
        assert_eq!(
            cookie_name("https://sb.zef.pub/silverspace-manual/"),
            cookie_name("https://sb.zef.pub/silverspace-manual")
        );
    }

    #[test]
    fn cookie_name_without_prefix_is_legacy_host_only() {
        assert_eq!(cookie_name("https://sb.zef.pub/"), "auth_sb_zef_pub");
        assert_eq!(cookie_name("https://sb.zef.pub"), "auth_sb_zef_pub");
    }

    #[test]
    fn cookie_name_includes_non_default_port() {
        assert_eq!(cookie_name("http://localhost:3000/"), "auth_localhost_3000");
        assert_eq!(
            cookie_name("http://localhost:3000/work"),
            "auth_localhost_3000_work"
        );
    }

    #[test]
    fn cookie_header_carries_jwt_value() {
        assert_eq!(
            auth_cookie_header("https://sb.zef.pub/space", "the.jwt.value"),
            "auth_sb_zef_pub_space=the.jwt.value"
        );
    }
}
