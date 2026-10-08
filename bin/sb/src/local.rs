//! Folder spaces served by a locally installed SilverBullet Desktop.
//!
//! Desktop describes itself in `desktop-host.json` next to the registry: where
//! its `runtime.json` lives, how to start it, and its deep-link template. This
//! module turns a folder space into a localhost URL and token from those files,
//! starting Desktop when the space is not running yet.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::cli::GlobalFlags;
use crate::config;
use crate::conn::ConnectionError;

pub const HOST_FILE: &str = "desktop-host.json";
pub const REQUIRES_DESKTOP: &str =
    "This requires SilverBullet Desktop, which is not installed (or has not been started yet).";
pub const NEWER_DESKTOP: &str = "SilverBullet Desktop is newer than this sb; run `sb upgrade`.";
const CONTRACT_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq)]
pub struct DesktopHost {
    pub runtime: PathBuf,
    pub launch: Vec<String>,
    pub open: String,
}

#[derive(Deserialize)]
struct HostFile {
    #[serde(default = "default_version")]
    version: u64,
    runtime: PathBuf,
    launch: Vec<String>,
    open: String,
}

#[derive(Deserialize)]
struct RuntimeFile {
    #[serde(default = "default_version")]
    version: u64,
    #[serde(default)]
    spaces: Vec<RuntimeSpace>,
}

#[derive(Deserialize)]
struct RuntimeSpace {
    id: String,
    origin: String,
    token: String,
}

fn default_version() -> u64 {
    CONTRACT_VERSION
}

/// Read Desktop's discovery file from the registry directory `dir`.
pub fn desktop_host(dir: &Path) -> Result<DesktopHost, ConnectionError> {
    let data = std::fs::read(dir.join(HOST_FILE))
        .map_err(|_| ConnectionError::operational(REQUIRES_DESKTOP))?;
    let file: HostFile = serde_json::from_slice(&data)
        .map_err(|e| ConnectionError::operational(format!("Invalid {HOST_FILE}: {e}")))?;
    if file.version > CONTRACT_VERSION {
        return Err(ConnectionError::operational(NEWER_DESKTOP));
    }
    let Some(program) = file.launch.first() else {
        return Err(ConnectionError::operational(REQUIRES_DESKTOP));
    };
    // A relative program (e.g. `flatpak`) is looked up on PATH when spawned.
    if Path::new(program).is_absolute() && !Path::new(program).is_file() {
        return Err(ConnectionError::operational(REQUIRES_DESKTOP));
    }
    Ok(DesktopHost {
        runtime: file.runtime,
        launch: file.launch,
        open: file.open,
    })
}

/// Origin and bearer token of a running space, validated as a loopback origin.
pub fn runtime_connection(host: &DesktopHost, space_id: &str) -> Result<(String, String), String> {
    let data = std::fs::read(&host.runtime)
        .map_err(|_| "Space is not running in SilverBullet Desktop".to_string())?;
    let file: RuntimeFile =
        serde_json::from_slice(&data).map_err(|_| "Invalid Desktop runtime state".to_string())?;
    if file.version > CONTRACT_VERSION {
        return Err(NEWER_DESKTOP.into());
    }
    let entry = file
        .spaces
        .into_iter()
        .find(|s| s.id == space_id)
        .ok_or("Space is not running in SilverBullet Desktop")?;
    let url = reqwest::Url::parse(&entry.origin).map_err(|_| "Invalid runtime origin")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || entry.token.is_empty()
        || entry.token.chars().any(char::is_control)
    {
        return Err("Invalid local runtime credentials".into());
    }
    Ok((entry.origin, entry.token))
}

