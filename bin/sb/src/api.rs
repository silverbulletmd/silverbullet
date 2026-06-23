//! Runtime HTTP calls against a SilverBullet Rust server.
//!
//! All methods live on [`crate::conn::SpaceConnection`].  The Rust server
//! wraps eval responses in a `{ "result": <value> }` / `{ "error": <msg> }`
//! envelope (see `docs/Runtime API.md`) — see the per-method docs for exact
//! response shapes.

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::conn::{self, SpaceConnection};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/// A single console log entry from `/.runtime/logs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogEntry {
    pub level: String,
    pub text: String,
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Helper: interpret a non-2xx response from the Rust runtime endpoints.
// ---------------------------------------------------------------------------

fn runtime_error(status: StatusCode, body: &[u8]) -> String {
    if status == StatusCode::UNAUTHORIZED || (status.as_u16() >= 300 && status.as_u16() < 400) {
        return "authentication required; use --token, or configure a space with 'space add'"
            .to_string();
    }

    // Try to extract {"error": "..."} from the body.
    if let Ok(text) = std::str::from_utf8(body) {
        if let Ok(v) = serde_json::from_str::<Value>(text) {
            if let Some(msg) = v.get("error").and_then(|e| e.as_str()) {
                return msg.to_string();
            }
        }
        return format!("server returned {}: {text}", status.as_u16());
    }
    format!("server returned {}", status.as_u16())
}

// ---------------------------------------------------------------------------
// impl SpaceConnection — API methods
// ---------------------------------------------------------------------------

impl SpaceConnection {
    // -----------------------------------------------------------------------
    // Internal: POST /.runtime/lua or /.runtime/lua_script
    // -----------------------------------------------------------------------

    fn post_runtime(&self, path: &str, body: &str) -> Result<Value, String> {
        let url = format!("{}{path}", self.base_url);
        let req = self
            .client
            .post(&url)
            .header("Content-Type", "text/plain")
            .header("X-Timeout", self.timeout.as_secs().to_string())
            .body(body.to_string());
        let req = self.apply_auth(req);
        let resp = req.send().map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let bytes = resp.bytes().map_err(|e| format!("reading body: {e}"))?;

        if status.is_success() {
            // On 200, the body is the `{ "result": <value> }` envelope (Core's
            // runtime handlers wrap eval results; see `docs/Runtime API.md`).
            // A Lua-level failure arrives as `{ "error": <msg> }`.
            let v: Value = serde_json::from_slice(&bytes)
                .map_err(|e| format!("parsing response JSON: {e}"))?;
            if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                return Err(err.to_string());
            }
            Ok(v.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(runtime_error(status, &bytes))
        }
    }

    // -----------------------------------------------------------------------
    // eval_lua / eval_lua_script
    // -----------------------------------------------------------------------

    /// Evaluate a Lua expression via `POST /.runtime/lua`.
    pub fn eval_lua(&self, expr: &str) -> Result<Value, String> {
        self.post_runtime("/.runtime/lua", expr)
    }

    /// Execute a Lua script via `POST /.runtime/lua_script`.
    pub fn eval_lua_script(&self, code: &str) -> Result<Value, String> {
        self.post_runtime("/.runtime/lua_script", code)
    }

    // -----------------------------------------------------------------------
    // logs
    // -----------------------------------------------------------------------

    /// Fetch console logs via `GET /.runtime/logs`.
    pub fn logs(&self, limit: usize, since: Option<i64>) -> Result<Vec<LogEntry>, String> {
        let url = format!("{}/.runtime/logs", self.base_url);
        let mut req = self.client.get(&url);
        if limit > 0 {
            req = req.query(&[("limit", limit.to_string())]);
        }
        if let Some(s) = since {
            if s > 0 {
                req = req.query(&[("since", s.to_string())]);
            }
        }
        let req = self.apply_auth(req);
        let resp = req.send().map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let bytes = resp.bytes().map_err(|e| format!("reading body: {e}"))?;

        if status == StatusCode::UNAUTHORIZED || (status.as_u16() >= 300 && status.as_u16() < 400) {
            return Err(
                "authentication required; use --token, or configure a space with 'space add'"
                    .to_string(),
            );
        }
        if !status.is_success() {
            return Err(runtime_error(status, &bytes));
        }

        #[derive(Deserialize)]
        struct LogsResponse {
            logs: Vec<LogEntry>,
        }

        let data: LogsResponse =
            serde_json::from_slice(&bytes).map_err(|e| format!("parsing logs response: {e}"))?;
        Ok(data.logs)
    }

    // -----------------------------------------------------------------------
    // objects_raw
    // -----------------------------------------------------------------------

