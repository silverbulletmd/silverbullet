use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::Value;

use crate::{config, conn};

const CLIENT_ID: &str = "silverbullet-cli";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

#[derive(Deserialize)]
struct Authorization {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: String,
    expires_in: u64,
    #[serde(default = "default_interval")]
    interval: u64,
}

fn default_interval() -> u64 {
    5
}

pub fn validate_url(base: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(base).map_err(|_| "Invalid space URL".to_string())?;
    let host = url.host_str().unwrap_or("");
    let loopback = host == "localhost"
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !url.has_host()
        || !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Browser sign-in requires an HTTPS space URL (HTTP is allowed on loopback only) without credentials, query, or fragment".into());
    }
    Ok(url)
}

pub fn supported(base: &str) -> Result<bool, String> {
    let client = conn::new_client(Duration::from_secs(15))?;
    let response = client
        .post(format!("{base}/.auth/device/code"))
        .form(&[("client_id", "")])
        .send()
        .map_err(|e| format!("Cannot check browser sign-in: {e}"))?;
    match response.status().as_u16() {
        404 | 405 => Ok(false),
        400 => {
            let body: Value = response
                .json()
                .map_err(|_| "Invalid device authorization response".to_string())?;
            Ok(matches!(
                body["error"].as_str(),
                Some("invalid_request" | "unauthorized_client")
            ))
        }
        status => Err(format!(
            "Cannot check browser sign-in: server returned {status}"
        )),
    }
}

fn verification_link(base: &str, link: &str) -> Result<String, String> {
    let base_url = validate_url(base)?;
    let url = reqwest::Url::parse(link).map_err(|_| "Invalid verification URL".to_string())?;
    if url.origin() != base_url.origin()
        || url.path() != format!("{}/.auth/device", base_url.path().trim_end_matches('/'))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Server returned a verification URL outside this space".into());
    }
    Ok(url.to_string())
}

pub fn sign_in(base: &str, no_browser: bool) -> Result<config::AuthConfig, String> {
    let tokens = authorize(
        base,
        |link, code| {
            eprintln!(
                "Confirmation code: {code}\nOpen this link on this or another device:\n{link}"
            );
            if !no_browser {
                eprintln!("Opening your browser to authorize SilverBullet CLI.");
                if open::that_detached(link).is_err() {
                    eprintln!("Could not open a browser. Open the link above manually.");
                }
            }
            eprintln!("Waiting for authorization (Ctrl-C to cancel)...");
        },
        std::thread::sleep,
    )?;
    let dir = config::config_dir();
    let _lock = config::lock(&dir)?;
    crate::browser_credentials::encode_tokens(tokens, &dir)
}

fn authorize(
    base: &str,
    show: impl FnOnce(&str, &str),
    mut sleep: impl FnMut(Duration),
) -> Result<Value, String> {
    validate_url(base)?;
    let base = base.trim_end_matches('/');
    let client = conn::new_client(Duration::from_secs(15))?;
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "this device".into());
    let device_name = format!(
        "SilverBullet CLI on {}",
        hostname.chars().take(80).collect::<String>()
    );
    let response = client
        .post(format!("{base}/.auth/device/code"))
        .form(&[("client_id", CLIENT_ID), ("device_name", &device_name)])
        .send()
        .map_err(|e| format!("Cannot start browser sign-in: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Cannot start browser sign-in (HTTP {}). Check the space URL and server support; token authentication is also available.", response.status().as_u16()));
    }
    let auth: Authorization = response
        .json()
        .map_err(|_| "Invalid device authorization response".to_string())?;
    if auth.device_code.is_empty()
        || auth.user_code.is_empty()
        || auth.expires_in == 0
        || auth.expires_in > 600
        || auth.interval > auth.expires_in
    {
        return Err("Invalid device authorization response".into());
    }
    verification_link(base, &auth.verification_uri)?;
    let link = verification_link(base, &auth.verification_uri_complete)?;
    let deadline = Instant::now() + Duration::from_secs(auth.expires_in);
    show(&link, &auth.user_code);
    let mut interval = Duration::from_secs(auth.interval.max(1));
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining <= interval {
            return Err("Sign-in timed out. Run the command again to try again.".into());
        }
        sleep(interval);
        match poll(
            &client,
            base,
            &auth.device_code,
            deadline.saturating_duration_since(Instant::now()),
        )? {
            Poll::Pending => {}
            Poll::SlowDown => interval = interval.saturating_add(Duration::from_secs(5)),
            Poll::Tokens(tokens) => return Ok(tokens),
        }
    }
}

enum Poll {
    Pending,
    SlowDown,
    Tokens(Value),
}

