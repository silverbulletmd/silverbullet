//! Single-space mode as a one-space config on the multi engine.
//!
//! Now a thin synthesis: the classic `SB_*` environment surface is folded into
//! a single `SpaceConfig` bound to the whole origin, booted in-memory (never
//! touching `spaces.json`) through the same `MultiManager`/dispatcher the
//! multi-space server uses. This keeps exactly one code path for building and
//! serving a space.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

use silverbullet_server::metrics::Metrics;
use silverbullet_server::multi::config::{Binding, MultiConfig, ShellSettings, SpaceConfig};
use silverbullet_server::multi::dispatch::build_main_router;
use silverbullet_server::multi::instance::{
    seed_index, AssetFactories, InstanceAuth, InstanceDeps,
};
use silverbullet_server::multi::manager::MultiManager;
use silverbullet_server::shell::ShellConfig;

use crate::config::Config;
use crate::embed::{BaseFsAssets, ClientAssets, EmbeddedSpace};

/// The single space's synthetic id. It is never persisted or user-visible; the
/// space is always root-bound, so the id only labels the instance internally.
const SINGLE_SPACE_ID: &str = "single";

/// Fold the parsed `Config` (and a couple of env-derived inputs) into the one
/// `SpaceConfig` that single-space mode serves. Kept pure and split from the
/// env reads so it is deterministically unit-testable.
fn synthesize(config: &Config, shell_env: ShellConfig) -> SpaceConfig {
    let prefix = if config.host_url_prefix.is_empty() {
        "/".to_string()
    } else {
        config.host_url_prefix.clone()
    };

    SpaceConfig {
        name: config.space_name.clone(),
        folder: ".".to_string(),
        binding: Binding::Prefix { prefix },
        public: false,
        members: Default::default(),
        read_only: config.read_only,
        shell: ShellSettings {
            enabled: !config.read_only && shell_env.enabled,
            whitelist: shell_env.whitelist,
        },
        // The Chrome runtime factory still decides availability via
        // `ChromeConfig::from_env` (SB_RUNTIME_API), exactly as before.
        runtime_api: true,
        index_page: config.index_page.clone(),
        description: config.space_description.clone(),
        theme_color: config.theme_color.clone(),
        head_html: config.additional_head_html.clone(),
        space_ignore: config.gitignore.clone(),
        log_push: config.log_push,
        extra: Default::default(),
    }
}

/// Synthesize the single space from the current environment + parsed `Config`.
pub fn synthesize_config(config: &Config) -> SpaceConfig {
    synthesize(config, ShellConfig::from_env(config.read_only))
}

/// The router mounted at `/.spaces` in single mode: there is no space/account
/// management UI (the one space is configured through env vars, not accounts),
/// so every path under it explains that and 404s.
fn single_spaces_info_router() -> axum::Router {
    axum::Router::new().fallback(|| async {
        (
            axum::http::StatusCode::NOT_FOUND,
            [(axum::http::header::CONTENT_TYPE, "text/html")],
            "<html><body><h1>Single-space mode</h1>\
             This server runs in single-space mode, no space management available.\
             </body></html>",
        )
    })
}

