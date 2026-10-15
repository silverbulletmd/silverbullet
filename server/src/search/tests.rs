use super::*;
use silverbullet_server_common::space::{DiskSpacePrimitives, MemorySpacePrimitives};
use silverbullet_server_search::semantic::catalog;
use silverbullet_server_search::semantic::test_model::FakeEmbedder;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_engine_with_a_semantic_service_is_the_semantic_backend() {
    let service = SemanticService::with_embedder(Arc::new(FakeEmbedder::new()));
    let (_tx, rx) = broadcast::channel(4);
    let backend = engine(
        "notes",
        Arc::new(MemorySpacePrimitives::new()),
        GitignoreMatcher::default(),
        Location::Memory,
        rx,
        Some((service.clone(), "notes")),
    );
    assert_eq!(backend.status().backend.as_deref(), Some("semantic"));
    let (_tx, rx) = broadcast::channel(4);
    let plain = full_text_backend(
        "notes",
        Arc::new(MemorySpacePrimitives::new()),
        GitignoreMatcher::default(),
        Location::Memory,
        rx,
    );
    assert_eq!(plain.status().backend.as_deref(), Some("fulltext"));
    let (memory, _gate) = in_memory_full_text(Arc::new(MemorySpacePrimitives::new()));
    assert_eq!(memory.status().backend.as_deref(), Some("fulltext"));
}

/// The setting decides the engine; without a semantic service every space
/// is full-text. In RAM, `boot` sweeps nothing and starts nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_space_search_attaches_only_opted_in_spaces() {
    let engine = |search: &SpaceSearch, on: bool| {
        let (_tx, rx) = broadcast::channel(4);
        let space = SpaceToOpen {
            id: "notes",
            name: "notes",
            space: Arc::new(MemorySpacePrimitives::new()),
            ignore: GitignoreMatcher::default(),
            events: rx,
            choice: if on {
                SemanticChoice::On
            } else {
                SemanticChoice::Off
            },
        };
        search.open(space, || None).status().backend
    };
    let e5 = catalog::find("multilingual-e5-small").unwrap();
    let plain = SpaceSearch::in_memory().boot(Some(e5), Some(&|_| false));
    assert!(plain.model().is_none());
    assert_eq!(engine(&plain, true).as_deref(), Some("fulltext"));
    let semantic = SpaceSearch::in_memory().with_semantic(SemanticService::with_embedder(
        Arc::new(FakeEmbedder::new()),
    ));
    assert_eq!(semantic.model().map(|m| m.id), Some("test-fake"));
    assert_eq!(engine(&semantic, true).as_deref(), Some("semantic"));
    assert_eq!(engine(&semantic, false).as_deref(), Some("fulltext"));
}

#[test]
fn read_and_list_meta_refuse_server_control_files() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("Fern.md"), "fern").unwrap();
    std::fs::write(dir.path().join("server.json"), "{}").unwrap();
    let disk = DiskSpacePrimitives::new(dir.path(), "").unwrap();
    let filtered = crate::multi::data_root::ServerControlFileFilter::new(Box::new(disk));
    let view = SpaceSearchView::new(Arc::new(filtered), GitignoreMatcher::default());
    assert_eq!(view.read("server.json"), None);
    assert_eq!(view.read("Fern.md").as_deref(), Some(&b"fern"[..]));
    let meta = view.list_meta().unwrap();
    assert!(!meta.contains_key("server.json"), "{meta:?}");
    assert!(meta.contains_key("Fern.md"));
}

#[tokio::test]
async fn stored_models_are_listed_and_removed() {
    let dir = tempfile::tempdir().unwrap();
    let search = SpaceSearch::in_root(search_root(dir.path()));
    assert!(search.stored_models().is_empty());
    let e5 = catalog::find("multilingual-e5-small").unwrap();
    let model_dir = search_root(dir.path()).models().join(e5.dir_name());
    std::fs::create_dir_all(&model_dir).unwrap();
    std::fs::write(model_dir.join("model.safetensors.partial"), "seeds").unwrap();
    let stored = search.stored_models();
    assert_eq!(stored.len(), 1);
    assert_eq!((stored[0].spec.id, stored[0].bytes), (e5.id, 5));
    assert!(!stored[0].complete);
    search.remove_model(e5).unwrap();
    assert!(!model_dir.exists());
    assert!(search.stored_models().is_empty());
    search.remove_model(e5).unwrap();
}

