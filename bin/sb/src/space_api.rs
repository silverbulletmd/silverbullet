//! [`SpaceApi`] over HTTP, so `sb` runs the same space operations as the MCP
//! tools.

use std::future::Future;
use std::time::Duration;

use async_trait::async_trait;
use space_tools::ops::{SpaceApi, SpaceRequest, SpaceResponse};

use crate::api::AUTHENTICATION_REQUIRED;
use crate::conn::SpaceConnection;

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_SCREENSHOT_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

pub struct HttpSpaceApi {
    client: reqwest::Client,
    base_url: String,
    auth_headers: reqwest::header::HeaderMap,
}

impl HttpSpaceApi {
    /// An async client with `conn`'s base URL, credentials and timeout.
    pub fn from_connection(conn: &SpaceConnection) -> Result<Self, String> {
        // The credentials as `SpaceConnection::apply_auth` sends them.
        let auth_headers = conn
            .apply_auth(conn.client.get(&conn.base_url))
            .build()
            .map_err(|e| format!("building request: {e}"))?
            .headers()
            .clone();
        Ok(Self {
            client: new_client(conn.timeout)?,
            base_url: conn.base_url.clone(),
            auth_headers,
        })
    }
}

/// Slack for the response to arrive after the server's own deadline.
const RESPONSE_MARGIN: Duration = Duration::from_secs(2);
/// The server's index catch-up budget, spent before the call's own timeout.
const CATCH_UP_BUDGET: Duration = Duration::from_secs(5);

/// The client-side limit for a call the server may run for `timeout` after
/// catching its index up (`X-Await-Index`) for up to `min(5 s, timeout)`.
fn client_timeout(timeout: Duration) -> Duration {
    timeout + timeout.min(CATCH_UP_BUDGET) + RESPONSE_MARGIN
}

fn new_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(client_timeout(timeout))
        .build()
        .map_err(|e| format!("building http client: {e}"))
}

#[async_trait]
impl SpaceApi for HttpSpaceApi {
    async fn send(&self, req: SpaceRequest) -> Result<SpaceResponse, String> {
        let max_bytes = if req.path_and_query.starts_with("/.runtime/screenshot") {
            MAX_SCREENSHOT_RESPONSE_BYTES
        } else {
            MAX_RESPONSE_BYTES
        };
        let mut builder = self
            .client
            .request(
                req.method,
                format!("{}{}", self.base_url, req.path_and_query),
            )
            .body(req.body);
        for (name, value) in req.headers {
            builder = builder.header(name, value);
        }
        builder = builder.headers(self.auth_headers.clone());
        let mut response = builder
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?;
        let status = response.status();
        // The shared operations would report these as a failed runtime call;
        // signing in again is what fixes them.
        if status == reqwest::StatusCode::UNAUTHORIZED || status.is_redirection() {
            return Err(AUTHENTICATION_REQUIRED.to_owned());
        }
        let headers = response.headers().clone();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("reading response: {e}"))?
        {
            body.extend_from_slice(&chunk);
            if body.len() > max_bytes {
                return Err(format!("response exceeded {max_bytes} bytes"));
            }
        }
        Ok(SpaceResponse {
            status,
            headers,
            body,
        })
    }
}

/// Runs `future` to completion on a private current-thread runtime, for the
/// shared async operations in an otherwise blocking CLI.
pub fn block_on<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("building a tokio runtime")
        .block_on(future)
}

/// A local HTTP server that answers each connection with the next canned
/// response and records the requests, for tests of the runtime commands.
#[cfg(test)]
pub(crate) mod test_server {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::{Duration, Instant};

    use crate::conn::{Auth, SpaceConnection};

    #[derive(Debug, Clone)]
    pub struct Recorded {
        pub method: String,
        pub path: String,
        pub headers: Vec<(String, String)>,
        pub body: String,
    }

