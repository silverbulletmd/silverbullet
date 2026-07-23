//! Boot-mode detection. Every boot logs the decision and why.

use std::path::Path;
use std::sync::{Arc, RwLock};

use axum::extract::Request;
use axum::Router;
use tower::ServiceExt;

/// A live, atomically-replaceable router.
pub struct SwappableRouter(Arc<RwLock<Router>>);

impl SwappableRouter {
    /// Build a handle plus the outer router to serve. The outer router forwards
    /// every request to whatever inner router is currently installed.
    pub fn new(initial: Router) -> (Self, Router) {
        let inner = Arc::new(RwLock::new(initial));
        let cloned = inner.clone();
        let outer = Router::new().fallback_service(tower::service_fn(move |req: Request| {
            // Clone the current inner router out from under the lock, then
            // release it before awaiting so a concurrent `swap` never blocks on
            // an in-flight request.
            let r = cloned
                .read()
                .expect("swappable router lock poisoned")
                .clone();
            async move { r.oneshot(req).await }
        }));
        (SwappableRouter(inner), outer)
    }

    /// Replace the inner router. Requests already in flight keep running against
    /// the router they were dispatched to, new requests hit `next`.
    pub fn swap(&self, next: Router) {
        *self.0.write().expect("swappable router lock poisoned") = next;
    }
}

/// Serve the first-run setup wizard on `config`'s address. The listener stays
/// bound for the process's whole life: once the wizard's `POST
/// /.setup/api/complete` provisions the root, a background task builds the full
/// multi-space stack and swaps it into the live router in place.
pub async fn run_setup_server(config: crate::config::Config) -> Result<(), String> {
    use silverbullet_server::multi::setup_api::{build_setup_router, SetupState};

    use crate::embed::{ClientAssets, EmbeddedSpace};

    // The setup wizard always binds TCP (see the listener below), and the
    // background task it schedules on completion hands off to
    // `build_multi_stack`, which also only binds TCP.
    if config.unix_socket.is_some() {
        return Err(
            "SB_UNIX_SOCKET is not supported in multi-space/setup mode — remove it or run with --single"
                .to_string(),
        );
    }

    let root = std::path::PathBuf::from(&config.space_folder);
    std::fs::create_dir_all(&root).map_err(|e| format!("could not create server root: {e}"))?;

    // `on_complete` runs on the request thread and must stay cheap and
    // non-blocking, so it only signals. A dedicated task does the heavy lifting
    // (building the multi stack can bind a metrics port and boot every space).
    let ready = Arc::new(tokio::sync::Notify::new());
    let signal = ready.clone();
    let state = Arc::new(SetupState {
        root: root.clone(),
        client_bundle: Box::new(EmbeddedSpace::<ClientAssets>::new()),
        index_template: crate::DEFAULT_INDEX_MD.to_string(),
        on_complete: Box::new(move || signal.notify_one()),
        complete_lock: tokio::sync::Mutex::new(()),
    });

    let (handle, outer) = SwappableRouter::new(build_setup_router(state));

    // Wait for setup to finish, then hot-swap the multi stack into place.
    let swap_config = config.clone();
    tokio::spawn(async move {
        ready.notified().await;
        match crate::multi::build_multi_stack(&swap_config).await {
            Ok((router, log)) => {
                handle.swap(router);
                tracing::info!("setup complete: now serving multi-space: {log}");
            }
            Err(e) => {
                tracing::error!(
                    "setup completed, but bringing up the multi-space stack failed: {e}"
                );
            }
        }
    });

    let addr = format!("{}:{}", config.bind_host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("failed to listen on {addr}: {e}"))?;
    tracing::info!("SilverBullet setup wizard running: http://{addr}/.setup/");
    axum::serve(listener, outer)
        .with_graceful_shutdown(crate::server::shutdown_signal())
        .await
        .map_err(|e| format!("server error: {e}"))
}

