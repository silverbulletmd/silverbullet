//! The main listener's request dispatcher: `/.spaces` is reserved, then Host
//! header, then longest prefix. Matched requests are forwarded to the space's
//! own (unchanged) Core router with the prefix stripped.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Router;
use tower::ServiceExt;

use crate::multi::instance::{InstanceStatus, SpaceInstance};
use crate::multi::manager::MultiManager;

#[derive(Clone)]
struct MainState {
    manager: Arc<MultiManager>,
    /// Whether `/.spaces` is mounted. The fallback only needs to know *if* the
    /// surface exists (to redirect `/` there), never to invoke it.
    spaces_mounted: bool,
}

pub fn build_main_router(
    manager: Arc<MultiManager>,
    spaces_router: Option<Router>,
    version: String,
) -> Router {
    // Serve before host/prefix resolution so hostname probes and Docker
    // health checks work regardless of space bindings. Only a per-boot UUID
    // is exposed across origins.
    let spaces_mounted = spaces_router.is_some();
    let instance_id = uuid::Uuid::new_v4().to_string();
    let body = serde_json::json!({ "instance": instance_id, "version": version }).to_string();
    let instance_handler = move || {
        let body = body.clone();
        async move {
            (
                [
                    (axum::http::header::CONTENT_TYPE, "application/json"),
                    (axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
                ],
                body,
            )
        }
    };
    let mut router = Router::new().route("/.instance", axum::routing::get(instance_handler));
    if let Some(spaces) = spaces_router {
        router = router.nest_service(crate::multi::space_index::SPACES_PREFIX, spaces);
    }
    router
        .fallback(dispatch)
        .layer(middleware::from_fn_with_state(
            manager.clone(),
            manager_origin,
        ))
        .layer(middleware::from_fn_with_state(
            manager.clone(),
            runtime_origin,
        ))
        .with_state(MainState {
            manager,
            spaces_mounted,
        })
}

async fn runtime_origin(
    State(manager): State<Arc<MultiManager>>,
    req: Request,
    next: Next,
) -> Response {
    let host = crate::auth::request_host(req.headers());
    let host = host
        .split(':')
        .next()
        .unwrap_or("")
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if !host.ends_with(".runtime.localhost") {
        return next.run(req).await;
    }
    let Some(instance) = manager.registry().current().resolve_runtime(&host) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let context = crate::auth::AuthContext {
        method: req.method(),
        path: req.uri().path(),
        query: req.uri().query(),
        headers: req.headers(),
    };
    if crate::auth::cookie_value(
        req.headers(),
        &crate::auth::headless_cookie_name(&instance.id),
    )
    .is_none()
        || !instance
            .runtime_authorizer
            .as_ref()
            .is_some_and(|auth| auth.is_authorized(&context))
        || context.path == "/.spaces"
        || context.path.starts_with("/.spaces/")
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if let Some(path) = context.path.strip_prefix(&instance.prefix) {
        if path == "/.spaces" || path.starts_with("/.spaces/") {
            return StatusCode::FORBIDDEN.into_response();
        }
    }
    forward_to_space(&instance, &instance.prefix, req).await
}

fn primary_host_matches(primary: &str, headers: &HeaderMap) -> bool {
    let Ok(url) = reqwest::Url::parse(primary) else {
        return false;
    };
    let host = crate::auth::request_host(headers);
    if host.contains(['/', '\\', '@', '?', '#']) {
        return false;
    }
    reqwest::Url::parse(&format!("{}://{host}", url.scheme()))
        .is_ok_and(|request| request.origin() == url.origin())
}

fn same_origin_request(primary: Option<&str>, headers: &HeaderMap) -> bool {
    if let Some(site) = headers.get("sec-fetch-site") {
        if !matches!(site.to_str().ok(), Some("same-origin" | "none")) {
            return false;
        }
    }
    let expected = primary.map(str::to_owned).unwrap_or_else(|| {
        let scheme = if crate::auth::is_secure_request(headers) {
            "https"
        } else {
            "http"
        };
        format!("{scheme}://{}", crate::auth::request_host(headers))
    });
    for name in [header::ORIGIN, header::REFERER] {
        if let Some(value) = headers.get(name) {
            if value
                .to_str()
                .ok()
                .and_then(|value| reqwest::Url::parse(value).ok())
                .is_none_or(|url| url.origin().ascii_serialization() != expected)
            {
                return false;
            }
        }
    }
    true
}

fn manager_ui_path(path: &str) -> bool {
    let rest = path.strip_prefix("/.spaces").unwrap_or("");
    if rest.is_empty() || rest == "/" || rest == "/index.html" {
        return true;
    }
    let parts: Vec<_> = rest.trim_start_matches('/').split('/').collect();
    if parts.iter().any(|part| {
        part.is_empty()
            || !part
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.')
            || *part == "."
            || *part == ".."
    }) {
        return false;
    }
    matches!(
        parts.as_slice(),
        ["new" | "users" | "login" | "profile" | "admin"] | ["users", _]
    ) || (parts.len() == 1 && uuid::Uuid::parse_str(parts[0]).is_ok())
        || (parts.len() == 2 && parts[1] == "git" && uuid::Uuid::parse_str(parts[0]).is_ok())
}

async fn manager_origin(
    State(manager): State<Arc<MultiManager>>,
    req: Request,
    next: Next,
) -> Response {
    let path = req.uri().path();
    if path != "/.spaces" && !path.starts_with("/.spaces/") {
        return next.run(req).await;
    }
    let primary = manager.primary_url();
    let api = path.starts_with("/.spaces/api/") || path == "/.spaces/api";
    let mut response = if primary.as_deref().is_some_and(|origin| {
        !primary_host_matches(origin, req.headers())
            || origin.starts_with("https://") != crate::auth::is_secure_request(req.headers())
    }) {
        if req.method() == Method::GET && manager_ui_path(path) {
            Redirect::temporary(&format!("{}{path}", primary.as_deref().unwrap())).into_response()
        } else {
            (StatusCode::FORBIDDEN, "Use the primary server origin").into_response()
        }
    } else if (api || req.method() != Method::GET && req.method() != Method::HEAD)
        && (!same_origin_request(primary.as_deref(), req.headers())
            || primary.is_some() && req.headers().contains_key(header::AUTHORIZATION))
    {
        (StatusCode::FORBIDDEN, "Cross-origin manager request denied").into_response()
    } else {
        next.run(req).await
    };
    let headers = response.headers_mut();
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        "frame-ancestors 'none'".parse().unwrap(),
    );
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::REFERRER_POLICY, "same-origin".parse().unwrap());
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.remove(header::ACCESS_CONTROL_ALLOW_ORIGIN);
    headers.remove(header::ACCESS_CONTROL_ALLOW_CREDENTIALS);
    response
}