    impl Recorded {
        pub fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }
    }

    /// An HTTP/1.1 response that closes its connection.
    pub fn response(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let mut out = format!("HTTP/1.1 {status}\r\n");
        for (name, value) in headers {
            out.push_str(&format!("{name}: {value}\r\n"));
        }
        out.push_str(&format!(
            "Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        ));
        let mut out = out.into_bytes();
        out.extend_from_slice(body);
        out
    }

    pub fn json(status: &str, headers: &[(&str, &str)], body: &str) -> Vec<u8> {
        let mut all = vec![("Content-Type", "application/json")];
        all.extend_from_slice(headers);
        response(status, &all, body.as_bytes())
    }

    /// Serves `responses` in order, one per connection, and returns the
    /// requests once all were served or the client stopped calling.
    pub fn serve(responses: Vec<Vec<u8>>) -> (String, thread::JoinHandle<Vec<Recorded>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let handle = thread::spawn(move || {
            let mut recorded = Vec::new();
            let mut idle_since = Instant::now();
            let mut responses = responses.into_iter();
            let mut next = responses.next();
            while let Some(response) = next.take() {
                let stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(_) if idle_since.elapsed() < Duration::from_secs(10) => {
                        thread::sleep(Duration::from_millis(5));
                        next = Some(response);
                        continue;
                    }
                    Err(_) => break,
                };
                stream.set_nonblocking(false).unwrap();
                recorded.push(read_request(&stream));
                (&stream).write_all(&response).unwrap();
                idle_since = Instant::now();
                next = responses.next();
            }
            recorded
        });
        (base, handle)
    }

    fn read_request(stream: &std::net::TcpStream) -> Recorded {
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let mut parts = line.trim().splitn(3, ' ');
        let method = parts.next().unwrap_or_default().to_owned();
        let path = parts.next().unwrap_or_default().to_owned();
        let mut headers = Vec::new();
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let line = line.trim();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                if name.eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse().unwrap_or(0);
                }
                headers.push((name.trim().to_owned(), value.trim().to_owned()));
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        Recorded {
            method,
            path,
            headers,
            body: String::from_utf8_lossy(&body).into_owned(),
        }
    }

    pub fn connection(base: &str, auth: Auth) -> SpaceConnection {
        SpaceConnection {
            client: crate::conn::new_client(Duration::from_secs(30)).unwrap(),
            base_url: base.to_owned(),
            auth,
            timeout: Duration::from_secs(30),
        }
    }
}

#[cfg(test)]
mod tests {
    use reqwest::Method;
    use space_tools::ops::{SpaceApi, SpaceRequest};

    use super::test_server::{connection, json, response, serve};
    use super::*;

    #[test]
    fn client_waits_for_catch_up_and_the_call() {
        let secs = |s| Duration::from_secs(s);
        assert_eq!(client_timeout(secs(30)), secs(30 + 5 + 2));
        assert_eq!(client_timeout(secs(3)), secs(3 + 3 + 2));
    }
    use crate::conn::Auth;

    fn get(path: &str) -> SpaceRequest {
        SpaceRequest {
            method: Method::GET,
            path_and_query: path.to_owned(),
            body: Vec::new(),
            headers: Vec::new(),
        }
    }

    #[test]
    fn bearer_token_is_sent() {
        let (base, handle) = serve(vec![json("200 OK", &[], "{}")]);
        let api =
            HttpSpaceApi::from_connection(&connection(&base, Auth::Bearer("tok".into()))).unwrap();
        let response = block_on(api.send(get("/.runtime/logs"))).unwrap();
        assert_eq!(response.status, reqwest::StatusCode::OK);
        let requests = handle.join().unwrap();
        assert_eq!(requests[0].header("authorization"), Some("Bearer tok"));
    }

    #[test]
    fn cookie_auth_sends_cookie_header() {
        let (base, handle) = serve(vec![json("200 OK", &[], "{}")]);
        let auth = Auth::Cookie {
            name: "auth_x".into(),
            value: "jwt".into(),
        };
        let api = HttpSpaceApi::from_connection(&connection(&base, auth)).unwrap();
        block_on(api.send(get("/.runtime/logs"))).unwrap();
        assert_eq!(
            handle.join().unwrap()[0].header("cookie"),
            Some("auth_x=jwt")
        );
    }

    #[test]
    fn unauthorized_points_to_login() {
        let (base, handle) = serve(vec![response("401 Unauthorized", &[], b"")]);
        let api = HttpSpaceApi::from_connection(&connection(&base, Auth::None)).unwrap();
        let error = block_on(api.send(get("/.runtime/logs"))).err().unwrap();
        handle.join().unwrap();
        assert!(error.contains("sb space login"), "{error}");
    }

    #[test]
    fn headers_and_body_come_back() {
        let (base, handle) = serve(vec![json(
            "503 Service Unavailable",
            &[("X-Index-Status", "behind")],
            r#"{"error":"x"}"#,
        )]);
        let api = HttpSpaceApi::from_connection(&connection(&base, Auth::None)).unwrap();
        let response = block_on(api.send(get("/.runtime/lua"))).unwrap();
        handle.join().unwrap();
        assert_eq!(response.status, reqwest::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers["x-index-status"], "behind");
        assert_eq!(response.body, br#"{"error":"x"}"#);
    }
}