/// Fill `template`'s `{path}` with the canonical, percent-encoded `path`.
pub fn deep_link(template: &str, path: &Path) -> Result<String, String> {
    let absolute =
        std::fs::canonicalize(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let text = absolute.to_str().ok_or("Path must be valid UTF-8")?;
    let encoded: String = text
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    Ok(template.replace("{path}", &encoded))
}

/// Start Desktop, optionally opening `path`. Returns once the process is spawned.
pub fn launch(host: &DesktopHost, path: Option<&Path>) -> Result<(), String> {
    let link = path.map(|p| deep_link(&host.open, p)).transpose()?;
    let (program, args) = host.launch.split_first().ok_or(REQUIRES_DESKTOP)?;
    let mut command = Command::new(program);
    command.args(args);
    if let Some(link) = link {
        command.arg(link);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start SilverBullet Desktop: {e}"))?;
    // A launcher that still exists after the app was removed (e.g. `flatpak
    // run` for an uninstalled Flatpak) exits with an error right away.
    let deadline = Instant::now() + Duration::from_secs(1);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => return Err(REQUIRES_DESKTOP.into()),
            Ok(Some(_)) | Err(_) => return Ok(()),
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    Ok(())
}

/// Wait until the space's runtime is ready, (re)launching Desktop while it is
/// not running. A runtime that answers but is still booting is not relaunched.
pub fn wait_for_runtime(
    timeout: Duration,
    retry_interval: Duration,
    mut connection: impl FnMut() -> Result<(String, String), String>,
    mut launch: impl FnMut() -> Result<(), String>,
    mut runtime_ready: impl FnMut(u16, &str) -> bool,
    mut runtime_alive: impl FnMut(u16) -> bool,
) -> Result<(String, String), String> {
    let mut inspect = || {
        let (origin, token) = connection().ok()?;
        let port = reqwest::Url::parse(&origin).ok()?.port()?;
        let ready = runtime_ready(port, &token);
        let alive = ready || runtime_alive(port);
        Some(((origin, token), ready, alive))
    };
    if let Some((found, true, _)) = inspect() {
        return Ok(found);
    }
    launch()?;
    eprint!("Waiting for SilverBullet");
    let deadline = Instant::now() + timeout;
    let mut next_launch = Instant::now() + retry_interval;
    loop {
        eprint!(".");
        let state = inspect();
        if let Some((found, true, _)) = state {
            eprintln!();
            return Ok(found);
        }
        let now = Instant::now();
        if now >= deadline {
            eprintln!();
            return Err("timed out waiting for SilverBullet Desktop to open the space".into());
        }
        if !matches!(state, Some((_, false, true))) && now >= next_launch {
            launch()?;
            next_launch = now + retry_interval;
            continue;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn client(secs: u64) -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(secs))
        .no_proxy()
        .build()
        .ok()
}

/// `GET /.ping` answers 2xx.
pub fn ping_port(port: u16) -> bool {
    let Some(c) = client(2) else { return false };
    c.get(format!("http://127.0.0.1:{port}/.ping"))
        .send()
        .is_ok_and(|r| r.status().is_success())
}

/// `/.runtime/ready` answers 200 (503 while the editor runtime boots).
pub fn runtime_ready(port: u16, token: &str) -> bool {
    let Some(c) = client(2) else { return false };
    c.get(format!("http://127.0.0.1:{port}/.runtime/ready"))
        .bearer_auth(token)
        .send()
        .is_ok_and(|r| r.status().as_u16() == 200)
}

/// Point `g` at the local runtime when the selected space is a folder space.
/// Remote spaces and explicit `--url` are left to the normal connection logic.
pub fn prepare(g: &mut GlobalFlags, needs_runtime: bool) -> Result<(), ConnectionError> {
    if g.url.is_some() {
        return Ok(());
    }
    let Ok(cfg) = config::load() else {
        return Ok(());
    };
    let Ok(space) = config::resolve_space(&cfg, g.space.as_deref()) else {
        return Ok(()); // the command reports the selection error
    };
    if !space.url.is_empty() || space.folder_path.is_empty() {
        return Ok(());
    }
    let host = desktop_host(&config::config_dir())?;
    let id = space.id.clone();
    let folder = PathBuf::from(&space.folder_path);
    let (origin, token) = if needs_runtime {
        wait_for_runtime(
            Duration::from_secs(g.timeout),
            Duration::from_secs(2),
            || runtime_connection(&host, &id),
            || launch(&host, Some(&folder)),
            runtime_ready,
            ping_port,
        )
    } else {
        runtime_connection(&host, &id)
    }
    .map_err(ConnectionError::operational)?;
    g.url = Some(origin);
    g.token = Some(token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::time::Duration;

    fn write(path: &Path, value: serde_json::Value) {
        std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    }

    fn host_file(dir: &Path, launch: &str) -> PathBuf {
        let runtime = dir.join("runtime.json");
        write(
            &dir.join(HOST_FILE),
            serde_json::json!({
                "version": 1,
                "runtime": runtime,
                "launch": [launch],
                "open": "silverbullet-desktop://open?path={path}"
            }),
        );
        runtime
    }

    #[test]
    fn missing_host_file_requires_desktop() {
        let tmp = tempfile::tempdir().unwrap();
        let err = desktop_host(tmp.path()).unwrap_err();
        assert_eq!(err.message, REQUIRES_DESKTOP);
    }

    #[test]
    fn host_file_pointing_at_a_removed_app_requires_desktop() {
        let tmp = tempfile::tempdir().unwrap();
        host_file(tmp.path(), &tmp.path().join("gone").to_string_lossy());
        assert_eq!(
            desktop_host(tmp.path()).unwrap_err().message,
            REQUIRES_DESKTOP
        );
    }

    #[test]
    fn newer_host_file_asks_for_an_upgrade() {
        let tmp = tempfile::tempdir().unwrap();
        write(
            &tmp.path().join(HOST_FILE),
            serde_json::json!({"version": 2, "runtime": "/x", "launch": ["flatpak"], "open": ""}),
        );
        assert_eq!(desktop_host(tmp.path()).unwrap_err().message, NEWER_DESKTOP);
    }

    #[test]
    fn valid_host_file_is_read() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("silverbullet");
        std::fs::write(&exe, "").unwrap();
        let runtime = host_file(tmp.path(), &exe.to_string_lossy());
        let host = desktop_host(tmp.path()).unwrap();
        assert_eq!(host.runtime, runtime);
        assert_eq!(host.launch, vec![exe.to_string_lossy().to_string()]);
    }

    fn host_with_runtime(spaces: serde_json::Value) -> (tempfile::TempDir, DesktopHost) {
        let tmp = tempfile::tempdir().unwrap();
        let runtime = tmp.path().join("runtime.json");
        write(&runtime, spaces);
        let host = DesktopHost {
            runtime,
            launch: vec!["flatpak".into()],
            open: String::new(),
        };
        (tmp, host)
    }

    #[test]
    fn runtime_connection_returns_validated_origin_and_token() {
        let (_tmp, host) = host_with_runtime(serde_json::json!({"version": 1, "spaces": [
            {"id": "a", "origin": "http://127.0.0.1:43123", "token": "secret"}
        ]}));
        assert_eq!(
            runtime_connection(&host, "a").unwrap(),
            ("http://127.0.0.1:43123".to_string(), "secret".to_string())
        );
        assert!(runtime_connection(&host, "b").is_err());
    }

    #[test]
    fn runtime_connection_rejects_unsafe_origins_and_tokens() {
        for (origin, token) in [
            ("http://localhost:1", "t"),
            ("https://127.0.0.1:1", "t"),
            ("http://127.0.0.1:1/x", "t"),
            ("http://user@127.0.0.1:1", "t"),
            ("http://127.0.0.1", "t"),
            ("http://127.0.0.1:1", ""),
            ("http://127.0.0.1:1", "a\nb"),
        ] {
            let (_tmp, host) = host_with_runtime(serde_json::json!({"spaces": [
                {"id": "a", "origin": origin, "token": token}
            ]}));
            assert!(
                runtime_connection(&host, "a").is_err(),
                "{origin} {token:?}"
            );
        }
    }

    #[test]
    fn newer_runtime_file_asks_for_an_upgrade() {
        let (_tmp, host) = host_with_runtime(serde_json::json!({"version": 2, "spaces": []}));
        assert_eq!(runtime_connection(&host, "a").unwrap_err(), NEWER_DESKTOP);
    }

    #[cfg(unix)]
    #[test]
    fn a_launcher_that_fails_immediately_requires_desktop() {
        let host = |script: &str| DesktopHost {
            runtime: PathBuf::from("/unused"),
            launch: vec!["sh".into(), "-c".into(), script.into()],
            open: String::new(),
        };
        assert_eq!(launch(&host("exit 3"), None).unwrap_err(), REQUIRES_DESKTOP);
        assert!(launch(&host("exit 0"), None).is_ok());
        assert!(launch(&host("sleep 3"), None).is_ok());
    }

    #[test]
    fn deep_links_encode_local_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("A # draft.md");
        std::fs::write(&file, "synthetic").unwrap();
        let url = deep_link("silverbullet-desktop://open?path={path}", &file).unwrap();
        assert!(
            url.starts_with("silverbullet-desktop://open?path=%2F"),
            "{url}"
        );
        assert!(url.contains("%23"));
        assert!(!url.contains(' '));
        assert!(deep_link("x?path={path}", &tmp.path().join("missing")).is_err());
    }

    fn ok() -> Result<(String, String), String> {
        Ok(("http://127.0.0.1:43123".into(), "token".into()))
    }

    #[test]
    fn missing_runtime_launches_the_target_space() {
        let launched = Cell::new(false);
        let result = wait_for_runtime(
            Duration::from_secs(1),
            Duration::from_secs(2),
            || {
                if launched.get() {
                    ok()
                } else {
                    Err("not running".into())
                }
            },
            || {
                launched.set(true);
                Ok(())
            },
            |port, token| port == 43123 && token == "token",
            |_| true,
        )
        .unwrap();
        assert_eq!(result.0, "http://127.0.0.1:43123");
        assert!(launched.get());
    }

    #[test]
    fn dormant_runtime_reopens_the_target_space() {
        let launched = Cell::new(false);
        wait_for_runtime(
            Duration::from_secs(1),
            Duration::from_secs(2),
            ok,
            || {
                launched.set(true);
                Ok(())
            },
            |_, _| launched.get(),
            |_| true,
        )
        .unwrap();
        assert!(launched.get());
    }

    #[test]
    fn launch_is_retried_when_shutdown_discards_the_first_request() {
        let launches = Cell::new(0);
        wait_for_runtime(
            Duration::from_secs(1),
            Duration::ZERO,
            || {
                if launches.get() >= 2 {
                    ok()
                } else {
                    Err("not running".into())
                }
            },
            || {
                launches.set(launches.get() + 1);
                Ok(())
            },
            |_, _| true,
            |_| true,
        )
        .unwrap();
        assert_eq!(launches.get(), 2);
    }

    #[test]
    fn a_discovered_runtime_is_not_relaunched_while_its_editor_boots() {
        let launches = Cell::new(0);
        let probes = Cell::new(0);
        wait_for_runtime(
            Duration::from_secs(1),
            Duration::ZERO,
            ok,
            || {
                launches.set(launches.get() + 1);
                Ok(())
            },
            |_, _| {
                probes.set(probes.get() + 1);
                probes.get() >= 4
            },
            |_| true,
        )
        .unwrap();
        assert_eq!(launches.get(), 1);
    }

    #[test]
    fn waiting_gives_up_after_the_timeout() {
        let err = wait_for_runtime(
            Duration::ZERO,
            Duration::ZERO,
            || Err("not running".into()),
            || Ok(()),
            |_, _| false,
            |_| false,
        )
        .unwrap_err();
        assert!(err.contains("timed out"), "{err}");
    }
}
