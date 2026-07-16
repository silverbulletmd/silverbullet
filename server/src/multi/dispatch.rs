//! The main listener's request dispatcher: `/.admin` is reserved, then Host
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

pub fn build_main_router(manager: Arc<MultiManager>, admin_router: Router) -> Router {
    // Per-boot instance identity, served on ANY hostname (it's routed before
    // host/prefix resolution) with permissive CORS. The admin UI probes
    // `http(s)://<candidate-hostname>:<port>/.instance` from the browser and
    // compares the id against its own origin's to verify that a hostname
    // binding actually reaches this very server. Discloses nothing but a
    // random UUID.
    let instance_id = uuid::Uuid::new_v4().to_string();
    let instance_handler = move || {
        let body = format!("{{\"instance\":\"{instance_id}\"}}");
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
    Router::new()
        .nest_service("/.admin", admin_router)
        .route("/.instance", axum::routing::get(instance_handler))
        .fallback(dispatch)
        .with_state(manager)
}

async fn dispatch(State(manager): State<Arc<MultiManager>>, req: Request) -> Response {
    let table = manager.registry().current();
    let host = crate::auth::request_host(req.headers());
    let path = req.uri().path().to_string();

    let Some((inst, prefix)) = table.resolve_main(&host, &path) else {
        if path == "/" {
            return Redirect::temporary("/.admin/").into_response();
        }
        return (
            StatusCode::NOT_FOUND,
            [(axum::http::header::CONTENT_TYPE, "text/html")],
            "<html><body><h1>No space here</h1><p>Manage spaces in the <a href=\"/.admin/\">admin UI</a>.</p></body></html>",
        )
            .into_response();
    };

    // When the path exactly equals a non-empty prefix (no trailing slash),
    // redirect to `<prefix>/`. The session cookie's Path is `<prefix>/`, so the
    // bare URL wouldn't carry the cookie and a logged-in user would see a login
    // page. Preserve the query string across the redirect.
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
    use crate::multi::config::{Binding, SpaceAuth, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceDeps};
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
            admin_auth: crate::auth::AuthConfig::try_parse(
                Some("admin:pw"),
                None,
                None,
                None,
                None,
            )
            .unwrap()
            .unwrap(),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            auth: SpaceAuth::None,
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

    /// Manager with a /work space, a root space, and a host-bound space, plus a
    /// dummy admin router answering 299 (a sentinel status).
    fn setup(dir: &tempfile::TempDir) -> axum::Router {
        let m = MultiManager::boot(dir.path().to_path_buf(), deps(dir.path())).unwrap();
        m.create(payload(
            "Work",
            Binding::Prefix {
                prefix: "/work".into(),
            },
        ))
        .unwrap();
        m.create(payload(
            "Hosted",
            Binding::Host {
                host: "notes.example.com".into(),
            },
        ))
        .unwrap();
        let admin = axum::Router::new()
            .fallback(|| async { (StatusCode::from_u16(299).unwrap(), "admin") });
        build_main_router(m, admin)
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
        // Root prefixes are rejected by validation, so unprefixed paths on an
        // unmatched host never reach a space.
        assert_eq!(
            get(&r, "localhost", "/.config").await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn root_prefix_binding_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(dir.path().to_path_buf(), deps(dir.path())).unwrap();
        assert!(m
            .create(payload("Root", Binding::Prefix { prefix: "/".into() }))
            .is_err());
    }

    #[tokio::test]
    async fn admin_prefix_always_reserved() {
        let dir = tempfile::tempdir().unwrap();
        let r = setup(&dir);
        // /.admin always routes to the admin router, never to a space.
        assert_eq!(
            get(&r, "localhost", "/.admin/anything")
                .await
                .status()
                .as_u16(),
            299
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
    async fn no_match_404_and_root_redirects_to_admin_when_unbound() {
        let dir = tempfile::tempdir().unwrap();
        // Manager with NO root space.
        let m = MultiManager::boot(dir.path().to_path_buf(), deps(dir.path())).unwrap();
        m.create(payload(
            "Work",
            Binding::Prefix {
                prefix: "/work".into(),
            },
        ))
        .unwrap();
        let admin = axum::Router::new().fallback(|| async { "admin" });
        let r = build_main_router(m, admin);
        let resp = get(&r, "localhost", "/").await;
        assert_eq!(resp.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(resp.headers()[axum::http::header::LOCATION], "/.admin/");
        let resp = get(&r, "localhost", "/nothing/here").await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn errored_space_returns_503_with_reason() {
        let dir = tempfile::tempdir().unwrap();
        let m = MultiManager::boot(dir.path().to_path_buf(), deps(dir.path())).unwrap();
        let mut p = payload(
            "Broken",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        p.auth = SpaceAuth::Custom {
            user: "u".into(),
            pass_hash: String::new(),
            auth_token: String::new(),
            lockout_limit: 10,
            lockout_time: 60,
            remember_me_hours: 168,
        };
        m.create(p).unwrap();
        let admin = axum::Router::new().fallback(|| async { "admin" });
        let r = build_main_router(m, admin);
        let resp = get(&r, "localhost", "/b/.config").await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
