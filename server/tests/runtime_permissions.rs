use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use silverbullet_server::{
    auth::{headless_cookie_name, Authenticator},
    multi::{
        config::{MemberRole, SpaceConfig},
        instance::{AssetFactories, InstanceAuth, InstanceDeps},
        manager::MultiManager,
        users::{Profile, UserStore},
    },
    runtime::{LogBuffer, LogEntry, RuntimeBackend, RuntimeError},
};
use silverbullet_server_common::space::memory::MemorySpacePrimitives;
use tower::ServiceExt;

struct Child {
    id: usize,
    space_id: String,
    server_url: String,
    cookie: String,
    stopped: AtomicBool,
    evaluations: AtomicUsize,
    logs: LogBuffer,
}

struct Backend(Arc<Child>);

impl RuntimeBackend for Backend {
    fn eval_global(&self, _: &str, arg: &str, _: Duration) -> Result<Value, RuntimeError> {
        assert!(!self.0.stopped.load(Ordering::SeqCst));
        self.0.evaluations.fetch_add(1, Ordering::SeqCst);
        self.0.logs.push(LogEntry {
            level: "log".into(),
            text: arg.into(),
            timestamp: 1,
        });
        Ok(json!(self.0.id))
    }

    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        assert!(!self.0.stopped.load(Ordering::SeqCst));
        self.0.logs.query(limit, since)
    }

    fn ready(&self) -> bool {
        !self.0.stopped.load(Ordering::SeqCst)
    }

    fn snapshot(&self) -> Option<silverbullet_server::runtime::RuntimeSnapshot> {
        Some(silverbullet_server::runtime::RuntimeSnapshot {
            status: if self.0.stopped.load(Ordering::SeqCst) {
                "stopped"
            } else {
                "running"
            }
            .into(),
            cpu_percent: Some(12.5),
            memory_bytes: Some(4096),
            disk_bytes: Some(8192),
        })
    }
    fn stop(&self, _: bool) -> Result<(), RuntimeError> {
        self.shutdown();
        Ok(())
    }
    fn restart(&self, _: &str) -> Result<Option<Arc<dyn RuntimeBackend>>, RuntimeError> {
        Ok(None)
    }

    fn shutdown(&self) {
        self.0.stopped.store(true, Ordering::SeqCst);
    }
}

struct Fixture {
    manager: Arc<MultiManager>,
    users: Arc<UserStore>,
    tokens: BTreeMap<String, String>,
    children: Arc<Mutex<Vec<Arc<Child>>>>,
    _dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        let mut tokens = BTreeMap::new();
        for name in ["keeper", "writer-one", "writer-two", "reader", "opted-out"] {
            users
                .create_user(
                    name,
                    "fixture-password",
                    name == "keeper",
                    Profile::default(),
                )
                .unwrap();
            tokens.insert(
                name.into(),
                users.create_token(name, "fixture-token").unwrap(),
            );
        }
        let children = Arc::new(Mutex::new(Vec::new()));
        let captured = children.clone();
        let deps = InstanceDeps {
            root: dir.path().into(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Arc::new(move |request| {
                let mut children = captured.lock().unwrap();
                let child = Arc::new(Child {
                    id: children.len(),
                    space_id: request.space_id.into(),
                    server_url: request.server_url.clone(),
                    cookie: format!(
                        "{}={}",
                        headless_cookie_name(request.space_id),
                        request.headless_token
                    ),
                    stopped: AtomicBool::new(false),
                    evaluations: AtomicUsize::new(0),
                    logs: LogBuffer::new(),
                });
                children.push(child.clone());
                Some(Box::new(Backend(child)))
            }),
            runtime_enabled: Arc::new(AtomicBool::new(true)),
            metrics: None,
            auth: InstanceAuth::Accounts {
                users: users.clone(),
                authenticator: Arc::new(Authenticator::from_secret_bytes(
                    vec![19; 32],
                    "fixture".into(),
                )),
                session: Default::default(),
            },
            version: "fixture".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: true,
            index_template: "# Fixture\n".into(),
            shutdown: None,
        };
        let manager = MultiManager::boot(
            dir.path().into(),
            deps,
            users.usernames().into_iter().collect(),
        )
        .unwrap();
        Self {
            manager,
            users,
            tokens,
            children,
            _dir: dir,
        }
    }

