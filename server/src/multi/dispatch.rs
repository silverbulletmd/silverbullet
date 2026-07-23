//! The main listener's request dispatcher: `/.spaces` is reserved, then Host
//! header, then longest prefix. Matched requests are forwarded to the space's
//! own (unchanged) Core router with the prefix stripped.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Redirect, Response};
use axum::Router;
use tower::ServiceExt;

use crate::multi::instance::InstanceStatus;
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
    // Per-boot instance identity AND liveness, served on ANY hostname (it's
    // routed before host/prefix resolution) with permissive CORS. Two
    // consumers: the spaces UI probes
    // `http(s)://<candidate-hostname>:<port>/.instance` from the browser and
    // compares the id against its own origin's to verify that a hostname
    // binding actually reaches this very server (discloses nothing but a
    // random UUID), and the Docker HEALTHCHECK uses a 200 here as liveness.
    // It lives on the main router, before host/prefix resolution, so it is the
    // one endpoint that exists regardless of which spaces are bound — which is
    // exactly why the health check uses it instead of the per-space `/.ping`.
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
    router.fallback(dispatch).with_state(MainState {
        manager,
        spaces_mounted,
    })
}

async fn dispatch(State(state): State<MainState>, req: Request) -> Response {
    let table = state.manager.registry().current();
    let host = crate::auth::request_host(req.headers());
    let path = req.uri().path().to_string();

    let Some((inst, prefix)) = table.resolve_main(&host, &path) else {
        if path == "/" {
            if state.spaces_mounted {
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
        strip_prefix(req, &prefix)
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
    use crate::multi::config::{Binding, SpaceConfig};
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
            runtime: Box::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Single(None),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            index_template: "# Test space\n".into(),
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            public: false,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
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
    async fn prefix_space_gets_stripped_path() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        // /work/.config -> the work space's /.config (200, open auth).
        assert_eq!(
            get(&r, "localhost", "/work/.config").await.status(),
            StatusCode::OK
        );
        // Query strings survive the strip.
        assert_eq!(
            get(&r, "localhost", "/work/.config?x=1").await.status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn bare_prefix_url_redirects_to_trailing_slash() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        // Exact prefix, no trailing slash -> 307 to `<prefix>/`.
        let resp = get(&r, "localhost", "/work").await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(resp.headers()[axum::http::header::LOCATION], "/work/");
        // Query string is preserved.
        let resp = get(&r, "localhost", "/work?a=1&b=2").await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            resp.headers()[axum::http::header::LOCATION],
            "/work/?a=1&b=2"
        );
        // A deeper path under the prefix is forwarded, not redirected.
        assert_eq!(
            get(&r, "localhost", "/work/.config").await.status(),
            StatusCode::OK
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
        // `setup()` doesn't bind a root ("/") space, so unprefixed paths on an
        // unmatched host never reach a space (root prefixes are valid now,
        // see `root_prefix_binding_is_accepted`, but simply aren't bound
        // here).
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
        // /.spaces always routes to the spaces router, never to a space.
        assert_eq!(
            get(&r, "localhost", "/.spaces/anything")
                .await
                .status()
                .as_u16(),
            299
        );
    }

    /// `dispatch` redirects `/` to the bare `SPACES_PREFIX` (no trailing
    /// slash — see `root_redirects_to_spaces_when_unbound_and_unknown_paths_404`),
    /// and nothing else in this repo pins that the bare prefix actually
    /// resolves *into* the nested spaces router rather than falling through
    /// to `dispatch`'s own catch-all. It works today because axum's
    /// `nest_service` registers both `prefix` and `prefix/{*rest}` — but
    /// that's an axum implementation detail, not something this crate
    /// controls, so pin it with a real request. The nested router below
    /// answers its root and its fallback with different bodies so a match on
    /// `/.spaces` provably reached the nested router's `/` handler, not just
    /// any 200 (and not `dispatch`'s own 404, which would read "No space
    /// here" instead).
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

        // A different router (fresh boot) gets a different id.
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
        // Manager with NO root space.
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
