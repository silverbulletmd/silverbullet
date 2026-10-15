//! The server's native search API (`/.search/*`), called directly: no client
//! and no Lua runtime, so it works on a server without the Runtime API.

use reqwest::StatusCode;
use serde_json::{json, Value};

use crate::api::{read_response, runtime_error};
use crate::conn::SpaceConnection;

const MAX_SEARCH_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;

/// The server's search errors are `{"error": <code>, "message": <text>}`.
fn search_error(status: StatusCode, body: &[u8]) -> String {
    if status != StatusCode::UNAUTHORIZED && !status.is_redirection() {
        if let Some(message) = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|v| v.get("message")?.as_str().map(str::to_string))
        {
            return message;
        }
    }
    runtime_error(status, body)
}

impl SpaceConnection {
    fn search_request(&self, request: reqwest::blocking::RequestBuilder) -> Result<Value, String> {
        let resp = self
            .apply_auth(request)
            .send()
            .map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status();
        let bytes = read_response(resp, MAX_SEARCH_RESPONSE_BYTES, "search response")?;
        if !status.is_success() {
            return Err(search_error(status, &bytes));
        }
        serde_json::from_slice(&bytes).map_err(|e| format!("parsing search response: {e}"))
    }

    /// `GET /.search/status`.
    pub fn search_status(&self) -> Result<Value, String> {
        self.search_request(self.client.get(format!("{}/.search/status", self.base_url)))
    }

    /// `POST /.search/query`. A missing `mode` is the server's default mode
    /// (what the search box starts in); `limit` is clamped by the server.
    pub fn search_query(
        &self,
        query: &str,
        mode: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let mut body = json!({ "query": query });
        if let Some(mode) = mode {
            body["mode"] = json!(mode);
        }
        if let Some(limit) = limit {
            body["limit"] = json!(limit);
        }
        self.search_request(
            self.client
                .post(format!("{}/.search/query", self.base_url))
                .json(&body),
        )
    }

    /// `POST /.search/related`.
    pub fn search_related(&self, page: &str, limit: Option<usize>) -> Result<Value, String> {
        let mut body = json!({ "page": page });
        if let Some(limit) = limit {
            body["limit"] = json!(limit);
        }
        self.search_request(
            self.client
                .post(format!("{}/.search/related", self.base_url))
                .json(&body),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_use_the_servers_message() {
        let body =
            br#"{"error":"unavailable","message":"Search isn't available to public visitors"}"#;
        assert_eq!(
            search_error(StatusCode::NOT_FOUND, body),
            "Search isn't available to public visitors"
        );
    }

    #[test]
    fn unauthorized_asks_to_sign_in() {
        let message = search_error(StatusCode::UNAUTHORIZED, b"");
        assert!(message.contains("authentication required"), "{message}");
    }

    #[test]
    fn plain_bodies_fall_back_to_the_status() {
        assert_eq!(
            search_error(StatusCode::BAD_GATEWAY, b"upstream down"),
            "server returned 502: upstream down"
        );
    }
}