pub async fn run_single(config: Config) -> Result<(), String> {
    let root = PathBuf::from(&config.space_folder);
    // Note: this is a deliberate behavior change from the old single-space
    // binary, not parity — the old binary errored on a missing space folder
    // (`DiskSpacePrimitives::new` failed and `build_state` propagated that as
    // a startup error). Auto-creating it here is owner-accepted: `run_single`
    // is only reached via `--single` or a legacy `SB_*` env var, both of which
    // take precedence over folder inspection in `boot::detect` — so
    // `--single ./new-dir` and Docker-style `SB_USER=... /space` on a fresh
    // mount still get instant single-space mode with the folder created for
    // them, even though a missing folder with no flag/env now goes to setup.
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("could not create space folder {}: {e}", root.display()))?;

    let space = synthesize_config(&config);

    // Seed an index page into a brand-new empty space. The space folder is the
    // server root (folder ".").
    seed_index(
        &root,
        &space.index_page,
        crate::DEFAULT_INDEX_MD,
        &config.gitignore,
    );

    // `SB_USER` set => inherit the admin (env) credentials; absent => open.
    let auth = silverbullet_server::auth::AuthConfig::from_env().map_err(|e| e.0)?;

    let metrics = config.metrics_port.map(|_| Arc::new(Metrics::new()));

    let deps = InstanceDeps {
        root: root.clone(),
        assets: AssetFactories {
            client_bundle: Box::new(|| Box::new(EmbeddedSpace::<ClientAssets>::new())),
            base_fs: Box::new(|| Box::new(EmbeddedSpace::<BaseFsAssets>::new())),
        },
        runtime: Box::new(crate::multi::build_space_runtime),
        metrics: metrics.clone(),
        auth: InstanceAuth::Single(auth),
        version: crate::VERSION.to_string(),
        main_port: config.port,
        disable_service_worker: config.disable_service_worker,
        index_template: crate::DEFAULT_INDEX_MD.to_string(),
    };

    let mut spaces = HashMap::new();
    spaces.insert(SINGLE_SPACE_ID.to_string(), space);
    let manager = MultiManager::boot_in_memory(root, MultiConfig { spaces }, deps)?;

    // Optional Prometheus metrics on a separate port (aggregated in `metrics`).
    if let (Some(mport), Some(metrics)) = (config.metrics_port, metrics.clone()) {
        let maddr = format!("{}:{}", config.bind_host, mport);
        let listener = tokio::net::TcpListener::bind(&maddr)
            .await
            .map_err(|e| format!("failed to bind metrics on {maddr}: {e}"))?;
        let mrouter = axum::Router::new().route(
            "/metrics",
            axum::routing::get(move || {
                let metrics = metrics.clone();
                async move {
                    (
                        [(
                            axum::http::header::CONTENT_TYPE,
                            "text/plain; version=0.0.4",
                        )],
                        metrics.gather(),
                    )
                }
            }),
        );
        tracing::info!("metrics on http://{maddr}/metrics");
        tokio::spawn(async move {
            let _ = axum::serve(listener, mrouter).await;
        });
    }

    let router = build_main_router(
        manager,
        Some(single_spaces_info_router()),
        crate::VERSION.to_string(),
    );
    let router = if config.http_logging {
        router.layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
    } else {
        router
    };

    if config.bind_host == "127.0.0.1" {
        tracing::info!(
            "SilverBullet is only available locally; pass -L0.0.0.0 (behind a TLS terminator) to expose it"
        );
    }

    if let Some(socket) = &config.unix_socket {
        crate::server::serve_unix(socket, router).await
    } else {
        crate::server::serve_tcp(&config.bind_host, config.port, router).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `Config` fixture with defaults matching `Config::from_env` when no
    /// `SB_*` are set. Fields are overridden per-test.
    fn config_fixture() -> Config {
        Config {
            bind_host: "127.0.0.1".into(),
            port: 3000,
            unix_socket: None,
            metrics_port: None,
            space_folder: "/tmp/space".into(),
            gitignore: String::new(),
            read_only: false,
            index_page: "index".into(),
            space_name: "SilverBullet".into(),
            disable_service_worker: false,
            log_push: false,
            additional_head_html: String::new(),
            theme_color: "#e1e1e1".into(),
            space_description: "Powerful and programmable note taking app".into(),
            host_url_prefix: String::new(),
            http_logging: false,
        }
    }

    fn shell_on() -> ShellConfig {
        ShellConfig {
            enabled: true,
            whitelist: vec![],
        }
    }

    #[test]
    fn root_prefix_when_no_url_prefix() {
        let c = config_fixture();
        let s = synthesize(&c, shell_on());
        assert!(matches!(&s.binding, Binding::Prefix { prefix } if prefix == "/"));
    }

    #[test]
    fn url_prefix_override_is_carried_through() {
        let mut c = config_fixture();
        c.host_url_prefix = "/wiki".into(); // already normalized by Config::from_env
        let s = synthesize(&c, shell_on());
        assert!(matches!(&s.binding, Binding::Prefix { prefix } if prefix == "/wiki"));
    }

    #[test]
    fn read_only_propagates_and_disables_shell() {
        let mut c = config_fixture();
        c.read_only = true;
        // Even if the env parser reported shell enabled, read-only wins.
        let s = synthesize(&c, shell_on());
        assert!(s.read_only);
        assert!(!s.shell.enabled);
    }

    #[test]
    fn shell_whitelist_flows_through_when_writable() {
        let c = config_fixture();
        let shell = ShellConfig {
            enabled: true,
            whitelist: vec!["git".into(), "npm".into()],
        };
        let s = synthesize(&c, shell);
        assert!(s.shell.enabled);
        assert_eq!(s.shell.whitelist, vec!["git", "npm"]);
    }

    #[test]
    fn core_fields_map_from_config() {
        let mut c = config_fixture();
        c.space_name = "My Notes".into();
        c.index_page = "home".into();
        c.gitignore = "*.tmp".into();
        c.theme_color = "#123456".into();
        c.log_push = true;
        let s = synthesize(&c, shell_on());
        assert_eq!(s.name, "My Notes");
        assert_eq!(s.index_page, "home");
        assert_eq!(s.space_ignore, "*.tmp");
        assert_eq!(s.theme_color, "#123456");
        assert!(s.log_push);
        assert_eq!(s.folder, ".");
        assert!(s.runtime_api);
    }
}
