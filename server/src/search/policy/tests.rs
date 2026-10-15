use super::*;
use crate::search::{Location, SearchRoot};
use silverbullet_server_common::space::MemorySpacePrimitives;
use silverbullet_server_search::semantic::size::SEMANTIC_MAX_PAGES;
use silverbullet_server_search::semantic::store;
use silverbullet_server_search::semantic::test_model::{offer_test_tiny, FakeEmbedder};
use silverbullet_server_search::semantic::SemanticService;
use SemanticChoice::{Default, Off, On};
use SemanticSpaceState::{NoModel, OffByChoice, OffTooLarge};

const OVER: u64 = SEMANTIC_MAX_PAGES + 1;
const ID: &str = "4f1d-orchard";

/// Search under `dir` with a semantic service embedding with `fake`.
fn search_with(dir: &tempfile::TempDir, fake: FakeEmbedder) -> SpaceSearch {
    let service = SemanticService::with_embedder(Arc::new(fake));
    SpaceSearch::in_root(SearchRoot::new(dir.path())).with_semantic(service)
}

fn search(dir: &tempfile::TempDir) -> SpaceSearch {
    search_with(dir, FakeEmbedder::new())
}

fn without_model(dir: &tempfile::TempDir) -> SpaceSearch {
    SpaceSearch::in_root(SearchRoot::new(dir.path()))
}

/// Writes space [`ID`]'s semantic index file for `search`'s model: it was
/// admitted before (a first build that started, finished or not).
fn admit(search: &SpaceSearch) {
    let Location::Disk(dir) = search.location(ID) else {
        panic!("on disk")
    };
    let file = store::file_path(&dir, &search.model().unwrap());
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, b"placeholder").unwrap();
}

fn unasked() -> Option<u64> {
    panic!("the page count doesn't decide this")
}

#[test]
fn the_choice_is_an_optional_bool_on_the_wire() {
    let parse = |json: &str| serde_json::from_str::<SemanticChoice>(json).unwrap();
    assert_eq!(parse("null"), Default);
    assert_eq!(parse("false"), Off);
    assert_eq!(parse("true"), On);
    assert_eq!(
        serde_json::to_value([Default, Off, On]).unwrap(),
        serde_json::json!([null, false, true])
    );
    assert_eq!(
        serde_json::to_value([SemanticSpaceState::On, OffByChoice, OffTooLarge, NoModel]).unwrap(),
        serde_json::json!(["on", "offByChoice", "offTooLarge", "noModel"])
    );
}

/// Absent, false and true; over the limit, at it, and an unknown count;
/// already built; no model.
#[test]
fn the_state_follows_the_choice_the_size_and_the_model() {
    let dir = tempfile::tempdir().unwrap();
    let search = search(&dir);
    let state = |choice, pages: Option<u64>| search.semantic_state(ID, choice, || pages);
    assert_eq!(
        state(Default, Some(SEMANTIC_MAX_PAGES)),
        SemanticSpaceState::On
    );
    assert_eq!(
        state(Default, None),
        SemanticSpaceState::On,
        "unknown count"
    );
    assert_eq!(state(Default, Some(OVER)), OffTooLarge);
    assert_eq!(search.semantic_state(ID, Off, unasked), OffByChoice);
    assert_eq!(
        search.semantic_state(ID, On, unasked),
        SemanticSpaceState::On,
        "an explicit true is on at any size"
    );
    admit(&search);
    assert_eq!(
        search.semantic_state(ID, Default, unasked),
        SemanticSpaceState::On,
        "admitted before, kept at any size"
    );
    let plain = without_model(&dir);
    for choice in [Default, Off, On] {
        assert_eq!(plain.semantic_state(ID, choice, unasked), NoModel);
    }
}

/// A running engine reports what `open` decided for it; no engine, or one
/// whose decision no longer applies, reports the rule.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_running_engine_reports_what_open_decided() {
    let dir = tempfile::tempdir().unwrap();
    let search = search(&dir);
    let state = |choice, running, pages| search.engine_state(ID, choice, running, pages);
    assert_eq!(
        state(Default, true, Some(1)),
        SemanticSpaceState::On,
        "never opened"
    );
    opened(&search, Default, Some(OVER));
    assert_eq!(
        state(Default, true, Some(1)),
        OffTooLarge,
        "it opened too large"
    );
    assert_eq!(
        state(Default, false, Some(1)),
        SemanticSpaceState::On,
        "no engine: the rule"
    );
    opened(&search, Default, Some(1));
    assert_eq!(state(Default, true, Some(OVER)), SemanticSpaceState::On);
    assert_eq!(state(Default, false, Some(OVER)), OffTooLarge);
    assert_eq!(state(Off, true, None), OffByChoice);
    assert_eq!(
        without_model(&dir).engine_state(ID, On, true, None),
        NoModel,
        "no model wins"
    );
    opened(&search, Off, Some(1));
    assert_eq!(
        state(On, true, None),
        SemanticSpaceState::On,
        "an old opt-out yields"
    );
}

