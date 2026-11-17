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
pub(crate) async fn run_setup_server(
    config: crate::config::Config,
    shutdown: crate::server::Shutdown,
) -> Result<(), String> {
    use silverbullet_server::multi::setup_api::{build_setup_router, SetupState};

    use crate::embed::{ClientAssets, EmbeddedSpace};

    let root = std::path::PathBuf::from(&config.data_folder);
    std::fs::create_dir_all(&root).map_err(|e| format!("could not create data folder: {e}"))?;

    // `on_complete` runs on the request thread and must stay cheap and
    // non-blocking, so it only signals. A dedicated task does the heavy lifting
    // (building the multi stack can bind a metrics port and boot every space).
    let ready = Arc::new(tokio::sync::Notify::new());
    let signal = ready.clone();
    let state = Arc::new(SetupState {
        root: root.clone(),
        client_bundle: Box::new(EmbeddedSpace::<ClientAssets>::new()),
        version: crate::VERSION.to_string(),
        index_template: crate::DEFAULT_INDEX_MD.to_string(),
        on_complete: Box::new(move || signal.notify_one()),
        complete_lock: tokio::sync::Mutex::new(()),
    });

    let (handle, outer) = SwappableRouter::new(build_setup_router(state));

    // Wait for setup to finish, then hot-swap the multi stack into place. The
    // swapped-in stack's spaces need the same shutdown signal as the wizard's
    // own `with_graceful_shutdown` below, so its `rx` is cloned before
    // `shutdown.future` is consumed by `axum::serve`.
    let swap_config = config.clone();
    let swap_shutdown_rx = shutdown.rx.clone();
    tokio::spawn(async move {
        ready.notified().await;
        match crate::multi::build_multi_stack(&swap_config, Some(swap_shutdown_rx)).await {
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

    match &config.unix_socket {
        Some(socket) => tracing::info!(
            "SilverBullet setup wizard listening on unix://{socket}: open /.setup/ through your reverse proxy"
        ),
        None => tracing::info!(
            "SilverBullet setup wizard: open {}/.setup/",
            crate::server::startup_url(&config.bind_host, config.port)
        ),
    }
    crate::server::serve(&config, outer, shutdown).await
}

/// Serve the migration flow for a legacy single-space folder on `config`'s
/// address. Like [`run_setup_server`], the listener stays bound: once the
/// migration finishes, the multi-space stack is swapped in place.
pub(crate) async fn run_migrate_server(
    config: crate::config::Config,
    shutdown: crate::server::Shutdown,
) -> Result<(), String> {
    use silverbullet_server::multi::migrate::api::{build_migrate_router, Gate, MigrateState};

    use crate::embed::{ClientAssets, EmbeddedSpace};

    let (env, secrets, gate) = crate::legacy_env::legacy_env(&config, &|k| std::env::var(k).ok())?;
    let flow = format!("{}/.setup/migrate/", env.url_prefix);
    let gate_hint = match &gate {
        Gate::Credentials(_) => "sign in with your SB_USER credentials".to_string(),
        Gate::SetupCode(code) => format!("enter setup code {code}"),
    };

    let (handle, outer) = SwappableRouter::new(Router::new());
    let handle = Arc::new(handle);
    let swap = handle.clone();
    let swap_config = config.clone();
    let swap_shutdown_rx = shutdown.rx.clone();
    let state = Arc::new(MigrateState {
        root: std::path::PathBuf::from(&config.data_folder),
        env,
        secrets,
        gate,
        client_bundle: Box::new(EmbeddedSpace::<ClientAssets>::new()),
        version: crate::VERSION.to_string(),
        on_complete: Box::new(move || {
            let (swap, config, shutdown_rx) =
                (swap.clone(), swap_config.clone(), swap_shutdown_rx.clone());
            Box::pin(async move {
                let (router, log) = crate::multi::build_multi_stack(&config, Some(shutdown_rx))
                    .await
                    .inspect_err(|e| {
                        tracing::error!("bringing up the multi-space stack failed: {e}")
                    })?;
                swap.swap(router);
                tracing::info!("migration complete: now serving multi-space: {log}");
                Ok(())
            })
        }),
        run_lock: tokio::sync::Mutex::new(()),
    });
    handle.swap(build_migrate_router(state));

    match &config.unix_socket {
        Some(socket) => tracing::info!(
            "This folder holds a single-space install that needs migrating. Listening on unix://{socket}: open {flow} through your reverse proxy and {gate_hint}"
        ),
        None => tracing::info!(
            "This folder holds a single-space install that needs migrating. Open {}{flow} and {gate_hint}",
            crate::server::startup_url(&config.bind_host, config.port)
        ),
    }
    crate::server::serve(&config, outer, shutdown).await
}

#[derive(Debug)]
pub enum BootMode {
    Multi,
    /// A legacy single-space folder, or an interrupted migration.
    Migrate,
    Setup,
}

pub fn detect(folder: &Path, env: &dyn Fn(&str) -> Option<String>) -> Result<BootMode, String> {
    // A migration writes spaces.json last, so a crash can leave both behind.
    // A journal that can't be read still goes to the migration page, which
    // shows the error.
    if !matches!(
        silverbullet_server::multi::migrate::pending_journal(folder),
        Ok(None)
    ) {
        tracing::info!("boot mode: migration (an interrupted migration's journal is present)");
        return Ok(BootMode::Migrate);
    }
    if folder.join("spaces.json").is_file() {
        // A missing users.json can be repaired by setup, preserving existing
        // spaces. An existing one, even `{}` or without an admin, is an
        // accountless or admin-less server and boots as is.
        if silverbullet_server::multi::users::UsersConfig::load(&folder.join("users.json"))?
            .is_none()
        {
            tracing::info!(
                "boot mode: setup (spaces.json present, but no users.json — no admin yet)"
            );
            return Ok(BootMode::Setup);
        }
        tracing::info!("boot mode: multi-space (spaces.json present)");
        return Ok(BootMode::Multi);
    }
    let non_empty = std::fs::read_dir(folder)
        .map(|rd| {
            rd.flatten()
                .any(|e| !e.file_name().to_string_lossy().starts_with('.'))
        })
        .unwrap_or(false);
    if non_empty {
        tracing::info!("boot mode: migration (folder is not empty and has no spaces.json)");
        return Ok(BootMode::Migrate);
    }
    for var in crate::multi::IGNORED_IN_MULTI {
        if env(var).is_some_and(|v| !v.is_empty()) {
            tracing::warn!(
                "{var} is ignored: this folder is empty, so there is nothing to migrate"
            );
        }
    }
    tracing::info!("boot mode: unconfigured (empty folder)");
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
        assert_eq!(status(&outer).await, 418);
        handle.swap(answering(200));
        assert_eq!(status(&outer).await, 200);
    }

    /// The swap to multi-space happens even when the client that started
    /// the migration is gone before it finishes.
    #[tokio::test]
    async fn a_dropped_migration_request_still_swaps_to_multi_space() {
        use axum::body::Body;
        use axum::http::{header, StatusCode};
        use silverbullet_server::multi::migrate::api::{build_migrate_router, Gate, MigrateState};

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("index.md"), "# Legacy").unwrap();
        let config =
            crate::config::Config::from_env(None, Some(3000), Some(root.display().to_string()))
                .unwrap();
        let (env, secrets, _) = crate::legacy_env::legacy_env(&config, &|_| None).unwrap();
        let mut edits = silverbullet_server::multi::migrate::default_edits(&env);
        edits.admin = silverbullet_server::multi::migrate::AdminChoice::NoAccounts;

        let (handle, outer) = SwappableRouter::new(Router::new());
        let handle = Arc::new(handle);
        let swap = handle.clone();
        let state = Arc::new(MigrateState {
            root: root.clone(),
            env,
            secrets,
            gate: Gate::SetupCode("ABCD2345".into()),
            client_bundle: Box::new(
                crate::embed::EmbeddedSpace::<crate::embed::ClientAssets>::new(),
            ),
            version: "test".into(),
            on_complete: Box::new(move || {
                swap.swap(Router::new().fallback(|| async { StatusCode::NOT_FOUND }));
                Box::pin(async { Ok(()) })
            }),
            run_lock: tokio::sync::Mutex::new(()),
        });
        handle.swap(build_migrate_router(state.clone()));

        let post = |uri: &str, body: String, cookie: Option<&str>| {
            let mut req = Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json");
            if let Some(cookie) = cookie {
                req = req.header(header::COOKIE, cookie);
            }
            req.body(Body::from(body)).unwrap()
        };
        let status = |outer: &Router| {
            outer.clone().oneshot(
                Request::builder()
                    .uri("/.setup/migrate/api/status")
                    .body(Body::empty())
                    .unwrap(),
            )
        };

        let resp = outer
            .clone()
            .oneshot(post(
                "/.setup/migrate/api/login",
                r#"{"code":"ABCD2345"}"#.into(),
                None,
            ))
            .await
            .unwrap();
        let cookie = resp.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        assert_eq!(status(&outer).await.unwrap().status(), StatusCode::OK);

        let held = state.run_lock.lock().await;
        let body = serde_json::json!({ "edits": edits, "backupConfirmed": true }).to_string();
        let request = outer
            .clone()
            .oneshot(post("/.setup/migrate/api/run", body, Some(&cookie)));
        let gave_up = tokio::time::timeout(std::time::Duration::from_millis(200), request).await;
        assert!(gave_up.is_err(), "the run should wait for the lock");
        drop(held);

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while status(&outer).await.unwrap().status() != StatusCode::NOT_FOUND {
            assert!(
                std::time::Instant::now() < deadline,
                "never swapped to multi-space"
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(root.join("spaces.json").exists());
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
        let m = detect(dir.path(), &env(&[])).unwrap();
        assert!(matches!(m, BootMode::Setup));
    }

    #[test]
    fn dotfiles_do_not_make_a_folder_non_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".DS_Store"), "x").unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Setup
        ));
    }

    #[test]
    fn non_empty_folder_is_migrate() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.md"), "# hi").unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Migrate
        ));
    }

    fn write_journal(root: &Path) {
        use silverbullet_server::multi::migrate::{
            synthesize_space, AdminPlan, Journal, MigrationPlan, SingleSpaceSettings, JOURNAL_FILE,
        };
        let space = synthesize_space(
            &SingleSpaceSettings {
                name: "Notes".into(),
                url_prefix: String::new(),
                read_only: false,
                index_page: "index".into(),
                description: String::new(),
                theme_color: String::new(),
                head_html: String::new(),
                space_ignore: String::new(),
                log_push: false,
                revisions: Default::default(),
            },
            silverbullet_server::shell::ShellConfig::from_env(false),
        );
        let journal = Journal {
            plan: MigrationPlan {
                moves: Vec::new(),
                space_id: "notes".into(),
                space,
                admin: AdminPlan::NoAccounts,
                api_token: false,
                search_model: None,
                runtime_api: true,
                runtime_idle_timeout: None,
                env_to_remove: Vec::new(),
                url_changed: false,
                blockers: Vec::new(),
            },
            users: Default::default(),
            salt: None,
            keep_auth_file: false,
        };
        std::fs::write(
            root.join(JOURNAL_FILE),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
    }

    /// A migration writes `spaces.json` last: a crash right after leaves it
    /// next to the journal, and the migration still has to finish.
    #[test]
    fn pending_journal_is_migrate() {
        let dir = tempfile::tempdir().unwrap();
        write_journal(dir.path());
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join("users.json"), "{}").unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Migrate
        ));
    }

    /// The migration page shows a damaged journal; it never reads as "no journal".
    #[test]
    fn damaged_journal_is_migrate() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path()
                .join(silverbullet_server::multi::migrate::JOURNAL_FILE),
            "{ not json",
        )
        .unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join("users.json"), "{}").unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Migrate
        ));
    }

    #[test]
    fn missing_folder_is_setup() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(matches!(
            detect(&missing, &env(&[])).unwrap(),
            BootMode::Setup
        ));
    }

    #[test]
    fn legacy_env_on_empty_folder_is_setup() {
        let dir = tempfile::tempdir().unwrap();
        for var in ["SB_USER", "SB_NAME", "SB_READ_ONLY", "SB_URL_PREFIX"] {
            let m = detect(dir.path(), &env(&[(var, "x:y")])).unwrap();
            assert!(matches!(m, BootMode::Setup), "{var} must not select a mode");
        }
    }

    #[test]
    fn spaces_json_means_multi_and_users_json_gates_it() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Setup
        ));
        std::fs::write(
            dir.path().join("users.json"),
            r#"{"root":{"passwordHash":"$argon2id$x","admin":true}}"#,
        )
        .unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Multi
        ));
    }

    /// Accounts are optional: a users.json with no admin (or no users at all)
    /// is an accountless server whose spaces are configured by editing
    /// spaces.json, so it boots multi-space rather than failing.
    #[test]
    fn spaces_json_with_adminless_users_json_is_multi() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join("users.json"), "{}").unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Multi
        ));
        std::fs::write(
            dir.path().join("users.json"),
            r#"{"bob":{"passwordHash":"$argon2id$x","admin":false}}"#,
        )
        .unwrap();
        assert!(matches!(
            detect(dir.path(), &env(&[])).unwrap(),
            BootMode::Multi
        ));
    }

    #[test]
    fn spaces_json_with_malformed_users_json_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join("users.json"), "{ not json").unwrap();
        assert!(detect(dir.path(), &env(&[])).is_err());
    }

    /// Leftover legacy env vars next to `spaces.json` are logged as ignored
    /// (by the multi stack), never a reason to refuse boot.
    #[test]
    fn spaces_json_with_sb_user_is_multi() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{}").unwrap();
        std::fs::write(dir.path().join("users.json"), "{}").unwrap();
        for (var, value) in [
            ("SB_USER", "a:b"),
            ("SB_AUTH_TOKEN", "t"),
            ("SB_READ_ONLY", "1"),
        ] {
            assert!(
                matches!(
                    detect(dir.path(), &env(&[(var, value)])).unwrap(),
                    BootMode::Multi
                ),
                "{var}"
            );
        }
    }
}