    /// GET `/.runtime/objects{path_suffix}` and return the raw `(status,
    /// bytes)` without auto-erroring on non-2xx.  Only returns `Err` on
    /// transport failure.
    pub fn objects_raw(
        &self,
        path_suffix: &str,
        params: &[(String, String)],
    ) -> Result<(StatusCode, Vec<u8>), String> {
        let url = format!("{}/.runtime/objects{path_suffix}", self.base_url);
        let mut req = self
            .client
            .get(&url)
            .header("X-Timeout", self.timeout.as_secs().to_string());
        for (k, v) in params {
            req = req.query(&[(k.as_str(), v.as_str())]);
        }
        let req = self.apply_auth(req);
        let resp = req.send().map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status();
        let bytes = resp
            .bytes()
            .map_err(|e| format!("reading body: {e}"))?
            .to_vec();
        Ok((status, bytes))
    }

    // -----------------------------------------------------------------------
    // config / ping / probe / auth_check
    // -----------------------------------------------------------------------

    /// GET `/.config` and return the parsed JSON body on 200.
    pub fn config(&self) -> Result<Value, String> {
        let url = format!("{}/.config", self.base_url);
        let req = self.apply_auth(self.client.get(&url));
        let resp = req.send().map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status();
        let bytes = resp.bytes().map_err(|e| format!("reading body: {e}"))?;
        if !status.is_success() {
            return Err(runtime_error(status, &bytes));
        }
        serde_json::from_slice(&bytes).map_err(|e| format!("parsing config JSON: {e}"))
    }

    /// GET `/.ping`; returns `true` iff the server responds with 2xx.
    pub fn ping(&self) -> bool {
        let url = format!("{}/.ping", self.base_url);
        match self.client.get(&url).send() {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    /// GET `/.config` without credentials to probe reachability and auth state.
    ///
    /// Returns `(reachable, needs_auth)`:
    /// - 2xx → `(true, false)`
    /// - 401 or 3xx → `(true, true)`
    /// - error / other status → `(false, false)`
    pub fn probe(&self) -> (bool, bool) {
        let url = format!("{}/.config", self.base_url);
        // Probe without auth — use a fresh client with redirect off.
        let probe_client = match conn::new_client(self.timeout) {
            Ok(c) => c,
            Err(_) => return (false, false),
        };
        match probe_client.get(&url).send() {
            Ok(resp) => {
                let s = resp.status();
                if s.is_success() {
                    (true, false)
                } else if s == StatusCode::UNAUTHORIZED || (s.as_u16() >= 300 && s.as_u16() < 400) {
                    (true, true)
                } else {
                    (false, false)
                }
            }
            Err(_) => (false, false),
        }
    }

    /// GET `/.config` with credentials; returns `true` iff the response is 2xx.
    pub fn auth_check(&self) -> bool {
        let url = format!("{}/.config", self.base_url);
        let req = self.apply_auth(self.client.get(&url));
        match req.send() {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use crate::conn::{Auth, SpaceConnection};
    use reqwest::blocking::Client;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    // -----------------------------------------------------------------------
    // Mock server (duplicated here to keep tests self-contained)
    // -----------------------------------------------------------------------

    #[derive(Debug)]
    struct RecordedRequest {
        _method: String,
        _path: String,
        headers: Vec<(String, String)>,
        _body: Vec<u8>,
    }

    impl RecordedRequest {
        fn header(&self, name: &str) -> Option<&str> {
            let lower = name.to_lowercase();
            self.headers
                .iter()
                .find(|(k, _)| k.to_lowercase() == lower)
                .map(|(_, v)| v.as_str())
        }
    }

    fn mock_server(response: &'static str) -> (String, thread::JoinHandle<RecordedRequest>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        let base_url = format!("http://127.0.0.1:{port}");

        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut writer = stream;

            let mut req_line = String::new();
            reader.read_line(&mut req_line).unwrap();
            let mut parts = req_line.trim().splitn(3, ' ');
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();

            let mut headers = Vec::new();
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(colon) = trimmed.find(':') {
                    let name = trimmed[..colon].trim().to_string();
                    let value = trimmed[colon + 1..].trim().to_string();
                    if name.to_lowercase() == "content-length" {
                        content_length = value.parse().unwrap_or(0);
                    }
                    headers.push((name, value));
                }
            }

            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                use std::io::Read;
                reader.read_exact(&mut body).unwrap();
            }

            writer.write_all(response.as_bytes()).unwrap();

            RecordedRequest {
                _method: method,
                _path: path,
                headers,
                _body: body,
            }
        });

        (base_url, handle)
    }

    fn bearer_conn(base_url: &str, token: &str) -> SpaceConnection {
        SpaceConnection {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base_url: base_url.trim_end_matches('/').to_string(),
            auth: Auth::Bearer(token.to_string()),
            timeout: Duration::from_secs(30),
        }
    }

    // -----------------------------------------------------------------------
    // eval_lua — happy path (200, raw JSON)
    // -----------------------------------------------------------------------

