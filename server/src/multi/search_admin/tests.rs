use super::*;
use crate::multi::admin_api::tests::{
    admin_router_on, authed, body_json, create_space, send, session_cookie,
};
use crate::multi::manager::MultiManager;
use crate::runtime::RuntimeAvailability;
use crate::search::SpaceSearch;
use axum::body::Body;
use axum::http::Request;
use serde_json::json;
use silverbullet_server_search::semantic::catalog;
use silverbullet_server_search::semantic::test_model::{offer_test_tiny, FakeEmbedder};
use silverbullet_server_search::semantic::SemanticService;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

/// An embedder posing as `test-tiny` (offered in debug builds once
/// [`offer_test_tiny`] has run), so the model in use is an offered one.
fn tiny_fake() -> Arc<FakeEmbedder> {
    offer_test_tiny();
    let spec = catalog::find("test-tiny")
        .expect("test-tiny is offered")
        .clone();
    Arc::new(FakeEmbedder {
        spec,
        ..FakeEmbedder::new()
    })
}

/// Search under `dir`'s data root, its semantic service embedding with
/// `fake`, the model `server.json` names.
fn fake_semantic_search(dir: &tempfile::TempDir, fake: &Arc<FakeEmbedder>) -> SpaceSearch {
    let server = json!({ "search": { "model": fake.spec.id } });
    std::fs::write(dir.path().join("server.json"), server.to_string()).unwrap();
    SpaceSearch::in_root(crate::search::search_root(dir.path()))
        .with_semantic(SemanticService::with_embedder(fake.clone()))
}

/// A signed-in admin over a server whose model is `test-tiny` (a fake).
struct Admin {
    _dir: tempfile::TempDir,
    router: axum::Router,
    manager: Arc<MultiManager>,
    cookie: String,
    fake: Arc<FakeEmbedder>,
}

impl Admin {
    async fn get(&self, uri: &str) -> serde_json::Value {
        body_json(authed(&self.router, "GET", uri, "", &self.cookie).await).await
    }

    async fn call(&self, method: &str, uri: &str, body: &str) -> axum::response::Response {
        authed(&self.router, method, uri, body, &self.cookie).await
    }

    /// Polls `GET spaces/{id}/search` until every index is ready (30 s).
    async fn wait_until_ready(&self, id: &str) -> serde_json::Value {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let info = self.get(&format!("/api/spaces/{id}/search")).await;
            let indexes = info["indexes"].as_array().cloned().unwrap_or_default();
            if !indexes.is_empty() && indexes.iter().all(|r| r["state"] == "ready") {
                return info;
            }
            assert!(Instant::now() < deadline, "never ready: {info}");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
}

fn admin() -> Admin {
    let dir = tempfile::tempdir().unwrap();
    let fake = tiny_fake();
    let search = fake_semantic_search(&dir, &fake);
    let (router, manager, users) = admin_router_on(&dir, RuntimeAvailability::Available, search);
    let cookie = session_cookie(&users, "admin");
    Admin {
        _dir: dir,
        router,
        manager,
        cookie,
        fake,
    }
}

/// [`admin`] with `spaces` (name, `semanticSearch`, `null` for `None`)
/// created through `POST /api/spaces`, one page each; their ids in order.
async fn admin_with_spaces(spaces: &[(&str, Option<bool>)]) -> (Admin, Vec<String>) {
    let admin = admin();
    let mut ids = Vec::new();
    for &(name, semantic) in spaces {
        let folder = name.to_lowercase();
        let path = admin._dir.path().join(&folder);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("Basil.md"),
            "grow basil in the sun and water the soil\n",
        )
        .unwrap();
        let body = json!({
            "name": name,
            "folder": folder,
            "binding": { "prefix": format!("/{folder}") },
            "seedIndex": false,
            "semanticSearch": semantic,
        });
        ids.push(create_space(&admin.router, &admin.cookie, &body.to_string()).await);
    }
    (admin, ids)
}