    fn space(&self, prefix: &str, public: bool) -> String {
        let config: SpaceConfig = serde_json::from_value(json!({
            "name": "Fixture space", "binding": {"prefix": prefix},
            "access": if public { "write" } else { "none" },
            "revisions": "disabled",
            "members": {
                "writer-one": {"role": "write"},
                "writer-two": {"role": "write", "runtimeApi": true},
                "reader": {"role": "read"},
                "opted-out": {"role": "write", "runtimeApi": false}
            }
        }))
        .unwrap();
        self.manager.create(config, false).unwrap()
    }

    fn router(&self, id: &str) -> Router {
        self.manager.instance(id).unwrap().router.clone().unwrap()
    }
    fn bearer(&self, name: &str) -> (&'static str, String) {
        ("authorization", format!("Bearer {}", self.tokens[name]))
    }
    fn child(&self, id: usize) -> Arc<Child> {
        self.children.lock().unwrap()[id].clone()
    }
    fn count(&self) -> usize {
        self.children.lock().unwrap().len()
    }
    async fn evaluate(&self, router: &Router, name: &str, code: &str) -> usize {
        let (status, body) = request(
            router,
            "POST",
            "/.runtime/lua",
            Some(self.bearer(name)),
            code,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body["result"].as_u64().unwrap() as usize
    }
}

async fn request(
    router: &Router,
    method: &str,
    path: &str,
    credential: Option<(&str, String)>,
    body: &str,
) -> (StatusCode, Value) {
    request_at(router, "localhost:3000", method, path, credential, body).await
}

async fn request_at(
    router: &Router,
    host: &str,
    method: &str,
    path: &str,
    credential: Option<(&str, String)>,
    body: &str,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", host);
    if let Some((header, value)) = credential {
        builder = builder.header(header, value);
    }
    let response = router
        .clone()
        .oneshot(builder.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes))),
    )
}

fn cookie(child: &Child) -> Option<(&'static str, String)> {
    Some(("cookie", child.cookie.clone()))
}

async fn assert_cookie_revoked(router: &Router, child: &Child) {
    for (method, path, body) in [
        ("GET", "/.accounts", ""),
        ("PUT", "/.fs/Revoked.md", "must never be written"),
        ("POST", "/.runtime/lua", "must never execute"),
        ("GET", "/.runtime/logs", ""),
    ] {
        let (status, response) = request(router, method, path, cookie(child), body).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {path}: {response}"
        );
    }
}

