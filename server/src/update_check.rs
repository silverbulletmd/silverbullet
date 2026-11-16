//! Anonymous daily update check against silverbullet.md.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const STATE_FILE: &str = "update-check.json";
pub const DEFAULT_URL: &str = "https://silverbullet.md/api/server/update-check";

/// A newer stable release than the one running.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Update {
    pub version: String,
    pub url: String,
    pub title: String,
}

/// A known security issue in the running version.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Advisory {
    pub id: String,
    pub fixed_in: String,
    pub severity: String,
    pub summary: String,
    pub url: String,
}

/// What silverbullet.md answers, passed on to admins in the Dashboard as is.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Answer {
    #[serde(default)]
    pub update: Option<Update>,
    #[serde(default)]
    pub security: Vec<Advisory>,
}

/// The last successful check, kept across restarts of the same version.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCheck {
    pub version: String,
    pub checked_at: u64,
    pub answer: Answer,
}

pub struct UpdateCheck {
    data_root: PathBuf,
    version: String,
    url: String,
    kind: String,
    last: Mutex<Option<LastCheck>>,
}

/// Checks run every 22 to 26 hours, so deployments don't all hit the site at once.
const MIN_INTERVAL_SECS: u64 = 22 * 3600;
const INTERVAL_SPREAD_SECS: u64 = 4 * 3600;
/// The first check after a start waits 1 to 5 minutes, off the startup path.
const MIN_STARTUP_DELAY_SECS: u64 = 60;
const STARTUP_DELAY_SPREAD_SECS: u64 = 240;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// `SB_UPDATE_CHECK=0|false|off` opts out. Debug builds default to off so
/// development runs don't count as deployments; `SB_UPDATE_CHECK=1` opts in.
pub fn enabled(value: Option<&str>, debug: bool) -> bool {
    let value = value.map(|value| value.trim().to_ascii_lowercase());
    match value.as_deref() {
        Some("0" | "false" | "off") => false,
        other if debug => other == Some("1"),
        _ => true,
    }
}

impl UpdateCheck {
    pub fn from_env(data_root: &Path, version: &str) -> Option<Arc<Self>> {
        let setting = std::env::var("SB_UPDATE_CHECK").ok();
        if !enabled(setting.as_deref(), cfg!(debug_assertions)) {
            return None;
        }
        let url = std::env::var("SB_UPDATE_CHECK_URL").unwrap_or_else(|_| DEFAULT_URL.into());
        let kind = std::env::var("SB_INSTALL_KIND").unwrap_or_else(|_| "binary".into());
        Some(Self::load(data_root, version, url, kind))
    }