async fn dispatch(State(state): State<MainState>, mut req: Request) -> Response {
    req.extensions_mut()
        .insert(crate::handlers::bundle::ServerName(
            state.manager.server_name(),
        ));
    let table = state.manager.registry().current();
    let host = crate::auth::request_host(req.headers());
    let path = req.uri().path().to_string();
    let Some((inst, prefix)) = table.resolve_main(&host, &path) else {
        if path == "/" {
            if state.spaces_mounted && !table.claims_host(&host) {
                return Redirect::temporary(crate::multi::space_index::SPACES_PREFIX)
                    .into_response();
            }
            return (StatusCode::NOT_FOUND, "No space here").into_response();
        }
        return (
            StatusCode::NOT_FOUND,
            [(axum::http::header::CONTENT_TYPE, "text/html")],
            "<html><body><h1>No space here</h1><p>Manage spaces in the <a href=\"/.spaces\">spaces UI</a>.</p></body></html>",
        )
            .into_response();
    };

    forward_to_space(&inst, &prefix, req).await
}

async fn forward_to_space(inst: &SpaceInstance, prefix: &str, req: Request) -> Response {
    let path = req.uri().path();
    if !prefix.is_empty() && path != prefix && !path.starts_with(&format!("{prefix}/")) {
        return StatusCode::NOT_FOUND.into_response();
    }
    // When the path exactly equals a non-empty prefix (no trailing slash),
    // redirect to `<prefix>/` so relative client URLs and the document base
    // resolve consistently. Preserve the query string across the redirect.
    if !prefix.is_empty() && path == prefix {
        let target = match req.uri().query() {
            Some(q) => format!("{prefix}/?{q}"),
            None => format!("{prefix}/"),
        };
        return Redirect::temporary(&target).into_response();
    }

    let Some(router) = inst.router.clone() else {
        let reason = match &inst.status {
            InstanceStatus::Errored(r) => r.clone(),
            _ => "space unavailable".to_string(),
        };
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            format!("Space unavailable: {reason}"),
        )
            .into_response();
    };

    let req = if prefix.is_empty() {
        req
    } else {
        strip_prefix(req, prefix)
    };
    match router.oneshot(req).await {
        Ok(resp) => resp,
        Err(never) => match never {},
    }
}