#[tokio::test]
async fn in_memory_search_refuses_a_model() {
    let search = SpaceSearch::in_memory();
    let e5 = catalog::find("multilingual-e5-small").unwrap();
    assert!(!search.set_model(Some(e5)));
    assert!(search.model().is_none());
    assert!(search.stored_models().is_empty());
}

/// `in_root` keeps indexes and models under the root it is given; `boot`
/// sweeps what `live` rejects and starts semantic search only with a model.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_search_root_keeps_indexes_under_it_and_boot_sweeps_them() {
    let dir = tempfile::tempdir().unwrap();
    let indexes = dir.path().join("search/indexes");
    for id in ["single", "gone"] {
        std::fs::create_dir_all(indexes.join(id).join("fulltext-v2")).unwrap();
    }
    let search = SpaceSearch::in_root(SearchRoot::new(dir.path().join("search")))
        .boot(None, Some(&|id| id == "single"));
    assert!(search.model().is_none());
    assert!(search.semantic().is_none());
    assert!(indexes.join("single").is_dir());
    assert!(!indexes.join("gone").exists(), "swept");
    assert!(matches!(
        search.location("single"),
        Location::Disk(p) if p == indexes.join("single")
    ));
    assert_eq!(
        search.root().map(|r| r.path().to_path_buf()),
        Some(dir.path().join("search"))
    );
    let fake = SemanticService::with_embedder(Arc::new(FakeEmbedder::new()));
    let e5 = catalog::find("multilingual-e5-small").unwrap();
    let with_model = SpaceSearch::in_root(SearchRoot::new(dir.path().join("search")))
        .with_semantic(fake)
        .boot(Some(e5), None);
    assert_eq!(with_model.model().map(|m| m.id), Some("test-fake"));
    assert!(indexes.join("single").is_dir(), "no sweep without `live`");
}

/// Opening a space waits while its index directory is fenced for removal.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn opening_a_space_waits_for_its_removal() {
    let dir = tempfile::tempdir().unwrap();
    let search = SpaceSearch::in_root(search_root(dir.path()));
    let fence = search.fence_removal("notes");
    assert!(search.is_removing("notes"));
    let opened = {
        let search = search.clone();
        let runtime = tokio::runtime::Handle::current();
        std::thread::spawn(move || {
            let _entered = runtime.enter();
            let space = SpaceToOpen {
                id: "notes",
                name: "notes",
                space: Arc::new(MemorySpacePrimitives::new()),
                ignore: GitignoreMatcher::default(),
                events: broadcast::channel(4).1,
                choice: SemanticChoice::Default,
            };
            search.open(space, || None).status().backend
        })
    };
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!opened.is_finished(), "fenced");
    drop(fence);
    assert_eq!(opened.join().unwrap().as_deref(), Some("fulltext"));
    assert!(!search.is_removing("notes"));
    search.remove_space_now("notes");
    assert!(!search.is_removing("notes"), "its own fence is lifted");
    assert_eq!(
        search.opened_state("notes"),
        None,
        "its decision is forgotten"
    );
}

/// Pages are what the full-text index would index: visible `.md` files up
/// to 1 MiB, ignore rules applied; attachments and dot paths don't count.
#[test]
fn page_count_counts_what_the_index_would_index() {
    let dir = tempfile::tempdir().unwrap();
    for (name, body) in [
        ("Fern.md", "fern"),
        ("notes/Moss.md", "moss"),
        ("notes/photo.png", "png"),
        (".hidden/Old.md", "old"),
        ("archive/Lichen.md", "lichen"),
    ] {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }
    std::fs::write(dir.path().join("Huge.md"), vec![b'a'; (1 << 20) + 1]).unwrap();
    let disk = DiskSpacePrimitives::new(dir.path(), "archive/").unwrap();
    let ignore = disk.gitignore_matcher();
    assert_eq!(page_count(Arc::new(disk), ignore), Some(2));
}
