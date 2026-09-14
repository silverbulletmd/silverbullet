use std::{path::Path, time::Duration};

use serde_json::Value;

use crate::{
    config::{self, AuthConfig, SpaceConfig},
    conn::{self, ConnectionError},
    crypto,
};

pub fn access_token(space: &SpaceConfig) -> Result<String, String> {
    access_token_typed(space).map_err(|error| error.message)
}

pub(crate) fn access_token_typed(space: &SpaceConfig) -> Result<String, ConnectionError> {
    access_token_from_typed(space, &config::config_dir())
}

fn access_token_from_typed(space: &SpaceConfig, dir: &Path) -> Result<String, ConnectionError> {
    let _lock = config::lock(dir).map_err(ConnectionError::operational)?;
    let mut cfg = config::load_from(dir).map_err(ConnectionError::operational)?;
    let saved = cfg
        .spaces
        .iter_mut()
        .find(|saved| saved.id == space.id)
        .ok_or_else(|| {
            ConnectionError::operational("space configuration changed; retry the command")
        })?;
    if saved.url != space.url || saved.auth.method != "browser" || !saved.folder_path.is_empty() {
        return Err(ConnectionError::operational(
            "space configuration changed; retry the command",
        ));
    }
    crate::device_auth::validate_url(&saved.url).map_err(ConnectionError::operational)?;
    let login_error = || {
        ConnectionError::authentication(format!(
            "Browser credentials for space {:?} are unavailable or expired; run `sb space login {:?}`",
            saved.name, saved.name
        ))
    };
    let key = crypto::load_or_create_key(dir).map_err(|_| login_error())?;
    if saved.auth.expires_at > chrono::Utc::now().timestamp() + 60 {
        return crypto::decrypt_with_key(&key, &saved.auth.encrypted_token)
            .map_err(|_| login_error());
    }
    let refresh = crypto::decrypt_with_key(&key, &saved.auth.encrypted_refresh_token)
        .map_err(|_| login_error())?;
    if refresh.is_empty() {
        return Err(login_error());
    }
    let client = conn::new_client(Duration::from_secs(20)).map_err(ConnectionError::operational)?;
    let response = client
        .post(format!("{}/.auth/token", saved.url.trim_end_matches('/')))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", "silverbullet-cli"),
            ("refresh_token", refresh.as_str()),
        ])
        .send()
        .map_err(|error| {
            ConnectionError::operational(format!("Cannot refresh browser credentials: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        return if matches!(status.as_u16(), 400 | 401 | 403) {
            Err(login_error())
        } else {
            Err(ConnectionError::operational(format!(
                "Cannot refresh browser credentials: server returned {status}"
            )))
        };
    }
    let value = response.json().map_err(|error| {
        ConnectionError::operational(format!("Invalid refresh response: {error}"))
    })?;
    let mut auth = encode_tokens(value, dir).map_err(ConnectionError::operational)?;
    auth.extra = saved.auth.extra.clone();
    let token = crypto::decrypt_with_key(&key, &auth.encrypted_token).map_err(|_| login_error())?;
    saved.auth = auth;
    config::save_to(dir, &cfg).map_err(ConnectionError::operational)?;
    Ok(token)
}

pub(crate) fn encode_tokens(response: Value, dir: &Path) -> Result<AuthConfig, String> {
    let required = |field: &str| {
        response[field]
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("invalid token response: missing {field}"))
    };
    let access = required("access_token")?;
    let refresh = required("refresh_token")?;
    let username = required("username")?;
    if !required("token_type")?.eq_ignore_ascii_case("bearer") {
        return Err("invalid token response: unsupported token type".into());
    }
    let lifetime = response["expires_in"]
        .as_i64()
        .filter(|value| *value > 0)
        .ok_or("invalid token response: invalid expires_in")?;
    let expires_at = chrono::Utc::now()
        .timestamp()
        .checked_add(lifetime)
        .ok_or("invalid token response: expires_in overflow")?;
    let key =
        crypto::load_or_create_key(dir).map_err(|e| format!("loading encryption key: {e}"))?;
    Ok(AuthConfig {
        method: "browser".into(),
        encrypted_token: crypto::encrypt_with_key(&key, access)
            .map_err(|e| format!("encrypting access token: {e}"))?,
        encrypted_refresh_token: crypto::encrypt_with_key(&key, refresh)
            .map_err(|e| format!("encrypting refresh token: {e}"))?,
        username: username.into(),
        expires_at,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        thread,
    };

    fn response() -> Value {
        serde_json::json!({"access_token":"new-access", "refresh_token":"new-refresh", "expires_in":3600, "token_type":"Bearer", "username":"sample-user"})
    }

    fn configured(dir: &Path, url: &str) -> SpaceConfig {
        let key = crypto::load_or_create_key(dir).unwrap();
        let space = SpaceConfig {
            id: "sample-id".into(),
            name: "sample".into(),
            url: url.into(),
            auth: AuthConfig {
                method: "browser".into(),
                encrypted_token: crypto::encrypt_with_key(&key, "old-access").unwrap(),
                encrypted_refresh_token: crypto::encrypt_with_key(&key, "old-refresh").unwrap(),
                ..Default::default()
            },
            ..Default::default()
        };
        config::save_to(
            dir,
            &config::Config {
                spaces: vec![space.clone()],
            },
        )
        .unwrap();
        space
    }

    fn server(status: u16, body: Value) -> (String, thread::JoinHandle<()>) {
        server_with_hook(status, body, || {})
    }

    fn server_with_hook(
        status: u16,
        body: Value,
        hook: impl FnOnce() + Send + 'static,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/notes", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            assert!(first.starts_with("POST /notes/.auth/token "));
            let mut len = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    len = value.trim().parse().unwrap();
                }
            }
            let mut bytes = vec![0; len];
            reader.read_exact(&mut bytes).unwrap();
            let form = String::from_utf8(bytes).unwrap();
            assert!(form.contains("client_id=silverbullet-cli"));
            assert!(form.contains("grant_type=refresh_token"));
            assert!(form.contains("refresh_token=old-refresh"));
            hook();
            let body = body.to_string();
            write!(stream, "HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        (url, handle)
    }

    #[test]
    fn encodes_valid_tokens_and_rejects_incomplete_responses() {
        let tmp = tempfile::tempdir().unwrap();
        let auth = encode_tokens(response(), tmp.path()).unwrap();
        let key = crypto::load_or_create_key(tmp.path()).unwrap();
        assert_eq!(
            crypto::decrypt_with_key(&key, &auth.encrypted_token).unwrap(),
            "new-access"
        );
        assert_eq!(
            crypto::decrypt_with_key(&key, &auth.encrypted_refresh_token).unwrap(),
            "new-refresh"
        );
        assert_eq!(auth.method, "browser");
        assert!(auth.expires_at > chrono::Utc::now().timestamp() + 3500);
        for field in [
            "access_token",
            "refresh_token",
            "expires_in",
            "token_type",
            "username",
        ] {
            let mut value = response();
            value.as_object_mut().unwrap().remove(field);
            assert!(encode_tokens(value, tmp.path()).is_err(), "missing {field}");
        }
    }

    #[test]
    fn concurrent_refresh_persists_rotated_credentials_once() {
        let (url, handle) = server(200, response());
        let tmp = tempfile::tempdir().unwrap();
        let space = configured(tmp.path(), &url);
        thread::scope(|scope| {
            let first = scope.spawn(|| access_token_from_typed(&space, tmp.path()));
            let second = scope.spawn(|| access_token_from_typed(&space, tmp.path()));
            assert_eq!(first.join().unwrap().unwrap(), "new-access");
            assert_eq!(second.join().unwrap().unwrap(), "new-access");
        });
        handle.join().unwrap();
        let saved = config::load_from(tmp.path()).unwrap();
        let key = crypto::load_or_create_key(tmp.path()).unwrap();
        assert_eq!(
            crypto::decrypt_with_key(&key, &saved.spaces[0].auth.encrypted_refresh_token).unwrap(),
            "new-refresh"
        );
    }

    #[test]
    fn failed_refresh_preserves_credentials_and_requests_login() {
        let (url, handle) = server(400, serde_json::json!({"error":"invalid_grant"}));
        let tmp = tempfile::tempdir().unwrap();
        let space = configured(tmp.path(), &url);
        let before = std::fs::read(tmp.path().join("config.json")).unwrap();
        let error = access_token_from_typed(&space, tmp.path()).unwrap_err();
        handle.join().unwrap();
        assert!(error.message.contains("sb space login"));
        assert_eq!(
            std::fs::read(tmp.path().join("config.json")).unwrap(),
            before
        );
    }

    #[test]
    fn typed_refresh_marks_rejected_credentials_as_authentication_failure() {
        let (url, handle) = server(401, serde_json::json!({"error":"invalid_token"}));
        let tmp = tempfile::tempdir().unwrap();
        let space = configured(tmp.path(), &url);

        let error = access_token_from_typed(&space, tmp.path())
            .expect_err("rejected refresh credentials should fail");
        handle.join().unwrap();

        assert!(error.authentication);
        assert!(error.message.contains("sb space login"));
    }

    #[test]
    fn malformed_refresh_preserves_saved_credentials() {
        let mut body = response();
        body["expires_in"] = serde_json::json!(-1);
        let (url, handle) = server(200, body);
        let tmp = tempfile::tempdir().unwrap();
        let space = configured(tmp.path(), &url);
        let before = std::fs::read(tmp.path().join("config.json")).unwrap();
        assert!(access_token_from_typed(&space, tmp.path()).is_err());
        handle.join().unwrap();
        assert_eq!(
            std::fs::read(tmp.path().join("config.json")).unwrap(),
            before
        );
    }

    #[test]
    fn network_failure_preserves_credentials_without_requesting_login() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let tmp = tempfile::tempdir().unwrap();
        let space = configured(tmp.path(), &url);
        let before = std::fs::read(tmp.path().join("config.json")).unwrap();
        let error = access_token_from_typed(&space, tmp.path()).unwrap_err();
        assert!(error.message.contains("refresh"));
        assert!(!error.message.contains("sb space login"));
        assert_eq!(
            std::fs::read(tmp.path().join("config.json")).unwrap(),
            before
        );
    }

    #[test]
    fn typed_refresh_keeps_transport_failure_operational() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let tmp = tempfile::tempdir().unwrap();
        let space = configured(tmp.path(), &url);

        let error = access_token_from_typed(&space, tmp.path())
            .expect_err("unreachable refresh server should fail");

        assert!(!error.authentication);
        assert!(error.message.contains("refresh"));
    }

    #[test]
    fn persistence_failure_does_not_release_access_token() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.json");
        let (url, handle) = server_with_hook(200, response(), move || {
            std::fs::write(path, "invalid").unwrap();
        });
        let space = configured(tmp.path(), &url);
        let error = access_token_from_typed(&space, tmp.path()).unwrap_err();
        handle.join().unwrap();
        assert!(error.message.contains("existing config"));
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("config.json")).unwrap(),
            "invalid"
        );
    }

    #[test]
    fn changed_space_is_not_refreshed() {
        let tmp = tempfile::tempdir().unwrap();
        let mut space = configured(tmp.path(), "http://127.0.0.1:1");
        space.url = "http://127.0.0.1:2".into();
        assert!(access_token_from_typed(&space, tmp.path())
            .unwrap_err()
            .message
            .contains("changed"));
    }
}