/// Rewrite the request URI with `prefix` removed from the path (query kept).
/// `/work` -> `/`, `/work/x?q=1` -> `/x?q=1`.
fn strip_prefix(mut req: Request, prefix: &str) -> Request<Body> {
    let uri = req.uri();
    let pq = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let rest = &pq[prefix.len()..];
    let new = if rest.is_empty() {
        "/".to_string()
    } else if rest.starts_with('?') {
        format!("/{rest}")
    } else {
        rest.to_string()
    };
    if let Ok(new_uri) = new.parse::<Uri>() {
        *req.uri_mut() = new_uri;
    }
    req
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceAccess, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use crate::multi::manager::MultiManager;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use silverbullet_server_common::space::MemorySpacePrimitives;
    use tower::ServiceExt;

    fn deps(root: &std::path::Path) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime_enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            runtime: Arc::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Single(None),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: false,
            index_template: "# Test space\n".into(),
            shutdown: None,
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            access: Some(SpaceAccess::None),
            legacy_public: None,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            git_sync: None,
            revisions_commit: None,
            extra: Default::default(),
        }
    }

    /// Manager with a /work space and a host-bound space, plus a dummy spaces
    /// router answering 299 (a sentinel status).
    fn setup(dir: &tempfile::TempDir) -> axum::Router {
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        m.create(
            payload(
                "Work",
                Binding::Prefix {
                    prefix: "/work".into(),
                },
            ),
            true,
        )
        .unwrap();
        m.create(
            payload(
                "Hosted",
                Binding::Host {
                    host: "notes.example.com".into(),
                    prefix: String::new(),
                },
            ),
            true,
        )
        .unwrap();
        let spaces = axum::Router::new()
            .fallback(|| async { (StatusCode::from_u16(299).unwrap(), "spaces") });
        build_main_router(m, Some(spaces), "test".to_string())
    }

    async fn get(router: &axum::Router, host: &str, uri: &str) -> axum::response::Response {
        router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header("host", host)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn custom_host_prefixes_route_and_publish_only_their_scope() {
        let dir = tempfile::tempdir().unwrap();
        let m =
            MultiManager::boot(dir.path().into(), deps(dir.path()), Default::default()).unwrap();
        m.create(
            payload(
                "Default",
                Binding::Prefix {
                    prefix: "/default".into(),
                },
            ),
            true,
        )
        .unwrap();
        let work = m
            .create(
                payload(
                    "Work",
                    Binding::Host {
                        host: "Notes.Example.test.".into(),
                        prefix: "/work".into(),
                    },
                ),
                true,
            )
            .unwrap();
        let r = build_main_router(
            m.clone(),
            Some(Router::new().fallback(|| async { StatusCode::IM_A_TEAPOT })),
            "test".into(),
        );
        let original = m.instance(&work).unwrap();
        m.create(
            payload(
                "Wiki",
                Binding::Host {
                    host: "notes.example.test".into(),
                    prefix: "/wiki".into(),
                },
            ),
            true,
        )
        .unwrap();
        assert!(Arc::ptr_eq(&original, &m.instance(&work).unwrap()));
        for (host, path, expected) in [
            (
                "NOTES.example.test.",
                "/work/.config",
                serde_json::json!(["/wiki", "/work"]),
            ),
            (
                "notes.example.test",
                "/wiki/.config",
                serde_json::json!(["/wiki", "/work"]),
            ),
            (
                "localhost",
                "/default/.config",
                serde_json::json!(["/default"]),
            ),
        ] {
            let response = get(&r, host, path).await;
            assert_eq!(response.status(), StatusCode::OK, "{host}{path}");
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let config: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(config["spacePrefixes"], expected);
        }
        for (host, path) in [
            ("notes.example.test", "/missing"),
            ("notes.example.test", "/default/.config"),
            ("localhost", "/work/.config"),
        ] {
            assert_eq!(get(&r, host, path).await.status(), StatusCode::NOT_FOUND);
        }
        assert_eq!(
            get(&r, "notes.example.test", "/.instance").await.status(),
            StatusCode::OK
        );
        assert_eq!(
            get(&r, "notes.example.test", "/.spaces/api/test")
                .await
                .status(),
            StatusCode::IM_A_TEAPOT
        );
        let response = get(&r, "notes.example.test", "/work?a=1&b=2").await;
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(response.headers()["location"], "/work/?a=1&b=2");
    }

    #[tokio::test]
    async fn custom_host_prefix_reaches_shell_manifest_and_login() {
        use silverbullet_server_common::SpacePrimitives;
        let dir = tempfile::tempdir().unwrap();
        let mut dependencies = deps(dir.path());
        dependencies.assets.client_bundle = Box::new(|| {
            let bundle = MemorySpacePrimitives::new();
            bundle
                .write_file(
                    ".client/index.html",
                    br#"<base href="{{ host_prefix | safe }}/">"#,
                    None,
                )
                .unwrap();
            Box::new(bundle)
        });
        dependencies.auth = InstanceAuth::Single(Some(
            crate::auth::AuthConfig::try_parse(
                Some("keeper:fixture-password"),
                Some("fixture-token"),
                None,
                None,
                None,
            )
            .unwrap()
            .unwrap(),
        ));
        let m = MultiManager::boot(dir.path().into(), dependencies, Default::default()).unwrap();
        m.create(
            payload(
                "Work",
                Binding::Host {
                    host: "notes.example.test".into(),
                    prefix: "/work".into(),
                },
            ),
            true,
        )
        .unwrap();
        let r = build_main_router(m, None, "test".into());
        let response = get(&r, "notes.example.test", "/work/Welcome?filter=a%2Bb").await;
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            response.headers()["location"],
            "/work/.auth?from=/work/Welcome%3Ffilter%3Da%252Bb"
        );
        let response = r
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/work/")
                    .header("host", "notes.example.test")
                    .header("authorization", "Bearer fixture-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains(r#"<base href="/work/">"#));
        let response = get(&r, "notes.example.test", "/work/.client/manifest.json").await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(manifest["scope"], "/work/");
        assert_eq!(manifest["start_url"], "/work/#boot");
        assert_eq!(manifest["icons"][0]["src"], "/work/.client/logo-dock.png");
    }

    #[tokio::test]
    async fn primary_origin_serves_prefix_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let manager =
            MultiManager::boot(dir.path().into(), deps(dir.path()), Default::default()).unwrap();
        manager
            .create(
                payload(
                    "Notes",
                    Binding::Prefix {
                        prefix: "/notes".into(),
                    },
                ),
                false,
            )
            .unwrap();
        manager
            .set_primary_url("https://manager.example.test")
            .unwrap();
        let router = build_main_router(
            manager,
            Some(Router::new().fallback(|| async { "manager" })),
            "test".into(),
        );
        assert_eq!(
            get(&router, "manager.example.test", "/notes/.config")
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            get(&router, "manager.example.test", "/.spaces")
                .await
                .status(),
            StatusCode::TEMPORARY_REDIRECT
        );
        assert_eq!(
            get(&router, "notes.example.test", "/.spaces/api/session")
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn primary_origin_isolates_manager_and_rejects_sibling_requests() {
        let dir = tempfile::tempdir().unwrap();
        let m =
            MultiManager::boot(dir.path().into(), deps(dir.path()), Default::default()).unwrap();
        m.set_primary_url("https://manager.example.test").unwrap();
        m.create(
            payload(
                "Notes",
                Binding::Host {
                    host: "notes.example.test".into(),
                    prefix: String::new(),
                },
            ),
            false,
        )
        .unwrap();
        let spaces = Router::new().fallback(|| async { "manager secret" });
        let r = build_main_router(m, Some(spaces), "test".into());
        assert_eq!(
            get(&r, "notes.example.test", "/.spaces/api/session")
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        let response = get(
            &r,
            "notes.example.test",
            "/.spaces/users?redirect=//evil.test",
        )
        .await;
        assert_eq!(
            response.headers()["location"],
            "https://manager.example.test/.spaces/users"
        );
        assert_eq!(
            get(&r, "manager.example.test", "/.config").await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(&r, "unknown.example.test", "/.spaces/api/session")
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        for (method, site, origin) in [
            ("GET", "same-site", "https://notes.example.test"),
            ("POST", "cross-site", "https://other.test"),
        ] {
            let response = r
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri("/.spaces/api/session")
                        .header("host", "manager.example.test")
                        .header("x-forwarded-proto", "https")
                        .header("sec-fetch-site", site)
                        .header("origin", origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            assert_eq!(response.headers()["x-frame-options"], "DENY");
            assert!(!response
                .headers()
                .contains_key("access-control-allow-origin"));
        }
        let response = r
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/.spaces/api/session")
                    .header("host", "manager.example.test")
                    .header("x-forwarded-proto", "https")
                    .header("sec-fetch-site", "same-origin")
                    .header("origin", "https://manager.example.test")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn prefix_space_gets_stripped_path() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        assert_eq!(
            get(&r, "localhost", "/work/.config").await.status(),
            StatusCode::OK
        );
        assert_eq!(
            get(&r, "localhost", "/work/.config?x=1").await.status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn bare_prefix_url_redirects_to_trailing_slash() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        let resp = get(&r, "localhost", "/work").await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(resp.headers()[axum::http::header::LOCATION], "/work/");
        let resp = get(&r, "localhost", "/work?a=1&b=2").await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            resp.headers()[axum::http::header::LOCATION],
            "/work/?a=1&b=2"
        );
        assert_eq!(
            get(&r, "localhost", "/work/.config").await.status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn config_carries_live_space_prefixes() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["root", "work"] {
            std::fs::create_dir_all(dir.path().join("spaces").join(id)).unwrap();
        }
        std::fs::write(
            dir.path().join("spaces.json"),
            serde_json::json!({
                "root": payload("Root", Binding::Prefix { prefix: "/".into() }),
                "work": payload("Work", Binding::Prefix { prefix: "/work".into() }),
            })
            .to_string(),
        )
        .unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        m.create(
            payload(
                "Hosted",
                Binding::Host {
                    host: "notes.example.com".into(),
                    prefix: String::new(),
                },
            ),
            true,
        )
        .unwrap();
        let r = build_main_router(m.clone(), None, "test".to_string());

        let config_prefixes = |resp_body: &[u8]| -> Vec<String> {
            let v: serde_json::Value = serde_json::from_slice(resp_body).unwrap();
            v["spacePrefixes"]
                .as_array()
                .unwrap_or_else(|| panic!("no spacePrefixes in {v}"))
                .iter()
                .map(|p| p.as_str().unwrap().to_string())
                .collect()
        };

        let resp = get(&r, "localhost", "/.config").await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        // Non-empty prefix bindings only: the root space's own "" prefix is
        // never shadowable, and host bindings live on other origins.
        assert_eq!(config_prefixes(&body), vec!["/work".to_string()]);

        m.delete("root").unwrap();
        m.create(
            payload(
                "Private",
                Binding::Prefix {
                    prefix: "/private".into(),
                },
            ),
            true,
        )
        .unwrap();
        let resp = get(&r, "localhost", "/work/.config").await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            config_prefixes(&body),
            vec!["/private".to_string(), "/work".to_string()]
        );
    }

    #[tokio::test]
    async fn host_space_resolution_and_no_root_binding() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        assert_eq!(
            get(&r, "notes.example.com", "/.config").await.status(),
            StatusCode::OK
        );
        // This fixture has no root-bound space to handle unmatched requests.
        assert_eq!(
            get(&r, "localhost", "/.config").await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn root_prefix_binding_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        assert!(m
            .create(
                payload("Root", Binding::Prefix { prefix: "/".into() }),
                true
            )
            .is_ok());
    }

    #[tokio::test]
    async fn spaces_prefix_always_reserved() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        assert_eq!(
            get(&r, "localhost", "/.spaces/anything")
                .await
                .status()
                .as_u16(),
            299
        );
    }

    #[tokio::test]
    async fn bare_spaces_prefix_resolves_into_the_nested_router() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        let spaces = axum::Router::new()
            .route("/", axum::routing::get(|| async { "SPACES-ROOT" }))
            .fallback(|| async { "spaces-fallback" });
        let r = build_main_router(m, Some(spaces), "test".to_string());

        let resp = get(&r, "localhost", "/.spaces").await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            &body[..],
            b"SPACES-ROOT",
            "bare /.spaces must reach the nested router's root handler"
        );
    }

    #[tokio::test]
    async fn instance_endpoint_answers_on_any_host_with_cors() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);

        async fn instance_of(r: &axum::Router, host: &str) -> (String, axum::http::HeaderMap) {
            let resp = get(r, host, "/.instance").await;
            assert_eq!(resp.status(), StatusCode::OK);
            let headers = resp.headers().clone();
            let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap();
            let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            (v["instance"].as_str().unwrap().to_string(), headers)
        }

        // Answers on the admin origin's host and on a space-bound host alike —
        // host resolution must not shadow it (that's the whole point: probing
        // a hostname BEFORE it is bound, and THROUGH one that is).
        let (id1, headers) = instance_of(&r, "localhost").await;
        let (id2, _) = instance_of(&r, "notes.example.com").await;
        let (id3, _) = instance_of(&r, "unbound.example.org").await;
        assert_eq!(id1, id2);
        assert_eq!(id1, id3);
        assert!(!id1.is_empty());
        assert_eq!(
            headers[axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "*"
        );

        let dir2 = tempfile::tempdir().unwrap();
        let r2 = setup(&dir2);
        let (other, _) = instance_of(&r2, "localhost").await;
        assert_ne!(id1, other);
    }

    #[tokio::test]
    async fn instance_endpoint_reports_the_server_version() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        let r = build_main_router(m, None, "1.2.3-test".to_string());
        let resp = get(&r, "localhost", "/.instance").await;
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["version"], "1.2.3-test");
        // The per-boot id must survive alongside it: the space form compares
        // this value across origins to verify a hostname binding reaches this
        // very server.
        assert!(
            json["instance"].as_str().is_some_and(|s| !s.is_empty()),
            "instance id missing: {json}"
        );
    }

    #[tokio::test]
    async fn root_redirects_to_spaces_when_unbound_and_unknown_paths_404() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        m.create(
            payload(
                "Work",
                Binding::Prefix {
                    prefix: "/work".into(),
                },
            ),
            true,
        )
        .unwrap();
        let spaces = axum::Router::new().fallback(|| async { "spaces" });
        let r = build_main_router(m, Some(spaces), "test".to_string());
        let resp = get(&r, "localhost", "/").await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(resp.headers()["location"], "/.spaces");
        let resp = get(&r, "localhost", "/nothing/here").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn claimed_prefixed_hostname_root_does_not_redirect_to_manager() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            Default::default(),
        )
        .unwrap();
        m.create(
            payload(
                "Work",
                Binding::Host {
                    host: "team.example.test".into(),
                    prefix: "/work".into(),
                },
            ),
            true,
        )
        .unwrap();
        let r = build_main_router(
            m,
            Some(Router::new().fallback(|| async { "spaces" })),
            "test".into(),
        );
        let resp = get(&r, "team.example.test", "/").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert!(resp.headers().get("location").is_none());
    }

    /// With no spaces surface mounted at all, `/` has nowhere to send the
    /// browser — it must 404 rather than redirect into a route that isn't
    /// there.
    #[tokio::test]
    async fn root_404s_when_no_spaces_router_is_mounted() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        let r = build_main_router(m, None, "test".to_string());
        let resp = get(&r, "localhost", "/").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    /// A space bound at `/` wins over the redirect: the redirect is only the
    /// fallback for an unresolved root.
    #[tokio::test]
    async fn root_serves_the_space_when_one_is_bound() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(
            dir.path().to_path_buf(),
            deps(dir.path()),
            std::collections::BTreeSet::new(),
        )
        .unwrap();
        m.create(
            payload("Root", Binding::Prefix { prefix: "/".into() }),
            true,
        )
        .unwrap();
        let spaces = axum::Router::new().fallback(|| async { "spaces" });
        let r = build_main_router(m, Some(spaces), "test".to_string());
        let resp = get(&r, "localhost", "/").await;
        assert_ne!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
    }
}