fn request(method: &str, uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("host", "localhost")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_search_routes_are_admin_only() {
    let dir = tempfile::tempdir().unwrap();
    let search = fake_semantic_search(&dir, &tiny_fake());
    let (router, _manager, _users) = admin_router_on(&dir, RuntimeAvailability::Available, search);
    for (method, uri) in [
        ("GET", "/api/search"),
        ("PUT", "/api/search"),
        ("GET", "/api/spaces/x/search"),
        ("POST", "/api/spaces/x/search/rebuild"),
        ("DELETE", "/api/search/models/x"),
    ] {
        let resp = send(&router, request(method, uri, "{}")).await;
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_overview_lists_the_offered_models_and_each_spaces_search() {
    let (admin, ids) = admin_with_spaces(&[("Garden", Some(true)), ("Kitchen", Some(false))]).await;
    let body = admin.get("/api/search").await;
    assert_eq!(body["model"], "test-tiny");
    let catalog = body["catalog"].as_array().unwrap();
    let models: Vec<_> = catalog.iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(
        models[..2],
        [
            "granite-embedding-97m-multilingual-r2",
            "multilingual-e5-small"
        ],
        "the recommended model comes first, e5-small stays offered"
    );
    let granite = &catalog[0];
    assert_eq!(
        granite["displayName"],
        "Granite Embedding 97M Multilingual R2"
    );
    assert_eq!(granite["license"], "Apache-2.0");
    assert_eq!(
        granite["notice"],
        "ibm-granite/granite-embedding-97m-multilingual-r2 by IBM, Apache-2.0 license."
    );
    assert_eq!(granite["downloadBytes"], 220_192_456);
    let e5 = &catalog[1];
    assert_eq!(e5["displayName"], "Multilingual E5 Small");
    assert_eq!(e5["license"], "MIT");
    assert!(e5["downloadBytes"].as_u64().unwrap() > 0);
    assert_eq!(body["download"]["state"], "ready");
    assert!(body["stored"].is_array());
    assert_eq!(body["spaces"][&ids[0]]["semanticSearch"], true);
    assert_eq!(body["spaces"][&ids[1]]["semanticSearch"], false);
    assert!(body["spaces"][&ids[1]]["indexes"].is_array());
    assert!(
        body["spaces"][&ids[0]].get("badge").is_none(),
        "the dashboard derives the badge from the indexes"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn putting_an_unknown_model_is_a_field_error() {
    let (admin, _) = admin_with_spaces(&[]).await;
    for body in [r#"{"model":"no-such-model"}"#, "{}", r#"{"model":7}"#] {
        let resp = admin.call("PUT", "/api/search", body).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST, "{body}");
        assert_eq!(body_json(resp).await["errors"][0]["field"], "model");
    }
    assert_eq!(admin.manager.search().model().unwrap().id, "test-tiny");
}

#[tokio::test(flavor = "multi_thread")]
async fn putting_none_turns_semantic_search_off() {
    let (admin, ids) = admin_with_spaces(&[("Garden", None)]).await;
    let resp = admin.call("PUT", "/api/search", r#"{"model":null}"#).await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert!(
        body["model"].is_null() && body["download"].is_null(),
        "{body}"
    );
    let info = admin.wait_until_ready(&ids[0]).await;
    assert_eq!(info["indexes"].as_array().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_space_reports_both_indexes_without_a_rebuild_estimate() {
    let (admin, ids) = admin_with_spaces(&[("Garden", None)]).await;
    let body = admin.wait_until_ready(&ids[0]).await;
    let kinds: Vec<_> = body["indexes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["kind"].clone())
        .collect();
    assert_eq!(kinds, [json!("fullText"), json!("semantic")]);
    assert_eq!(body["semanticSearch"], true);
    assert_eq!(body["semanticChoice"], json!(null));
    assert_eq!(body["semantic"], "on");
    assert_eq!(
        body["offer"],
        json!({ "offByDefault": null, "warning": null })
    );
    assert!(body.get("rebuild").is_none(), "{body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_space_is_not_found() {
    let (admin, _) = admin_with_spaces(&[]).await;
    let resp = admin.call("GET", "/api/spaces/nope/search", "").await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn rebuild_twice_is_accepted_once() {
    let (admin, ids) = admin_with_spaces(&[("Garden", None)]).await;
    admin.wait_until_ready(&ids[0]).await;
    // Everything one build embeds; a rebuild embeds it all again.
    let build = admin.fake.texts.load(Ordering::SeqCst);
    assert!(build > 0);
    // Holding the embedder keeps the first rebuild running for the second.
    admin.fake.hold.store(true, Ordering::SeqCst);
    let uri = format!("/api/spaces/{}/search/rebuild", ids[0]);
    for _ in 0..2 {
        let resp = admin.call("POST", &uri, "").await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        assert_eq!(
            body_json(resp).await["indexes"].as_array().unwrap().len(),
            2
        );
    }
    admin.fake.hold.store(false, Ordering::SeqCst);
    let deadline = Instant::now() + Duration::from_secs(30);
    while admin.fake.texts.load(Ordering::SeqCst) < 2 * build {
        assert!(Instant::now() < deadline, "the rebuild never embedded");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    admin.wait_until_ready(&ids[0]).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        admin.fake.texts.load(Ordering::SeqCst),
        2 * build,
        "one rebuild ran"
    );
}

/// Review I1: a rebuild asked for while the semantic index's first build
/// runs is accepted and starts nothing more: the first build embeds every
/// page once, and only a later rebuild embeds them again.
#[tokio::test(flavor = "multi_thread")]
async fn a_rebuild_during_the_first_build_starts_nothing_more() {
    let admin = admin();
    // Held from the start, the first semantic build can't finish.
    admin.fake.hold.store(true, Ordering::SeqCst);
    let path = admin._dir.path().join("orchard");
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("Pears.md"), "prune the pear trees in winter\n").unwrap();
    let body = json!({
        "name": "Orchard",
        "folder": "orchard",
        "binding": { "prefix": "/orchard" },
        "seedIndex": false,
    });
    let id = create_space(&admin.router, &admin.cookie, &body.to_string()).await;
    // A full-text index still opening refuses a rebuild (409); wait it out.
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let info = admin.get(&format!("/api/spaces/{id}/search")).await;
        let indexes = info["indexes"].as_array().cloned().unwrap_or_default();
        let full = indexes.iter().find(|r| r["kind"] == "fullText");
        if full.is_some_and(|r| r["state"] != "starting") {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the full-text index never opened: {info}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let resp = admin
        .call("POST", &format!("/api/spaces/{id}/search/rebuild"), "")
        .await;
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let info = body_json(resp).await;
    let semantic = info["indexes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["kind"] == "semantic")
        .cloned()
        .unwrap();
    assert_ne!(
        semantic["state"], "ready",
        "still in its first build: {info}"
    );
    admin.fake.hold.store(false, Ordering::SeqCst);
    admin.wait_until_ready(&id).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let build = admin.fake.texts.load(Ordering::SeqCst);
    assert!(build > 0);
    // A rebuild now embeds everything again, once: as much as one build.
    let resp = admin
        .call("POST", &format!("/api/spaces/{id}/search/rebuild"), "")
        .await;
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let deadline = Instant::now() + Duration::from_secs(30);
    while admin.fake.texts.load(Ordering::SeqCst) < 2 * build {
        assert!(Instant::now() < deadline, "the rebuild never embedded");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    admin.wait_until_ready(&id).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        admin.fake.texts.load(Ordering::SeqCst),
        2 * build,
        "the first build ran once, the later rebuild once"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn rebuilding_an_unknown_space_is_not_found() {
    let (admin, _) = admin_with_spaces(&[]).await;
    let resp = admin
        .call("POST", "/api/spaces/nope/search/rebuild", "")
        .await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_config_change_during_a_rebuild_ends_ready() {
    let (admin, ids) = admin_with_spaces(&[("Garden", None)]).await;
    admin.wait_until_ready(&ids[0]).await;
    let resp = admin
        .call(
            "POST",
            &format!("/api/spaces/{}/search/rebuild", ids[0]),
            "",
        )
        .await;
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let resp = admin
        .call(
            "PATCH",
            &format!("/api/spaces/{}", ids[0]),
            r#"{"name":"Herb Garden"}"#,
        )
        .await;
    assert_eq!(resp.status(), StatusCode::OK);
    admin.wait_until_ready(&ids[0]).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_the_active_model_is_refused() {
    let admin = admin();
    let resp = admin
        .call("DELETE", "/api/search/models/test-tiny", "")
        .await;
    assert_eq!(resp.status(), StatusCode::CONFLICT);
    assert_eq!(
        body_json(resp).await,
        json!({ "errors": [{ "field": "", "message": "The model in use can't be removed; choose None first." }] })
    );
    let resp = admin
        .call("DELETE", "/api/search/models/no-such-model", "")
        .await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_a_model_not_in_use_deletes_its_files() {
    let admin = admin();
    let spec = catalog::find("multilingual-e5-small").unwrap();
    let dir = admin
        ._dir
        .path()
        .join("search/models")
        .join(spec.dir_name());
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("config.json.partial"), "{}").unwrap();
    let stored = admin.get("/api/search").await["stored"].clone();
    assert_eq!(stored[0]["id"], spec.id, "{stored}");
    assert_eq!(stored[0]["active"], false);
    let uri = format!("/api/search/models/{}", spec.id);
    let resp = admin.call("DELETE", &uri, "").await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    assert!(!dir.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_overview_lists_every_spaces_choice_state_pages_and_indexes() {
    let spaces = [("Garden", None), ("Kitchen", Some(false))];
    let (admin, ids) = admin_with_spaces(&spaces).await;
    admin.wait_until_ready(&ids[0]).await;
    admin.wait_until_ready(&ids[1]).await;
    let body = admin.get("/api/search").await;
    let garden = &body["spaces"][&ids[0]];
    assert_eq!(garden["name"], "Garden");
    assert_eq!(
        (
            &garden["semanticSearch"],
            &garden["semanticChoice"],
            &garden["semantic"]
        ),
        (&json!(true), &json!(null), &json!("on"))
    );
    assert_eq!(garden["pages"], 1);
    let kinds: Vec<_> = garden["indexes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["kind"].clone(), r["state"].clone()))
        .collect();
    assert_eq!(
        kinds,
        [
            (json!("fullText"), json!("ready")),
            (json!("semantic"), json!("ready"))
        ]
    );
    assert!(garden.get("rebuild").is_none(), "{garden}");
    let kitchen = &body["spaces"][&ids[1]];
    assert_eq!(
        (
            &kitchen["semanticSearch"],
            &kitchen["semanticChoice"],
            &kitchen["semantic"]
        ),
        (&json!(false), &json!(false), &json!("offByChoice"))
    );
    assert_eq!(kitchen["indexes"].as_array().unwrap().len(), 1);

    admin.call("PUT", "/api/search", r#"{"model":null}"#).await;
    let body = admin.get("/api/search").await;
    assert_eq!(body["spaces"][&ids[0]]["semantic"], "noModel");
    assert_eq!(body["spaces"][&ids[0]]["semanticSearch"], false);
    assert_eq!(body["spaces"][&ids[0]]["semanticChoice"], json!(null));
}

#[tokio::test(flavor = "multi_thread")]
async fn patching_semantic_search_stores_false_and_null_clears_it() {
    let (admin, ids) = admin_with_spaces(&[("Garden", None)]).await;
    let uri = format!("/api/spaces/{}", ids[0]);
    let stored = || {
        let path = admin._dir.path().join("spaces.json");
        let spaces: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        spaces[&ids[0]].get("semanticSearch").cloned()
    };
    assert_eq!(stored(), None);
    assert_eq!(admin.get(&uri).await["semanticSearch"], json!(null));

    let resp = admin
        .call("PATCH", &uri, r#"{"semanticSearch":false}"#)
        .await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(stored(), Some(json!(false)));
    assert_eq!(admin.get(&uri).await["semanticSearch"], false);
    let info = admin.get(&format!("{uri}/search")).await;
    assert_eq!(info["semantic"], "offByChoice");
    assert_eq!(info["indexes"].as_array().unwrap().len(), 1);

    let resp = admin
        .call("PATCH", &uri, r#"{"semanticSearch":true}"#)
        .await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(stored(), Some(json!(true)));
    assert_eq!(admin.get(&uri).await["semanticSearch"], true);

    let resp = admin
        .call("PATCH", &uri, r#"{"semanticSearch":null}"#)
        .await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(stored(), None, "null clears it to follow the default");
    assert_eq!(admin.get(&uri).await["semanticSearch"], json!(null));
    let info = admin.wait_until_ready(&ids[0]).await;
    assert_eq!(
        (&info["semanticChoice"], &info["semantic"]),
        (&json!(null), &json!("on"))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_default_space_above_the_limit_stays_full_text_until_turned_on() {
    use silverbullet_server_search::semantic::size::SEMANTIC_MAX_PAGES;
    let admin = admin();
    let folder = admin._dir.path().join("orchard");
    std::fs::create_dir_all(&folder).unwrap();
    for i in 0..=SEMANTIC_MAX_PAGES {
        std::fs::write(folder.join(format!("Orchard {i}.md")), "apple blossom\n").unwrap();
    }
    let body = r#"{"name":"Orchard","folder":"orchard","binding":{"prefix":"/orchard"},"seedIndex":false}"#;
    let id = create_space(&admin.router, &admin.cookie, body).await;
    let info = admin.wait_until_ready(&id).await;
    assert_eq!(
        (
            &info["semanticSearch"],
            &info["semanticChoice"],
            &info["semantic"]
        ),
        (&json!(false), &json!(null), &json!("offTooLarge"))
    );
    assert_eq!(info["indexes"].as_array().unwrap().len(), 1, "{info}");
    let row = admin.get("/api/search").await["spaces"][&id].clone();
    assert_eq!(row["semantic"], "offTooLarge");
    assert_eq!(row["pages"], SEMANTIC_MAX_PAGES + 1);

    let uri = format!("/api/spaces/{id}");
    let resp = admin
        .call("PATCH", &uri, r#"{"semanticSearch":true}"#)
        .await;
    assert_eq!(resp.status(), StatusCode::OK, "explicit on is allowed");
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let info = admin.wait_until_ready(&id).await;
        if info["semantic"] == "on" && info["indexes"].as_array().unwrap().len() == 2 {
            break;
        }
        assert!(Instant::now() < deadline, "never built: {info}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