fn poll(client: &Client, base: &str, code: &str, remaining: Duration) -> Result<Poll, String> {
    if remaining.is_zero() {
        return Err("Sign-in timed out. Run the command again.".into());
    }
    let response = match client
        .post(format!("{base}/.auth/token"))
        .timeout(remaining.min(Duration::from_secs(15)))
        .form(&[
            ("client_id", CLIENT_ID),
            ("grant_type", DEVICE_GRANT),
            ("device_code", code),
        ])
        .send()
    {
        Ok(r) => r,
        Err(e) if e.is_timeout() => return Ok(Poll::SlowDown),
        Err(e) => return Err(format!("Cannot complete browser sign-in: {e}")),
    };
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|_| "Invalid token response".to_string())?;
    if status.is_success() {
        return Ok(Poll::Tokens(body));
    }
    match body["error"].as_str() {
        Some("authorization_pending") => Ok(Poll::Pending),
        Some("slow_down") => Ok(Poll::SlowDown),
        Some("access_denied") => Err("Sign-in canceled in the browser.".into()),
        Some("expired_token") => Err("Sign-in expired. Run the command again.".into()),
        Some("invalid_grant") => {
            Err("Sign-in attempt is no longer valid. Run the command again.".into())
        }
        _ => Err(format!(
            "Browser sign-in failed (HTTP {}). Run the command again.",
            status.as_u16()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn server(errors: &[&str]) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let url = base.clone();
        let errors: Vec<String> = errors.iter().map(|s| s.to_string()).collect();
        let handle = thread::spawn(move || {
            let mut requests = vec![];
            for step in 0..=errors.len() + 1 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some((key, value)) = line.split_once(':') {
                        if key.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse().unwrap();
                        }
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                requests.push(format!("{request}{}", String::from_utf8(body).unwrap()));
                let (status, body) = if step == 0 {
                    (
                        200,
                        serde_json::json!({
                            "device_code":"secret-for-cli", "user_code":"WXYZ-1234",
                            "verification_uri": format!("{url}/notes/.auth/device"),
                            "verification_uri_complete": format!("{url}/notes/.auth/device?user_code=WXYZ-1234"),
                            "expires_in":300, "interval":5
                        }),
                    )
                } else if step <= errors.len() {
                    (400, serde_json::json!({"error":errors[step-1]}))
                } else {
                    (
                        200,
                        serde_json::json!({"access_token":"access", "refresh_token":"refresh", "token_type":"Bearer", "expires_in":900,"username":"test-user"}),
                    )
                };
                let body = body.to_string();
                write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                if step > 0
                    && step <= errors.len()
                    && !matches!(
                        errors[step - 1].as_str(),
                        "authorization_pending" | "slow_down"
                    )
                {
                    break;
                }
            }
            requests
        });
        (format!("{base}/notes"), handle)
    }

    #[test]
    fn device_login_polls_and_keeps_secret_out_of_browser_link() {
        let (base, server) = server(&["authorization_pending", "slow_down"]);
        let mut waits = vec![];
        let tokens = authorize(
            &base,
            |link, code| {
                assert_eq!(code, "WXYZ-1234");
                assert!(link.contains("user_code=WXYZ-1234"));
                assert!(!link.contains("secret-for-cli"));
            },
            |duration| waits.push(duration.as_secs()),
        )
        .unwrap();
        assert_eq!(tokens["access_token"], "access");
        assert_eq!(waits, vec![5, 5, 10]);
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("POST /notes/.auth/device/code "));
        assert!(requests[1].contains("client_id=silverbullet-cli"));
        assert!(requests[1].contains("device_code=secret-for-cli"));
        assert!(requests[1].starts_with("POST /notes/.auth/token "));
    }

    #[test]
    fn device_login_denial_does_not_return_tokens() {
        let (base, server) = server(&["access_denied"]);
        let error = authorize(&base, |_, _| {}, |_| {}).unwrap_err();
        assert!(error.contains("canceled"));
        assert_eq!(server.join().unwrap().len(), 2);
    }

    #[test]
    fn device_login_expiration_and_lost_attempt_are_actionable() {
        for failure in ["expired_token", "invalid_grant"] {
            let (base, server) = server(&[failure]);
            assert!(authorize(&base, |_, _| {}, |_| {})
                .unwrap_err()
                .contains("Run the command again"));
            server.join().unwrap();
        }
    }

    #[test]
    fn browser_links_cannot_change_origin_or_space() {
        let base = "https://notes.example.com/notes";
        assert!(verification_link(
            base,
            "https://notes.example.com/notes/.auth/device?user_code=ABCD"
        )
        .is_ok());
        for link in [
            "https://other.example.com/notes/.auth/device",
            "http://notes.example.com/notes/.auth/device",
            "https://notes.example.com/other/.auth/device",
            "https://user@notes.example.com/notes/.auth/device",
        ] {
            assert!(verification_link(base, link).is_err());
        }
    }

    #[test]
    fn browser_auth_requires_https_except_on_loopback() {
        for base in [
            "https://notes.example.com/notes",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
            "http://localhost:3000",
        ] {
            assert!(validate_url(base).is_ok());
        }
        for base in [
            "http://notes.example.com",
            "file:///tmp/notes",
            "https://user:pass@notes.example.com",
            "https://notes.example.com/?secret=abc",
        ] {
            assert!(validate_url(base).is_err());
        }
    }
}
