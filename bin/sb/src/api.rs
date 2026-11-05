//! Blocking HTTP calls against a SilverBullet Rust server: console logs,
//! config and reachability. Lua and screenshots go through
//! [`crate::space_api`] and the shared space operations.
//!
//! All methods live on [`crate::conn::SpaceConnection`].

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;

use server_space_tools::lua_text::runtime_failure;

use crate::conn::{self, SpaceConnection};

/// A single console log entry from `/.runtime/logs`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogEntry {
    pub level: String,
    pub text: String,
    pub timestamp: i64,
}

const MAX_LOG_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

pub(crate) fn read_response(
    response: reqwest::blocking::Response,
    max_bytes: u64,
    description: &str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    response
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("reading {description}: {e}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("{description} exceeded {max_bytes} bytes"));
    }
    Ok(bytes)
}

pub const AUTHENTICATION_REQUIRED: &str = "authentication required; run `sb space login <name>` for a saved browser connection, or provide --token.";

/// What still works when the runtime does not, for the runtime's error hints.
pub const STILL_USABLE_CLI: &str = "you can still use sb fs and sb search";

pub(crate) fn runtime_error(status: StatusCode, body: &[u8]) -> String {
    if status == StatusCode::UNAUTHORIZED || status.is_redirection() {
        return AUTHENTICATION_REQUIRED.into();
    }
    if serde_json::from_slice::<Value>(body).is_ok_and(|v| v.get("error").is_some()) {
        // The timeout only shows in the "timeout" error, which only Lua calls
        // return, and those go through the shared operations with their real
        // timeout; logs, config and search never produce it, so 0 is unused.
        return runtime_failure(status, body, 0, STILL_USABLE_CLI);
    }
    match std::str::from_utf8(body) {
        Ok(text) => format!("server returned {}: {text}", status.as_u16()),
        Err(_) => format!("server returned {}", status.as_u16()),
    }
}

impl SpaceConnection {
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
        let bytes = read_response(resp, MAX_LOG_RESPONSE_BYTES, "logs response")?;

        if status == StatusCode::UNAUTHORIZED || (status.as_u16() >= 300 && status.as_u16() < 400) {
            return Err(
                "authentication required; run `sb space login <name>`, use --token, or configure a space with 'space add'"
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

#[cfg(test)]
mod tests {
    use crate::conn::Auth;
    use crate::space_api::test_server::{connection, json, serve};

    #[test]
    fn revoked_authentication_points_to_login_without_replaying() {
        let error = super::runtime_error(reqwest::StatusCode::UNAUTHORIZED, b"unauthorized");
        assert!(error.contains("sb space login"));
    }

    #[test]
    fn disabled_runtime_says_what_still_works() {
        let error = super::runtime_error(
            reqwest::StatusCode::SERVICE_UNAVAILABLE,
            br#"{"error":"Runtime API is not enabled"}"#,
        );
        assert_eq!(
            error,
            "The runtime API is disabled for this space; you can still use sb fs and sb search."
        );
    }

    #[test]
    fn logs_200_parses_entries() {
        let (base, handle) = serve(vec![json(
            "200 OK",
            &[],
            r#"{"logs":[{"level":"log","text":"hi","timestamp":5}]}"#,
        )]);
        let entries = connection(&base, Auth::Bearer("tok".into()))
            .logs(10, None)
            .unwrap();
        let requests = handle.join().unwrap();
        assert_eq!(requests[0].header("authorization"), Some("Bearer tok"));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].level, "log");
        assert_eq!(entries[0].text, "hi");
        assert_eq!(entries[0].timestamp, 5);
    }
}