pub const LEGACY_ENV_VARS: &[&str] = &[
    "SB_USER",
    "SB_AUTH_TOKEN",
    "SB_READ_ONLY",
    "SB_NAME",
    "SB_INDEX_PAGE",
    "SB_DESCRIPTION",
    "SB_THEME_COLOR",
    "SB_HEAD_HTML",
    "SB_SPACE_IGNORE",
    "SB_LOG_PUSH",
    "SB_URL_PREFIX",
    "SB_SHELL_WHITELIST",
    "SB_LOCKOUT_LIMIT",
    "SB_LOCKOUT_TIME",
    "SB_REMEMBER_ME_HOURS",
    "SB_UNIX_SOCKET",
];

#[derive(Debug)]
pub enum BootMode {
    Multi,
    Single,
    Setup,
}

pub fn detect(
    folder: &Path,
    single_flag: bool,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<BootMode, String> {
    let has_spaces_json = folder.join("spaces.json").is_file();
    if has_spaces_json {
        if single_flag {
            return Err(
                "this folder contains spaces.json (multi-space config) but --single was passed. \
                 Remove the flag or point --single at a different folder"
                    .into(),
            );
        }
        if env("SB_USER").is_some() {
            return Err(
                "this folder contains spaces.json (multi-space config) but SB_USER is set. \
                 Accounts now live in users.json — unset SB_USER"
                    .into(),
            );
        }
        if env("SB_AUTH_TOKEN").is_some() {
            return Err(
                "this folder contains spaces.json (multi-space config) but SB_AUTH_TOKEN is set. \
                 Accounts/API tokens replace SB_AUTH_TOKEN — manage tokens in the admin UI"
                    .into(),
            );
        }
        // No users.json at all: the root is only half-configured (a hand-written
        // spaces.json), so run the setup wizard to mint the admin account. It
        // loads the existing spaces.json and adds to it, leaving those spaces
        // intact. A users.json that exists but holds no admin can't be fixed
        // that way — `run_setup` refuses once users.json is there — so say so
        // rather than looping the operator through a wizard that will 400.
        match silverbullet_server::multi::users::UsersConfig::load(&folder.join("users.json"))? {
            None => {
                tracing::info!(
                    "boot mode: setup (spaces.json present, but no users.json — no admin yet)"
                );
                return Ok(BootMode::Setup);
            }
            Some(cfg) if !cfg.users.values().any(|u| u.admin) => {
                return Err(
                    "users.json contains no admin account, so nobody could administer this \
                     server. Set \"admin\": true on a user in users.json and restart"
                        .into(),
                );
            }
            Some(_) => {}
        }
        tracing::info!("boot mode: multi-space (spaces.json present)");
        return Ok(BootMode::Multi);
    }
    if single_flag {
        tracing::info!("boot mode: single-space (--single)");
        return Ok(BootMode::Single);
    }
    if let Some(var) = LEGACY_ENV_VARS.iter().find(|v| env(v).is_some()) {
        tracing::info!("boot mode: single-space ({var} is set)");
        return Ok(BootMode::Single);
    }
    let non_empty = std::fs::read_dir(folder)
        .map(|rd| {
            rd.flatten()
                .any(|e| !e.file_name().to_string_lossy().starts_with('.'))
        })
        // Missing folder: treat exactly like an existing empty folder.
        .unwrap_or(false);
    if non_empty {
        tracing::info!("boot mode: single-space (folder is not empty)");
        return Ok(BootMode::Single);
    }
    tracing::info!("boot mode: unconfigured (empty folder, no flags, no legacy env)");
    Ok(BootMode::Setup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[tokio::test]
    async fn swappable_router_reflects_swaps_through_the_same_service() {
        use axum::body::Body;
        use axum::http::StatusCode;

        fn answering(code: u16) -> Router {
            Router::new().fallback(move || async move { StatusCode::from_u16(code).unwrap() })
        }
        async fn status(router: &Router) -> u16 {
            router
                .clone()
                .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status()
                .as_u16()
        }

        let (handle, outer) = SwappableRouter::new(answering(418));
        // Before the swap the outer service answers with the initial router.
        assert_eq!(status(&outer).await, 418);
        // After swapping, the very same outer service answers with the new one.
        handle.swap(answering(200));
        assert_eq!(status(&outer).await, 200);
    }

    /// A minimal `Config` for tests that don't care about most fields.
    fn test_config(space_folder: &str, unix_socket: Option<&str>) -> crate::config::Config {
        let mut config = crate::config::Config::from_env(
            Some("127.0.0.1".to_string()),
            Some(0),
            Some(space_folder.to_string()),
        )
        .unwrap();
        config.unix_socket = unix_socket.map(str::to_string);
        config
    }

    #[tokio::test]
    async fn run_setup_server_rejects_unix_socket() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path().to_str().unwrap(), Some("/tmp/sb.sock"));
        let err = run_setup_server(config)
            .await
            .expect_err("must reject SB_UNIX_SOCKET");
        assert!(err.contains("SB_UNIX_SOCKET"), "{err}");
        assert!(err.contains("--single"), "{err}");
    }

    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| m.get(k).cloned()
    }

    #[test]
    fn empty_folder_no_env_is_setup() {
        let dir = tempfile::tempdir().unwrap();
        let m = detect(dir.path(), false, &env(&[])).unwrap();
        assert!(matches!(m, BootMode::Setup));
    }

    #[test]
    fn dotfiles_do_not_make_a_folder_non_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".DS_Store"), "x").unwrap();
        assert!(matches!(
            detect(dir.path(), false, &env(&[])).unwrap(),
            BootMode::Setup
        ));
    }

    #[test]
    fn non_empty_folder_is_single() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), "# hi").unwrap();
        assert!(matches!(
            detect(dir.path(), false, &env(&[])).unwrap(),
            BootMode::Single
        ));
    }

    #[test]
    fn missing_folder_is_setup() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(matches!(
            detect(&missing, false, &env(&[])).unwrap(),
            BootMode::Setup
        ));
    }

    #[test]
    fn legacy_env_forces_single_even_on_empty_folder() {
        let dir = tempfile::tempdir().unwrap();
        for var in LEGACY_ENV_VARS {
            let m = detect(dir.path(), false, &env(&[(var, "x")])).unwrap();
            assert!(
                matches!(m, BootMode::Single),
                "{var} must force single mode"
            );
        }
    }

    #[test]
    fn single_flag_forces_single() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            detect(dir.path(), true, &env(&[])).unwrap(),
            BootMode::Single
        ));
    }

    #[test]
    fn spaces_json_means_multi_and_users_json_gates_it() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        // No users.json at all -> run setup to mint the admin account.
        assert!(matches!(
            detect(dir.path(), false, &env(&[])).unwrap(),
            BootMode::Setup
        ));
        // A users.json holding an admin account -> serve multi-space.
        std::fs::write(
            dir.path().join("users.json"),
            r#"{"root":{"passwordHash":"$argon2id$x","admin":true}}"#,
        )
        .unwrap();
        assert!(matches!(
            detect(dir.path(), false, &env(&[])).unwrap(),
            BootMode::Multi
        ));
    }

    /// A users.json that exists but holds no admin is unserviceable and
    /// unfixable by the wizard (`run_setup` refuses once users.json is there),
    /// so it must be a hard error rather than a setup loop that 400s.
    #[test]
    fn spaces_json_with_adminless_users_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        // Empty users.json ({}): zero accounts, so zero admins.
        std::fs::write(dir.path().join("users.json"), "{}").unwrap();
        let err = detect(dir.path(), false, &env(&[])).expect_err("no admin must fail");
        assert!(err.contains("no admin account"), "{err}");
        // Only non-admin accounts is the same story.
        std::fs::write(
            dir.path().join("users.json"),
            r#"{"bob":{"passwordHash":"$argon2id$x","admin":false}}"#,
        )
        .unwrap();
        assert!(detect(dir.path(), false, &env(&[])).is_err());
    }

    #[test]
    fn spaces_json_with_malformed_users_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join("users.json"), "{ not json").unwrap();
        assert!(detect(dir.path(), false, &env(&[])).is_err());
    }

    #[test]
    fn spaces_json_plus_single_flag_or_credential_env_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        assert!(detect(dir.path(), true, &env(&[])).is_err());
        assert!(detect(dir.path(), false, &env(&[("SB_USER", "a:b")])).is_err());
        assert!(detect(dir.path(), false, &env(&[("SB_AUTH_TOKEN", "t")])).is_err());
        assert!(detect(dir.path(), false, &env(&[("SB_READ_ONLY", "1")])).is_ok());
    }
}