#[tokio::test]
async fn runtimes_and_logs_are_isolated_by_verified_user_and_space() {
    let f = Fixture::new();
    let space_one = f.space("/one", false);
    let space_two = f.space("/two", false);
    assert_eq!(f.count(), 0);
    let one = f.router(&space_one);
    let two = f.router(&space_two);
    let a = f.evaluate(&one, "writer-one", "one-only").await;
    let b = f.evaluate(&one, "writer-two", "two-only").await;
    let c = f.evaluate(&two, "writer-one", "other-space-only").await;
    assert_ne!(a, b);
    assert_ne!(a, c);
    assert_ne!(b, c);
    assert_eq!(f.evaluate(&one, "writer-one", "one-again").await, a);
    assert_eq!(f.count(), 3);
    for (router, name, id, expected) in [
        (&one, "writer-one", a, vec!["one-only", "one-again"]),
        (&one, "writer-two", b, vec!["two-only"]),
        (&two, "writer-one", c, vec!["other-space-only"]),
    ] {
        let (status, logs) =
            request(router, "GET", "/.runtime/logs", Some(f.bearer(name)), "").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            logs["logs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|log| log["text"].as_str().unwrap())
                .collect::<Vec<_>>(),
            expected
        );
        let child = f.child(id);
        let (status, accounts) = request(router, "GET", "/.accounts", cookie(&child), "").await;
        assert_eq!(status, StatusCode::OK);
        let me = accounts
            .as_array()
            .unwrap()
            .iter()
            .find(|account| account["me"] == true)
            .unwrap();
        assert_eq!(me["username"], name);
        assert_eq!(
            request(router, "PUT", "/.fs/Allowed.md", cookie(&child), "allowed")
                .await
                .0,
            StatusCode::OK
        );
    }
    assert_eq!(f.child(a).space_id, space_one);
    assert_eq!(f.child(c).space_id, space_two);
    assert!(f.child(a).server_url.ends_with("/one"));
    assert!(f.child(c).server_url.ends_with("/two"));
    assert_ne!(f.child(a).cookie, f.child(b).cookie);
    let wrong_space_cookie = format!(
        "{}={}",
        headless_cookie_name(&space_two),
        f.child(a).cookie.split_once('=').unwrap().1
    );
    assert_eq!(
        request(
            &two,
            "GET",
            "/.accounts",
            Some(("cookie", wrong_space_cookie)),
            ""
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn concurrent_first_requests_reuse_one_runtime() {
    let f = Fixture::new();
    let id = f.space("/one", false);
    let router = f.router(&id);
    let (one, two, three) = tokio::join!(
        f.evaluate(&router, "writer-one", "first"),
        f.evaluate(&router, "writer-one", "second"),
        f.evaluate(&router, "writer-one", "third")
    );
    assert_eq!(one, two);
    assert_eq!(one, three);
    assert_eq!(f.count(), 1);
}

#[tokio::test]
async fn role_only_patches_preserve_runtime_opt_out_and_write_revocation() {
    let f = Fixture::new();
    let id = f.space("/one", false);
    for (name, roles) in [
        ("opted-out", vec!["write"]),
        ("writer-one", vec!["read", "write"]),
    ] {
        for role in roles {
            let mut members =
                serde_json::to_value(&f.manager.instance(&id).unwrap().config.members).unwrap();
            members[name] = json!({"role": role});
            f.manager
                .patch(
                    &id,
                    json!({"members": members}).as_object().unwrap().clone(),
                )
                .unwrap();
            assert!(
                !f.manager.instance(&id).unwrap().config.members[name].runtime_api,
                "{name}: {role}"
            );
            let router = f.router(&id);
            for (method, path) in [("POST", "/.runtime/lua"), ("GET", "/.runtime/logs")] {
                assert_eq!(
                    request(
                        &router,
                        method,
                        path,
                        Some(f.bearer(name)),
                        "must stay disabled"
                    )
                    .await
                    .0,
                    StatusCode::FORBIDDEN,
                    "{name}: {role}"
                );
            }
        }
    }
    assert_eq!(f.count(), 0);
}

#[tokio::test]
async fn reader_and_opted_out_writer_cannot_evaluate_or_read_logs() {
    let f = Fixture::new();
    let id = f.space("/one", false);
    let router = f.router(&id);
    for name in ["reader", "opted-out"] {
        for (method, path) in [
            ("POST", "/.runtime/lua"),
            ("POST", "/.runtime/lua_script"),
            ("GET", "/.runtime/logs"),
        ] {
            let (status, body) =
                request(&router, method, path, Some(f.bearer(name)), "1 + 1").await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{name} {path}: {body}");
        }
    }
    assert_eq!(f.count(), 0);
    f.evaluate(&router, "writer-one", "legacy member defaults enabled")
        .await;
    assert_eq!(f.count(), 1);
}

#[tokio::test]
async fn permission_and_space_revocation_reject_credentials_on_current_and_retained_routers() {
    let f = Fixture::new();
    for change in [
        "runtime-permission",
        "write-permission",
        "membership",
        "frozen",
    ] {
        let id = f.space(&format!("/{change}"), change != "membership");
        let old_router = f.router(&id);
        let child = f.child(
            f.evaluate(&old_router, "writer-one", "before revocation")
                .await,
        );
        let mut config = f.manager.instance(&id).unwrap().config.clone();
        match change {
            "runtime-permission" => {
                config.members.get_mut("writer-one").unwrap().runtime_api = false
            }
            "write-permission" => {
                config.members.get_mut("writer-one").unwrap().role = MemberRole::Read
            }
            "membership" => {
                config.members.remove("writer-one");
            }
            "frozen" => config.read_only = true,
            _ => unreachable!(),
        }
        f.manager.update(&id, config).unwrap();
        assert!(child.stopped.load(Ordering::SeqCst), "{change}");
        assert_cookie_revoked(&old_router, &child).await;
        let current = f.router(&id);
        assert_cookie_revoked(&current, &child).await;
        for router in [&old_router, &current] {
            let (status, body) = request(
                router,
                "POST",
                "/.runtime/lua",
                Some(f.bearer("writer-one")),
                "after revocation",
            )
            .await;
            assert!(
                [StatusCode::FORBIDDEN, StatusCode::SERVICE_UNAVAILABLE].contains(&status),
                "{change}: {status} {body}"
            );
        }
        assert_eq!(child.evaluations.load(Ordering::SeqCst), 1);
        if change == "runtime-permission" {
            assert_eq!(
                request(
                    &current,
                    "PUT",
                    "/.fs/Public.md",
                    None,
                    "public remains writable"
                )
                .await
                .0,
                StatusCode::OK
            );
        }
    }
}

#[tokio::test]
async fn revoking_one_user_stops_only_that_users_runtimes_across_spaces() {
    let f = Fixture::new();
    let one = f.space("/one", false);
    let two = f.space("/two", false);
    let first = f.router(&one);
    let second = f.router(&two);
    let a = f.child(f.evaluate(&first, "writer-one", "one").await);
    let b = f.child(f.evaluate(&second, "writer-one", "two").await);
    let unaffected = f.child(f.evaluate(&first, "writer-two", "unaffected").await);
    f.manager.revoke_user_runtime("writer-one");
    assert!(a.stopped.load(Ordering::SeqCst));
    assert!(b.stopped.load(Ordering::SeqCst));
    assert!(!unaffected.stopped.load(Ordering::SeqCst));
    assert_cookie_revoked(&first, &a).await;
    assert_cookie_revoked(&second, &b).await;
    assert_eq!(
        f.evaluate(&first, "writer-two", "still available").await,
        unaffected.id
    );
    assert_ne!(f.evaluate(&first, "writer-one", "fresh lease").await, a.id);
    assert_cookie_revoked(&first, &a).await;
}

#[tokio::test]
async fn server_disable_revokes_all_spaces_and_reenable_creates_fresh_credentials() {
    let f = Fixture::new();
    let one = f.space("/one", true);
    let two = f.space("/two", true);
    let routers = [f.router(&one), f.router(&two)];
    let a = f.child(f.evaluate(&routers[0], "writer-one", "first").await);
    let b = f.child(f.evaluate(&routers[1], "writer-two", "second").await);
    f.manager
        .set_server_config(None, None, Some(false))
        .unwrap();
    for (router, child, name) in [
        (&routers[0], &a, "writer-one"),
        (&routers[1], &b, "writer-two"),
    ] {
        assert!(child.stopped.load(Ordering::SeqCst));
        assert_cookie_revoked(router, child).await;
        assert_eq!(
            request(
                router,
                "POST",
                "/.runtime/lua",
                Some(f.bearer(name)),
                "disabled"
            )
            .await
            .0,
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
    f.manager.set_server_config(None, None, Some(true)).unwrap();
    let fresh = f.child(f.evaluate(&routers[0], "writer-one", "new lease").await);
    assert_ne!(fresh.id, a.id);
    assert_ne!(fresh.cookie, a.cookie);
    assert_cookie_revoked(&routers[0], &a).await;
    assert_cookie_revoked(&routers[1], &b).await;
}

#[tokio::test]
async fn disabled_and_deleted_users_lose_headless_credentials_without_router_rebuild() {
    for delete in [false, true] {
        let f = Fixture::new();
        let id = f.space("/one", true);
        let router = f.router(&id);
        let child = f.child(
            f.evaluate(&router, "writer-one", "before account revocation")
                .await,
        );
        if delete {
            f.users.delete_user("writer-one").unwrap();
        } else {
            f.users.set_disabled("writer-one", true).unwrap();
        }
        assert_cookie_revoked(&router, &child).await;
        assert!(child.stopped.load(Ordering::SeqCst));
        assert_cookie_revoked(&f.router(&id), &child).await;
        assert_eq!(child.evaluations.load(Ordering::SeqCst), 1);
        if delete {
            f.users
                .create_user(
                    "writer-one",
                    "replacement-password",
                    false,
                    Profile::default(),
                )
                .unwrap();
        } else {
            f.users.set_disabled("writer-one", false).unwrap();
        }
        let token = f.users.create_token("writer-one", "new-token").unwrap();
        let (status, result) = request(
            &router,
            "POST",
            "/.runtime/lua",
            Some(("authorization", format!("Bearer {token}"))),
            "fresh account generation",
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_ne!(result["result"], child.id);
        assert_cookie_revoked(&router, &child).await;
    }
}

#[tokio::test]
async fn deleting_space_and_shutdown_stop_retained_routers() {
    let f = Fixture::new();
    for delete in [false, true] {
        let id = f.space(if delete { "/deleted" } else { "/shutdown" }, true);
        let router = f.router(&id);
        let child = f.child(f.evaluate(&router, "writer-one", "before shutdown").await);
        if delete {
            f.manager.delete(&id).unwrap();
        } else {
            f.manager.shutdown_runtimes();
        }
        assert!(child.stopped.load(Ordering::SeqCst));
        assert_cookie_revoked(&router, &child).await;
        assert_eq!(
            request(
                &router,
                "POST",
                "/.runtime/lua",
                Some(f.bearer("writer-one")),
                "after shutdown"
            )
            .await
            .0,
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}

#[tokio::test]
async fn anonymous_runtime_is_distinct_from_named_writer_and_does_not_bypass_opt_out() {
    let f = Fixture::new();
    let id = f.space("/public", true);
    let router = f.router(&id);
    let named = f.evaluate(&router, "writer-one", "named-only").await;
    let (status, result) = request(&router, "POST", "/.runtime/lua", None, "anonymous-only").await;
    assert_eq!(status, StatusCode::OK);
    assert_ne!(result["result"], named);
    let anonymous = f.child(result["result"].as_u64().unwrap() as usize);
    let (status, accounts) = request(&router, "GET", "/.accounts", cookie(&anonymous), "").await;
    assert_eq!(status, StatusCode::OK);
    assert!(accounts
        .as_array()
        .unwrap()
        .iter()
        .all(|account| account["username"].is_null()));
    assert_eq!(
        request(
            &router,
            "GET",
            "/.runtime/logs",
            Some(f.bearer("opted-out")),
            ""
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (_, logs) = request(&router, "GET", "/.runtime/logs", None, "").await;
    assert_eq!(logs["logs"].as_array().unwrap().len(), 1);
    assert_eq!(logs["logs"][0]["text"], "anonymous-only");
    assert_eq!(f.count(), 2);
}

#[tokio::test]
async fn runtime_administration_requires_admin_and_targets_one_runtime() {
    use silverbullet_server::multi::admin_api::{build_admin_api_router, AdminState};
    let f = Fixture::new();
    let space = f.space("/one", false);
    let admin = build_admin_api_router(Arc::new(AdminState::new(
        f.manager.clone(),
        f.users.clone(),
        Arc::new(Authenticator::from_secret_bytes(vec![9; 32], "v1".into())),
        silverbullet_server::runtime::RuntimeAvailability::Available,
    )));
    for credential in [None, Some(f.bearer("writer-one"))] {
        let expected = if credential.is_none() {
            StatusCode::UNAUTHORIZED
        } else {
            StatusCode::FORBIDDEN
        };
        for (method, path) in [
            ("GET", "/runtimes"),
            ("POST", "/runtimes/unknown/stop"),
            ("POST", "/runtimes/unknown/reset"),
        ] {
            assert_eq!(
                request(&admin, method, path, credential.clone(), "")
                    .await
                    .0,
                expected
            );
        }
    }
    let (status, empty) = request(&admin, "GET", "/runtimes", Some(f.bearer("keeper")), "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(empty, json!([]));
    assert_eq!(f.count(), 0);
    let router = f.router(&space);
    let first = f.evaluate(&router, "writer-one", "one").await;
    let second = f.evaluate(&router, "writer-two", "two").await;
    let (_, rows) = request(&admin, "GET", "/runtimes", Some(f.bearer("keeper")), "").await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    let row = rows
        .iter()
        .find(|row| row["username"] == "writer-one")
        .unwrap();
    assert_eq!(row["spaceId"], space);
    assert_eq!(row["spaceName"], "Fixture space");
    assert_eq!(row["cpuPercent"], 12.5);
    assert_eq!(row["memoryBytes"], 4096);
    assert_eq!(row["diskBytes"], 8192);
    let id = row["id"].as_str().unwrap();
    assert_eq!(
        request(
            &admin,
            "POST",
            &format!("/runtimes/{id}/stop"),
            Some(f.bearer("keeper")),
            ""
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert!(f.child(first).stopped.load(Ordering::SeqCst));
    assert!(!f.child(second).stopped.load(Ordering::SeqCst));
    assert_cookie_revoked(&router, &f.child(first)).await;
    assert_eq!(
        request(
            &admin,
            "POST",
            &format!("/runtimes/{id}/reset"),
            Some(f.bearer("keeper")),
            ""
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(
            &admin,
            "POST",
            &format!("/runtimes/{id}/reset"),
            Some(f.bearer("keeper")),
            ""
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn restarted_runtime_authenticates_as_the_represented_user() {
    let f = Fixture::new();
    let space = f.space("/one", false);
    let router = f.router(&space);
    let before = f.evaluate(&router, "writer-one", "before").await;
    let row = f.manager.runtime_instances().remove(0);
    f.manager.manage_runtime(&row.instance.id, false).unwrap();
    let after = f.evaluate(&router, "writer-one", "after").await;
    assert_ne!(before, after);
    assert_ne!(f.child(before).cookie, f.child(after).cookie);
    assert_cookie_revoked(&router, &f.child(before)).await;
    let (status, accounts) =
        request(&router, "GET", "/.accounts", cookie(&f.child(after)), "").await;
    assert_eq!(status, StatusCode::OK);
    let me = accounts
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["me"] == true)
        .unwrap();
    assert_eq!(me["username"], "writer-one");
    assert!(!f.manager.manage_runtime(&row.instance.id, true).unwrap());
    f.users.set_disabled("writer-one", true).unwrap();
    assert_cookie_revoked(&router, &f.child(after)).await;
}

#[tokio::test]
async fn prefixed_host_runtime_forwards_only_its_path_and_credential() {
    let f = Fixture::new();
    let id = f.space("/host", true);
    let mut config = f.manager.instance(&id).unwrap().config.clone();
    config.binding = silverbullet_server::multi::config::Binding::Host {
        host: "notes.example.test".into(),
        prefix: "/work".into(),
    };
    f.manager.update(&id, config).unwrap();
    let main = silverbullet_server::multi::dispatch::build_main_router(
        f.manager.clone(),
        Some(Router::new()),
        "fixture".into(),
    );
    let (status, value) = request_at(
        &main,
        "notes.example.test",
        "POST",
        "/work/.runtime/lua",
        Some(f.bearer("writer-one")),
        "prefixed runtime",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    let child = f.child(value["result"].as_u64().unwrap() as usize);
    assert!(child.server_url.ends_with(".runtime.localhost:3000/work"));
    let url = reqwest::Url::parse(&child.server_url).unwrap();
    let host = url.host_str().unwrap();
    let second = f.space("/other", false);
    let other = f.child(
        f.evaluate(&f.router(&second), "writer-one", "other runtime")
            .await,
    );
    for credential in [
        None,
        Some(f.bearer("writer-one")),
        cookie(&other),
        Some((
            "cookie",
            format!(
                "{}={}",
                headless_cookie_name(&id),
                other.cookie.split_once('=').unwrap().1
            ),
        )),
    ] {
        assert_eq!(
            request_at(&main, host, "GET", "/work/.config", credential, "")
                .await
                .0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        request_at(
            &main,
            host,
            "PUT",
            "/work/.fs/Welcome.md",
            cookie(&child),
            "# Fictional runtime notes"
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/work/.fs/Welcome.md",
            cookie(&child),
            ""
        )
        .await
        .1,
        json!("# Fictional runtime notes")
    );
    for path in [
        "/.dashboard",
        "/.dashboard/api/server-config",
        "/work/.dashboard/api/server-config",
    ] {
        assert_eq!(
            request_at(&main, host, "GET", path, cookie(&child), "")
                .await
                .0,
            StatusCode::FORBIDDEN,
            "{path}"
        );
    }
    for path in ["/.config", "/workother/.config"] {
        assert_eq!(
            request_at(&main, host, "GET", path, cookie(&child), "")
                .await
                .0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    let response = main
        .oneshot(
            Request::builder()
                .uri("/work?headless=1&filter=a%2Bb")
                .header("host", host)
                .header("cookie", &child.cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(
        response.headers()["location"],
        "/work/?headless=1&filter=a%2Bb"
    );
}

#[tokio::test]
async fn host_bound_runtime_uses_a_private_local_origin() {
    let f = Fixture::new();
    let id = f.space("/host", true);
    let mut config = f.manager.instance(&id).unwrap().config.clone();
    config.binding = silverbullet_server::multi::config::Binding::Host {
        host: "notes.example.test".into(),
        prefix: String::new(),
    };
    f.manager.update(&id, config).unwrap();
    let main = silverbullet_server::multi::dispatch::build_main_router(
        f.manager.clone(),
        Some(Router::new()),
        "fixture".into(),
    );
    let (status, value) = request_at(
        &main,
        "notes.example.test",
        "POST",
        "/.runtime/lua",
        Some(f.bearer("writer-one")),
        "host runtime",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    let child = f.child(value["result"].as_u64().unwrap() as usize);
    assert!(child.server_url.starts_with("http://"));
    assert!(child.server_url.ends_with(".runtime.localhost:3000"));
    let host = child.server_url.strip_prefix("http://").unwrap();
    for name in ["reader", "opted-out"] {
        assert_eq!(
            request_at(
                &main,
                "notes.example.test",
                "POST",
                "/.runtime/lua",
                Some(f.bearer(name)),
                "denied"
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    for credential in [
        None,
        Some(f.bearer("writer-one")),
        Some(f.bearer("keeper")),
        Some(("cookie", format!("{}=invalid", headless_cookie_name(&id)))),
    ] {
        for path in ["/", "/.fs/Test.md", "/.dashboard/api/server-config"] {
            assert_eq!(
                request_at(&main, host, "GET", path, credential.clone(), "")
                    .await
                    .0,
                StatusCode::FORBIDDEN,
                "{path}"
            );
        }
    }
    let second = f.space("/other", false);
    let other = f.child(
        f.evaluate(&f.router(&second), "writer-one", "other runtime")
            .await,
    );
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/",
            Some(("cookie", other.cookie.clone())),
            ""
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let other_token = other.cookie.split_once('=').unwrap().1;
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/",
            Some((
                "cookie",
                format!("{}={other_token}", headless_cookie_name(&id))
            )),
            ""
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request_at(
            &main,
            host,
            "PUT",
            "/.fs/Test.md",
            Some(("cookie", child.cookie.clone())),
            "host-bound contents"
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request_at(&main, "notes.example.test", "GET", "/.fs/Test.md", None, "")
            .await
            .1,
        json!("host-bound contents")
    );
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/.dashboard/api/server-config",
            Some(("cookie", child.cookie.clone())),
            ""
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request_at(
            &main,
            "unknown.runtime.localhost:3000",
            "GET",
            "/",
            None,
            ""
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    f.manager
        .set_server_config(None, None, Some(false))
        .unwrap();
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/.fs/Test.md",
            Some(("cookie", child.cookie.clone())),
            ""
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    f.manager.set_server_config(None, None, Some(true)).unwrap();
    let fresh = f.child(f.evaluate(&f.router(&id), "writer-one", "reenabled").await);
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/.fs/Test.md",
            Some(("cookie", fresh.cookie.clone())),
            ""
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut config = f.manager.instance(&id).unwrap().config.clone();
    config.members.get_mut("writer-one").unwrap().runtime_api = false;
    f.manager.update(&id, config).unwrap();
    assert_eq!(
        request_at(
            &main,
            host,
            "GET",
            "/.fs/Test.md",
            Some(("cookie", fresh.cookie.clone())),
            ""
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}