    /// A stored check from another version is dropped: after an upgrade its answer is stale.
    pub fn load(data_root: &Path, version: &str, url: String, kind: String) -> Arc<Self> {
        let last = std::fs::read(data_root.join(STATE_FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<LastCheck>(&bytes).ok())
            .filter(|last| last.version == version);
        Arc::new(Self {
            data_root: data_root.to_path_buf(),
            version: version.to_string(),
            url,
            kind,
            last: Mutex::new(last),
        })
    }

    pub fn last_check(&self) -> Option<LastCheck> {
        self.last.lock().unwrap().clone()
    }

    pub fn answer(&self) -> Answer {
        self.last_check()
            .map(|last| last.answer)
            .unwrap_or_default()
    }

    pub async fn check_once(&self, client: &reqwest::Client) -> reqwest::Result<()> {
        let answer: Answer = client
            .get(&self.url)
            .query(&[
                ("v", self.version.as_str()),
                ("os", std::env::consts::OS),
                ("arch", std::env::consts::ARCH),
                ("kind", self.kind.as_str()),
            ])
            .header(
                reqwest::header::USER_AGENT,
                format!("SilverBullet-Server/{}", self.version),
            )
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let last = LastCheck {
            version: self.version.clone(),
            checked_at: unix_now(),
            answer,
        };
        // A read-only data root only costs the schedule across restarts; admins still see the result.
        if let Err(error) = self.persist(&last) {
            tracing::debug!("Update check result not saved: {error}");
        }
        *self.last.lock().unwrap() = Some(last);
        Ok(())
    }

    fn persist(&self, last: &LastCheck) -> std::io::Result<()> {
        let path = self.data_root.join(STATE_FILE);
        let tmp = self.data_root.join(format!("{STATE_FILE}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(last)?)?;
        std::fs::rename(&tmp, &path)
    }

    pub fn spawn(self: Arc<Self>, mut shutdown: tokio::sync::watch::Receiver<()>) {
        tokio::spawn(async move {
            let client = match reqwest::Client::builder().build() {
                Ok(client) => client,
                Err(error) => {
                    tracing::debug!("Update check disabled: {error}");
                    return;
                }
            };
            let mut delay = next_delay(
                unix_now(),
                self.last_check().map(|last| last.checked_at),
                random_interval(),
                MIN_STARTUP_DELAY_SECS + random_below(STARTUP_DELAY_SPREAD_SECS + 1),
            );
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = shutdown.changed() => return,
                }
                tokio::select! {
                    result = self.check_once(&client) => {
                        if let Err(error) = result {
                            tracing::debug!("Update check failed: {error}");
                        }
                    }
                    _ = shutdown.changed() => return,
                }
                // Also after a failure: retrying sooner would hammer the site
                // from every offline or air-gapped deployment.
                delay = Duration::from_secs(random_interval());
            }
        });
    }
}

/// Pure scheduling: how long to wait before the next check.
pub fn next_delay(
    now: u64,
    last_checked_at: Option<u64>,
    interval_secs: u64,
    startup_delay_secs: u64,
) -> Duration {
    let secs = match last_checked_at {
        Some(last) if last <= now => (last + interval_secs)
            .saturating_sub(now)
            .max(startup_delay_secs),
        _ => startup_delay_secs,
    };
    Duration::from_secs(secs)
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

fn random_below(n: u64) -> u64 {
    getrandom::u64().unwrap_or_default() % n
}

fn random_interval() -> u64 {
    MIN_INTERVAL_SECS + random_below(INTERVAL_SPREAD_SECS + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::RawQuery;
    use axum::http::StatusCode;
    use axum::routing::get;
    use axum::Json;

    const DAY: u64 = 86_400;

    async fn serve(router: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        format!("http://{addr}/api/server/update-check")
    }

    fn update() -> Update {
        Update {
            version: "9.9.9".into(),
            url: "https://example.test/9-9".into(),
            title: "SilverBullet 9.9".into(),
        }
    }

    fn advisory() -> Advisory {
        Advisory {
            id: "SB-1".into(),
            fixed_in: "1.0.1".into(),
            severity: "high".into(),
            summary: "Bad".into(),
            url: "https://example.test/SB-1".into(),
        }
    }

    fn write_state(dir: &Path, last: &LastCheck) {
        std::fs::write(dir.join(STATE_FILE), serde_json::to_vec(last).unwrap()).unwrap();
    }

    #[test]
    fn never_checked_waits_startup_delay() {
        assert_eq!(next_delay(1000, None, DAY, 120), Duration::from_secs(120));
    }

    #[test]
    fn recent_check_waits_until_due() {
        assert_eq!(
            next_delay(1000 + 3600, Some(1000), DAY, 120),
            Duration::from_secs(DAY - 3600)
        );
    }

    #[test]
    fn overdue_check_uses_startup_delay() {
        let now = 10 * DAY;
        assert_eq!(
            next_delay(now, Some(now - 2 * DAY), DAY, 120),
            Duration::from_secs(120)
        );
    }

    #[test]
    fn future_last_checked_is_due() {
        assert_eq!(
            next_delay(1000, Some(999_999), DAY, 120),
            Duration::from_secs(120)
        );
    }

    #[test]
    fn interval_stays_within_22_to_26_hours() {
        for _ in 0..100 {
            assert!((22 * 3600..=26 * 3600).contains(&random_interval()));
        }
    }

    #[test]
    fn corrupt_state_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(STATE_FILE), "{not json").unwrap();
        let check = UpdateCheck::load(dir.path(), "1.0.0", DEFAULT_URL.into(), "binary".into());
        assert_eq!(check.last_check(), None);
    }

    #[tokio::test]
    async fn check_once_persists_answer() {
        let router = axum::Router::new().route(
            "/api/server/update-check",
            get(|RawQuery(query): RawQuery| async move {
                let query = query.unwrap_or_default();
                let mut keys: Vec<String> = form_urlencoded::parse(query.as_bytes())
                    .map(|(k, _)| k.into_owned())
                    .collect();
                keys.sort();
                assert_eq!(keys, ["arch", "kind", "os", "v"]);
                // Fields the Server doesn't know are ignored
                Json(serde_json::json!({
                    "update": { "version": "9.9.9", "url": "https://example.test/9-9", "title": "SilverBullet 9.9", "summary": "…" },
                    "security": [],
                    "later": true,
                }))
            }),
        );
        let url = serve(router).await;
        let dir = tempfile::tempdir().unwrap();
        let check = UpdateCheck::load(dir.path(), "1.0.0", url, "binary".into());

        check.check_once(&reqwest::Client::new()).await.unwrap();

        assert_eq!(check.answer().update, Some(update()));
        let on_disk: LastCheck =
            serde_json::from_slice(&std::fs::read(dir.path().join(STATE_FILE)).unwrap()).unwrap();
        assert_eq!(Some(on_disk), check.last_check());
        assert_eq!(check.last_check().unwrap().version, "1.0.0");
        assert!(!dir.path().join("update-check.json.tmp").exists());
    }

    #[tokio::test]
    async fn failed_check_keeps_previous_result() {
        let router = axum::Router::new().route(
            "/api/server/update-check",
            get(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        );
        let url = serve(router).await;
        let dir = tempfile::tempdir().unwrap();
        let seeded = LastCheck {
            version: "1.0.0".into(),
            checked_at: 1234,
            answer: Answer {
                update: None,
                security: vec![advisory()],
            },
        };
        write_state(dir.path(), &seeded);
        let check = UpdateCheck::load(dir.path(), "1.0.0", url, "binary".into());

        assert!(check.check_once(&reqwest::Client::new()).await.is_err());

        assert_eq!(check.last_check(), Some(seeded));
    }

    #[tokio::test]
    async fn malformed_answer_is_a_failed_check() {
        let router = axum::Router::new().route(
            "/api/server/update-check",
            get(|| async { Json(serde_json::json!(["not", "an", "answer"])) }),
        );
        let url = serve(router).await;
        let dir = tempfile::tempdir().unwrap();
        let check = UpdateCheck::load(dir.path(), "1.0.0", url, "binary".into());

        assert!(check.check_once(&reqwest::Client::new()).await.is_err());
        assert_eq!(check.last_check(), None);
    }

    #[tokio::test]
    async fn unwritable_data_root_still_shows_result() {
        let router = axum::Router::new().route(
            "/api/server/update-check",
            get(|| async { Json(serde_json::json!({ "update": update(), "security": [] })) }),
        );
        let url = serve(router).await;
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        let check = UpdateCheck::load(&missing, "1.0.0", url, "binary".into());

        check.check_once(&reqwest::Client::new()).await.unwrap();

        assert_eq!(check.answer().update, Some(update()));
        assert!(!missing.exists());
    }

    #[test]
    fn state_from_another_version_is_discarded() {
        let dir = tempfile::tempdir().unwrap();
        let load_after = |version: &str| {
            write_state(
                dir.path(),
                &LastCheck {
                    version: version.into(),
                    checked_at: 1234,
                    answer: Answer {
                        update: None,
                        security: vec![advisory()],
                    },
                },
            );
            UpdateCheck::load(dir.path(), "2.0.0", DEFAULT_URL.into(), "binary".into()).last_check()
        };

        assert_eq!(load_after("2.0.0").map(|last| last.checked_at), Some(1234));
        assert_eq!(load_after("1.0.0"), None);
    }

    #[test]
    fn answer_is_empty_before_the_first_check() {
        let dir = tempfile::tempdir().unwrap();
        let check = UpdateCheck::load(dir.path(), "1.0.0", DEFAULT_URL.into(), "binary".into());
        assert_eq!(
            serde_json::to_value(check.answer()).unwrap(),
            serde_json::json!({ "update": null, "security": [] })
        );
    }

    #[test]
    fn from_env_respects_opt_out() {
        assert!(!enabled(Some("off"), false));
        assert!(!enabled(Some("OFF"), false));
        assert!(!enabled(Some("false"), false));
        assert!(!enabled(Some("0"), false));
        assert!(enabled(None, false));
        assert!(enabled(Some("on"), false));
        assert!(!enabled(None, true));
        assert!(!enabled(Some("on"), true));
        assert!(enabled(Some("1"), true));
    }
}