fn opened(search: &SpaceSearch, choice: SemanticChoice, pages: Option<u64>) -> Option<String> {
    let space = SpaceToOpen {
        id: ID,
        name: "Orchard",
        space: Arc::new(MemorySpacePrimitives::new()),
        ignore: GitignoreMatcher::default(),
        events: broadcast::channel(4).1,
        choice,
    };
    search.open(space, || pages).status().backend
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_attaches_what_the_rule_turns_on() {
    let dir = tempfile::tempdir().unwrap();
    let search = search(&dir);
    let semantic = Some("semantic".to_string());
    let full_text = Some("fulltext".to_string());
    assert_eq!(opened(&search, Default, Some(SEMANTIC_MAX_PAGES)), semantic);
    assert_eq!(opened(&search, Default, None), semantic);
    assert_eq!(opened(&search, Default, Some(OVER)), full_text, "too large");
    assert_eq!(opened(&search, On, Some(OVER)), semantic);
    assert_eq!(opened(&search, Off, Some(1)), full_text);
    admit(&search);
    assert_eq!(
        opened(&search, Default, Some(OVER)),
        semantic,
        "admitted before"
    );
    assert_eq!(
        opened(&without_model(&dir), On, Some(1)),
        full_text,
        "no model"
    );
}

/// Every setting at every size: following the default is off above the
/// limit, an explicit true is on at any size, false is off; an unknown
/// count is on by default.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_setting_at_every_size() {
    let dir = tempfile::tempdir().unwrap();
    let search = search(&dir);
    let (on, full) = (Some("semantic".to_string()), Some("fulltext".to_string()));
    for (choice, under, over, unknown) in [
        (
            Default,
            SemanticSpaceState::On,
            OffTooLarge,
            SemanticSpaceState::On,
        ),
        (
            On,
            SemanticSpaceState::On,
            SemanticSpaceState::On,
            SemanticSpaceState::On,
        ),
        (Off, OffByChoice, OffByChoice, OffByChoice),
    ] {
        for (pages, expected) in [
            (Some(SEMANTIC_MAX_PAGES), under),
            (Some(OVER), over),
            (None, unknown),
        ] {
            assert_eq!(
                search.semantic_state(ID, choice, || pages),
                expected,
                "{choice:?} {pages:?}"
            );
            let backend = if expected == SemanticSpaceState::On {
                &on
            } else {
                &full
            };
            assert_eq!(
                &opened(&search, choice, pages),
                backend,
                "{choice:?} {pages:?}"
            );
        }
    }
}

/// The dashboard's offer: off by default above the limit until the space
/// was admitted, then the warning; nothing at or below it, or unknown.
#[test]
fn the_offer_says_off_by_default_or_warns() {
    let dir = tempfile::tempdir().unwrap();
    let search = search(&dir);
    let offer = |pages| serde_json::to_value(search.offer(ID, pages)).unwrap();
    let warning = "This space has more pages than semantic search is tuned for (5,000); results may be less relevant.";
    assert_eq!(
        offer(Some(12_340)),
        serde_json::json!({
            "offByDefault": "This space has 12,340 pages, more than 5,000, so semantic search is off by default. Turn it on to build it anyway; the first build can take a long time.",
            "warning": null,
        })
    );
    let none = serde_json::json!({ "offByDefault": null, "warning": null });
    for pages in [Some(SEMANTIC_MAX_PAGES), None] {
        assert_eq!(offer(pages), none);
    }
    admit(&search);
    assert_eq!(
        offer(Some(OVER)),
        serde_json::json!({ "offByDefault": null, "warning": warning }),
        "admitted before: it keeps building"
    );
}

#[test]
fn only_an_offered_model_not_in_use_is_removed() {
    offer_test_tiny();
    let dir = tempfile::tempdir().unwrap();
    let tiny = catalog::resolve("test-tiny").expect("test-tiny is offered");
    let search = search_with(
        &dir,
        FakeEmbedder {
            spec: tiny.clone(),
            ..FakeEmbedder::new()
        },
    );
    assert!(matches!(
        search.remove_offered_model("pear-embed"),
        Err(RemoveModelError::Unknown)
    ));
    let in_use = search.remove_offered_model("test-tiny").unwrap_err();
    assert_eq!(
        in_use.to_string(),
        "The model in use can't be removed; choose None first."
    );
    let e5 = catalog::resolve("multilingual-e5-small").unwrap();
    let files = search.root().unwrap().models().join(e5.dir_name());
    std::fs::create_dir_all(&files).unwrap();
    std::fs::write(files.join("config.json.partial"), "{}").unwrap();
    search.remove_offered_model(e5.id).unwrap();
    assert!(!files.exists());
}

#[test]
fn a_folder_counts_its_visible_pages() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["Apple.md", "Pear.md", "archive/Plum.md", "photo.png"] {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "orchard").unwrap();
    }
    assert_eq!(folder_pages(dir.path(), "archive/"), Some(2));
    assert_eq!(folder_pages(&dir.path().join("missing"), ""), None);
}
