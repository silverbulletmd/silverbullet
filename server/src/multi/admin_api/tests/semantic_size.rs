//! The space-size policy of semantic search, over the admin API, with real
//! page counts: each space's folder holds one page more than the limit, so
//! it is off by default and may be turned on. The policy itself is
//! unit-tested in `search::policy`.

use super::*;
use silverbullet_server_search::semantic::size::SEMANTIC_MAX_PAGES;

const OVER: u64 = SEMANTIC_MAX_PAGES + 1;
const OFF_BY_DEFAULT: &str = "This space has 5,001 pages, more than 5,000, so semantic search is off by default. Turn it on to build it anyway; the first build can take a long time.";

/// An admin API over `dir` whose model is `test-tiny`, embedding with a
/// fake.
fn semantic_router(dir: &tempfile::TempDir) -> (axum::Router, Arc<MultiManager>, Arc<UserStore>) {
    use silverbullet_server_search::semantic::test_model::{offer_test_tiny, FakeEmbedder};
    use silverbullet_server_search::semantic::{catalog, SemanticService};
    offer_test_tiny();
    let spec = catalog::find("test-tiny").unwrap().clone();
    let server = serde_json::json!({ "search": { "model": spec.id } });
    std::fs::write(dir.path().join("server.json"), server.to_string()).unwrap();
    let fake = Arc::new(FakeEmbedder {
        spec,
        ..FakeEmbedder::new()
    });
    let search = SpaceSearch::in_root(crate::search::search_root(dir.path()))
        .with_semantic(SemanticService::with_embedder(fake));
    admin_router_on(dir, crate::runtime::RuntimeAvailability::Available, search)
}

/// Fills `<dir>/<folder>` with [`OVER`] pages.
fn fill(dir: &tempfile::TempDir, folder: &str) {
    let folder = dir.path().join(folder);
    std::fs::create_dir_all(&folder).unwrap();
    for i in 0..OVER {
        std::fs::write(folder.join(format!("Orchard {i}.md")), "apple blossom\n").unwrap();
    }
}

async fn patch(
    router: &axum::Router,
    cookie: &str,
    id: &str,
    body: &str,
) -> axum::response::Response {
    authed(router, "PATCH", &format!("/api/spaces/{id}"), body, cookie).await
}

/// `GET spaces/{id}/search` until `done` holds (60 s).
async fn search_until(
    router: &axum::Router,
    cookie: &str,
    id: &str,
    done: impl Fn(&serde_json::Value) -> bool,
) -> serde_json::Value {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        let uri = format!("/api/spaces/{id}/search");
        let v = body_json(authed(router, "GET", &uri, "", cookie).await).await;
        if done(&v) {
            return v;
        }
        assert!(std::time::Instant::now() < deadline, "{v}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// The space's search offer once its index has counted its pages. The
/// space itself carries none.
async fn counted_offer(router: &axum::Router, cookie: &str, id: &str) -> serde_json::Value {
    let space =
        body_json(authed(router, "GET", &format!("/api/spaces/{id}"), "", cookie).await).await;
    assert!(space.get("semanticSearchOffer").is_none(), "{space}");
    let counted = |v: &serde_json::Value| {
        !v["offer"]["offByDefault"].is_null() || !v["offer"]["warning"].is_null()
    };
    search_until(router, cookie, id, counted).await["offer"].clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_large_space_is_off_by_default_and_turning_it_on_builds_it() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = semantic_router(&dir);
    let cookie = session_cookie(&users, "admin");
    fill(&dir, "orchard");
    let orchard = create_space(
        &router,
        &cookie,
        r#"{"name":"Orchard","folder":"orchard","binding":{"prefix":"/orchard"},"seedIndex":false}"#,
    )
    .await;
    assert_eq!(
        counted_offer(&router, &cookie, &orchard).await,
        serde_json::json!({ "offByDefault": OFF_BY_DEFAULT, "warning": null })
    );
    let info = search_until(&router, &cookie, &orchard, |_| true).await;
    assert_eq!(info["semantic"], "offTooLarge");

    let resp = patch(&router, &cookie, &orchard, r#"{"semanticSearch":true}"#).await;
    assert_eq!(resp.status(), StatusCode::OK, "turning it on is allowed");
    let built = search_until(&router, &cookie, &orchard, |v| {
        v["semantic"] == "on"
            && v["indexes"].as_array().is_some_and(|indexes| {
                indexes
                    .iter()
                    .any(|r| r["kind"] == "semantic" && r["state"] == "ready")
            })
    })
    .await;
    assert_eq!(built["semanticChoice"], true);
    // The rebuilt instance's full-text index may still be catching up on a
    // first build the PATCH cut short; its count reaches every page.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while manager.instance(&orchard).unwrap().pages() != Some(OVER) {
        assert!(
            std::time::Instant::now() < deadline,
            "page count never reached {OVER}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn a_space_already_on_keeps_it_above_the_limit() {
    let dir = tempfile::tempdir().unwrap();
    let (router, _manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    fill(&dir, "meadow");
    // A new space has no count yet: turning it on is allowed.
    let meadow = create_space(
        &router,
        &cookie,
        r#"{"name":"Meadow","folder":"meadow","binding":{"prefix":"/meadow"},"seedIndex":false,"semanticSearch":true}"#,
    )
    .await;
    counted_offer(&router, &cookie, &meadow).await;
    let resp = patch(&router, &cookie, &meadow, r#"{"name":"Wildflower Meadow"}"#).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let v = body_json(
        authed(
            &router,
            "GET",
            &format!("/api/spaces/{meadow}"),
            "",
            &cookie,
        )
        .await,
    )
    .await;
    assert_eq!(
        (&v["name"], &v["semanticSearch"]),
        (
            &serde_json::json!("Wildflower Meadow"),
            &serde_json::json!(true)
        )
    );
    let resp = patch(&router, &cookie, &meadow, r#"{"semanticSearch":false}"#).await;
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_moved_space_does_not_take_over_its_old_count() {
    let dir = tempfile::tempdir().unwrap();
    let (router, manager, users) = admin_router(&dir);
    let cookie = session_cookie(&users, "admin");
    fill(&dir, "orchard");
    let orchard = create_space(
        &router,
        &cookie,
        r#"{"name":"Orchard","folder":"orchard","binding":{"prefix":"/orchard"},"seedIndex":false}"#,
    )
    .await;
    counted_offer(&router, &cookie, &orchard).await;
    let resp = patch(&router, &cookie, &orchard, r#"{"folder":"grove"}"#).await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_ne!(manager.instance(&orchard).unwrap().pages(), Some(OVER));
}