    #[test]
    fn eval_lua_200_returns_value() {
        let response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: application/json\r\n",
            "Content-Length: 12\r\n",
            "\r\n",
            r#"{"result":2}"#,
        );
        let (base_url, handle) = mock_server(response);
        let conn = bearer_conn(&base_url, "mytoken");

        let result = conn.eval_lua("1+1").unwrap();
        assert_eq!(result, serde_json::json!(2));

        let req = handle.join().unwrap();
        assert_eq!(
            req.header("content-type").unwrap_or(""),
            "text/plain",
            "must send Content-Type: text/plain"
        );
        assert!(
            req.header("x-timeout").is_some(),
            "must send X-Timeout header"
        );
        assert_eq!(
            req.header("authorization").unwrap_or(""),
            "Bearer mytoken",
            "must send Authorization: Bearer <token>"
        );
    }

    // -----------------------------------------------------------------------
    // eval_lua — 503 "Runtime API is not enabled"
    // -----------------------------------------------------------------------

    #[test]
    fn eval_lua_503_runtime_not_enabled() {
        let body = r#"{"error":"Runtime API is not enabled"}"#;
        let response = format!(
            "HTTP/1.1 503 Service Unavailable\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        // We need a 'static response — use Box::leak for the test.
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = mock_server(response);
        let conn = bearer_conn(&base_url, "tok");

        let err = conn.eval_lua("x").unwrap_err();
        let _ = handle.join();
        assert!(
            err.contains("not enabled"),
            "expected 'not enabled' in: {err}"
        );
    }

    // -----------------------------------------------------------------------
    // eval_lua — 401 → auth error
    // -----------------------------------------------------------------------

    #[test]
    fn eval_lua_401_auth_required() {
        let response = concat!(
            "HTTP/1.1 401 Unauthorized\r\n",
            "Content-Length: 0\r\n",
            "\r\n",
        );
        let (base_url, handle) = mock_server(response);
        let conn = bearer_conn(&base_url, "bad");

        let err = conn.eval_lua("x").unwrap_err();
        let _ = handle.join();
        assert!(
            err.contains("authentication required"),
            "expected auth error in: {err}"
        );
    }

    // -----------------------------------------------------------------------
    // logs — 200, parse LogEntry array
    // -----------------------------------------------------------------------

    #[test]
    fn logs_200_parses_entries() {
        let body = r#"{"logs":[{"level":"log","text":"hi","timestamp":5}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = mock_server(response);
        let conn = bearer_conn(&base_url, "tok");

        let entries = conn.logs(10, None).unwrap();
        let _ = handle.join();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, "log");
        assert_eq!(entries[0].text, "hi");
        assert_eq!(entries[0].timestamp, 5);
    }

    // -----------------------------------------------------------------------
    // Cookie auth path
    // -----------------------------------------------------------------------

    #[test]
    fn cookie_auth_sends_cookie_header() {
        let response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Length: 4\r\n",
            "\r\n",
            "null",
        );
        let (base_url, handle) = mock_server(response);
        let conn = SpaceConnection {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base_url: base_url.clone(),
            auth: Auth::Cookie {
                name: "auth_x".to_string(),
                value: "jwt".to_string(),
            },
            timeout: Duration::from_secs(30),
        };

        let _ = conn.eval_lua("nil").unwrap();
        let req = handle.join().unwrap();
        assert_eq!(
            req.header("cookie").unwrap_or(""),
            "auth_x=jwt",
            "must send Cookie: auth_x=jwt"
        );
    }

    // -----------------------------------------------------------------------
    // objects_raw — returns raw status + bytes even for 404
    // -----------------------------------------------------------------------

    #[test]
    fn objects_raw_404_returns_raw() {
        let body = r#"{"error":"not found"}"#;
        let response = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let response: &'static str = Box::leak(response.into_boxed_str());
        let (base_url, handle) = mock_server(response);
        let conn = bearer_conn(&base_url, "tok");

        let (status, bytes) = conn.objects_raw("/tag/ref", &[]).unwrap();
        let _ = handle.join();
        assert_eq!(status.as_u16(), 404, "must return 404 status");
        assert!(!bytes.is_empty(), "must return raw body bytes");
    }

    // -----------------------------------------------------------------------
    // objects_raw — X-Timeout header is set
    // -----------------------------------------------------------------------

    #[test]
    fn objects_raw_sends_x_timeout() {
        let response = concat!("HTTP/1.1 200 OK\r\n", "Content-Length: 2\r\n", "\r\n", "[]",);
        let (base_url, handle) = mock_server(response);
        let conn = bearer_conn(&base_url, "tok");

        let _ = conn.objects_raw("", &[]).unwrap();
        let req = handle.join().unwrap();
        assert!(
            req.header("x-timeout").is_some(),
            "objects_raw must set X-Timeout header"
        );
    }
}
