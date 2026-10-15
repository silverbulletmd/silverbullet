//! Which search engine serves a space and where its files live
//! ([`SpaceSearch`]), whether a space runs semantic search ([`policy`]),
//! what the dashboards show about it ([`report`]), how its index directory
//! is laid out and removed (`index_root`), and the change events that keep
//! its indexes current (`events`). The HTTP layer (`handlers::search`) only
//! ever sees `Arc<dyn SearchBackend>`. Every mode (multi-user, single-space,
//! Desktop) starts it the same way: [`SpaceSearch::in_root`] (or
//! [`SpaceSearch::in_memory`]), then [`SpaceSearch::boot`].

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock};

use silverbullet_server_common::space::GitignoreMatcher;
use silverbullet_server_common::SpacePrimitives;
use silverbullet_server_search::semantic::catalog::ModelSpec;
use silverbullet_server_search::semantic::download::{ModelStore, StoredModel};
use silverbullet_server_search::semantic::{inference, SemanticBackend, SemanticService};
use silverbullet_server_search::FullTextBackend;
use silverbullet_server_search::SpaceView;

/// The engine every space's search runs on, for embedders (Desktop).
pub use silverbullet_server_search::SearchBackend;
use tokio::sync::broadcast;

use crate::watcher::FsEvent;

/// Where a space's full-text index lives: `Disk(<index root>/<space id>)` or RAM.
pub use silverbullet_server_search::Location;

/// Re-exported so embedders can build a gate without depending on the search crate.
pub use silverbullet_server_search::Gate;

/// What the index reads a space through (see `silverbullet_server_search::view`).
pub use silverbullet_server_search::SpaceSearchView;

/// The directory search keeps its files in (`indexes/`, `models/`).
pub use silverbullet_server_search::SearchRoot;

mod events;
mod index_root;
pub mod policy;
pub mod report;

pub use events::{change_events, WriteEvents};
pub use index_root::RemovalGuard;
pub use policy::{folder_pages, RemoveModelError, SemanticChoice, SemanticSpaceState, SpaceToOpen};
pub use report::{
    model_card, SearchModelCard, SemanticSearchOffer, SpaceSearchInfo, SpaceSearchStatus,
};

use events::change_feed;
use index_root::{remove_index_dir, sweep_models, IndexRoot, Removals};

/// The directory under a multi-user data root (or Desktop's app data
/// directory) that search keeps its files in.
pub const SEARCH_DIR: &str = "search";

/// `<data root>/search`: a multi-user server's data root, or Desktop's
/// app data directory.
pub fn search_root(data_root: &Path) -> SearchRoot {
    SearchRoot::new(data_root.join(SEARCH_DIR))
}

/// A space's engine: the full-text index at `location`, or, with
/// `semantic` (the server's service and the space's id, under which its
/// semantic index outlives instance rebuilds), a `SemanticBackend` holding
/// that full-text index and the space's semantic index (both under
/// `location`). `name` names the space in log lines. `space` is what the
/// indexes read and `ignore` its `SB_SPACE_IGNORE` matcher (see
/// [`SpaceToOpen`]); `events` keeps the indexes current (see
/// [`change_events`]); with a receiver whose sender is gone, they catch up
/// on their periodic reconcile only. Spaces open through
/// [`SpaceSearch::open`], which decides `semantic`.
///
/// Must be called inside a tokio runtime: the indexes' tasks are spawned on
/// it and stop with it.
pub(crate) fn engine(
    name: &str,
    space: Arc<dyn SpacePrimitives>,
    ignore: GitignoreMatcher,
    location: Location,
    events: broadcast::Receiver<FsEvent>,
    semantic: Option<(Arc<SemanticService>, &str)>,
) -> Arc<dyn SearchBackend> {
    let view: Arc<dyn SpaceView> = Arc::new(SpaceSearchView::new(space, ignore));
    let Some((service, id)) = semantic else {
        return Arc::new(FullTextBackend::new(
            name,
            location,
            view,
            change_feed(events),
        ));
    };
    // Each index gets its own feed from the same watcher.
    let semantic_feed = change_feed(events.resubscribe());
    let fulltext = Arc::new(FullTextBackend::new(
        name,
        location.clone(),
        view.clone(),
        change_feed(events),
    ));
    let space = service.attach(id, name, location, view.clone(), semantic_feed);
    Arc::new(SemanticBackend::new(fulltext, space, view))
}

/// Full-text search over a space that isn't one of a [`SpaceSearch`]'s
/// spaces (Desktop's ephemeral and unregistered spaces), at `location`.
/// See [`engine`] for the parameters. Must be called inside a tokio runtime.
pub fn full_text_backend(
    name: &str,
    space: Arc<dyn SpacePrimitives>,
    ignore: GitignoreMatcher,
    location: Location,
    events: broadcast::Receiver<FsEvent>,
) -> Arc<dyn SearchBackend> {
    engine(name, space, ignore, location, events, None)
}

/// In-memory full-text search over every file of `space`, kept current by
/// its periodic reconcile only, and the gate its requests pass: a test
/// server's search. Must be called inside a tokio runtime.
pub fn in_memory_full_text(space: Arc<dyn SpacePrimitives>) -> (Arc<dyn SearchBackend>, Arc<Gate>) {
    let events = broadcast::channel(1).1;
    let search = full_text_backend(
        "space",
        space,
        GitignoreMatcher::default(),
        Location::Memory,
        events,
    );
    (search, Arc::new(Gate::new()))
}

/// The pages the full-text index would index in `space` (visible `.md`
/// files up to `limits::MAX_FILE_BYTES`, `ignore` applied), for the size
/// policy of semantic search when no index has counted them yet. `None`
/// when the listing fails.
pub fn page_count(space: Arc<dyn SpacePrimitives>, ignore: GitignoreMatcher) -> Option<u64> {
    use silverbullet_server_search::limits::MAX_FILE_BYTES;
    let listed = SpaceSearchView::new(space, ignore).list_meta()?;
    let pages = listed
        .iter()
        .filter(|(path, stamp)| path.ends_with(".md") && stamp.size <= MAX_FILE_BYTES)
        .count();
    Some(pages as u64)
}

/// Starts the semantic service for a model, its files under a search root.
pub type ServiceFactory =
    Arc<dyn Fn(&ModelSpec, &SearchRoot) -> Arc<SemanticService> + Send + Sync>;

/// A server's search service: the gate every space's requests pass, where
/// indexes and models live, and the semantic service spaces attach to. It
/// sweeps what no space uses and starts semantic search at boot
/// ([`SpaceSearch::boot`]), decides which engine serves each space
/// ([`SpaceSearch::open`]), switches the model ([`SpaceSearch::set_model`])
/// and removes a deleted space's indexes ([`SpaceSearch::remove_space`]).
/// One per server; clones share everything.
#[derive(Clone)]
pub struct SpaceSearch {
    /// Admits every space's search requests; one per server, so the query
    /// pool is server-wide.
    pub gate: Arc<Gate>,
    /// Where indexes and models live; `None` keeps every index in RAM.
    root: Option<SearchRoot>,
    /// The server's semantic search, when [`SpaceSearch::boot`] or
    /// [`SpaceSearch::set_model`] was given a model; spaces that run
    /// semantic search attach to it.
    semantic: Arc<RwLock<Option<Arc<SemanticService>>>>,
    /// How [`SpaceSearch::boot`] and [`SpaceSearch::set_model`] start one.
    factory: ServiceFactory,
    /// What [`SpaceSearch::open`] last decided for each space id: what its
    /// running engine does.
    opened: Arc<Mutex<HashMap<String, SemanticSpaceState>>>,
    /// Spaces whose index directory is being removed: opening one waits.
    removals: Removals,
}

impl SpaceSearch {
    /// Every index in RAM and no semantic search: single-space mode without
    /// `SB_SEARCH_DIR`, tests. [`SpaceSearch::boot`] changes nothing.
    pub fn in_memory() -> SpaceSearch {
        SpaceSearch {
            gate: Arc::new(Gate::new()),
            root: None,
            semantic: Arc::default(),
            factory: Arc::new(|spec, root| {
                let models = ModelStore::new(root.models());
                // Debug builds: the e2e harness serves its tiny model itself.
                #[cfg(debug_assertions)]
                let models = silverbullet_server_search::semantic::e2e::store(spec, models);
                SemanticService::start_on(spec.clone(), models, inference::THREADS)
            }),
            opened: Arc::default(),
            removals: Removals::default(),
        }
    }

    /// Indexes and models under `root`: `<data root>/search` on a
    /// multi-user server ([`search_root`]), `SB_SEARCH_DIR` on a
    /// single-space one, `<app data>/search` on Desktop. Nothing is swept or
    /// started until [`SpaceSearch::boot`].
    pub fn in_root(root: SearchRoot) -> SpaceSearch {
        SpaceSearch {
            root: Some(root),
            ..SpaceSearch::in_memory()
        }
    }

    /// At start-up, before any space opens: with `live`, deletes the index
    /// directories of space ids it rejects and old index formats
    /// ([`IndexRoot::sweep`]; a caller that can't list its spaces passes
    /// `None`), deletes superseded model revisions, and with `model` starts
    /// semantic search (through the factory) and its download, whether or
    /// not any space attaches. In RAM nothing happens: there is no model
    /// store. The download starts only inside a tokio runtime.
    pub fn boot(
        self,
        model: Option<&'static ModelSpec>,
        live: Option<&dyn Fn(&str) -> bool>,
    ) -> SpaceSearch {
        let Some(root) = &self.root else {
            return self;
        };
        if let Some(live) = live {
            IndexRoot::of(root).sweep(live);
        }
        sweep_models(&root.models());
        let service = model.map(|spec| {
            tracing::info!("Search: semantic search with {}", spec.display_name);
            (self.factory)(spec, root)
        });
        if let (Some(service), Ok(_)) = (&service, tokio::runtime::Handle::try_current()) {
            service.prefetch();
        }
        *self.semantic.write().unwrap() = service;
        self
    }

    /// Where indexes and models live; `None` in RAM.
    pub fn root(&self) -> Option<&SearchRoot> {
        self.root.as_ref()
    }

    /// Tests: semantic search through `service`, and through it again for
    /// any model [`SpaceSearch::boot`] or [`SpaceSearch::set_model`] starts
    /// later (a fake embedder).
    #[cfg(any(test, feature = "test-model"))]
    pub fn with_semantic(self, service: Arc<SemanticService>) -> SpaceSearch {
        let factory = {
            let service = service.clone();
            Arc::new(move |_: &ModelSpec, _: &SearchRoot| service.clone())
        };
        SpaceSearch {
            semantic: Arc::new(RwLock::new(Some(service))),
            factory,
            ..self
        }
    }

    /// Tests: semantic services come from `factory`, at boot and on
    /// [`SpaceSearch::set_model`].
    #[cfg(test)]
    pub(crate) fn with_factory(self, factory: ServiceFactory) -> SpaceSearch {
        SpaceSearch { factory, ..self }
    }

    /// The current semantic service, if any.
    pub fn semantic(&self) -> Option<Arc<SemanticService>> {
        self.semantic.read().unwrap().clone()
    }

    /// The model semantic search runs with, if any.
    pub fn model(&self) -> Option<ModelSpec> {
        self.semantic().map(|service| service.model().clone())
    }

    /// Switches semantic search to `spec` (`None`: off). The old service
    /// shuts down (its download is cancelled and its spaces fail their next
    /// job, so the caller rebuilds them); the new one starts downloading its
    /// model at once. `false` when nothing changed (the same model), and in
    /// RAM, which has no model store (single-space mode never gets here).
    /// Must be called inside a tokio runtime.
    pub fn set_model(&self, spec: Option<&'static ModelSpec>) -> bool {
        let Some(root) = &self.root else {
            tracing::warn!("search: can't choose a model when indexes are kept in memory");
            return false;
        };
        let mut semantic = self.semantic.write().unwrap();
        if semantic.as_ref().map(|s| s.model().id) == spec.map(|s| s.id) {
            return false;
        }
        if let Some(old) = semantic.take() {
            old.shutdown();
        }
        *semantic = spec.map(|spec| {
            tracing::info!("Search: semantic search now uses {}", spec.display_name);
            let service = (self.factory)(spec, root);
            service.prefetch();
            service
        });
        true
    }

    /// The offered models with files in the model store (none in RAM).
    pub fn stored_models(&self) -> Vec<StoredModel> {
        self.root
            .as_ref()
            .map(|root| ModelStore::new(root.models()).stored())
            .unwrap_or_default()
    }

    /// Deletes `spec`'s directory from the model store (partial downloads
    /// included); nothing there, or in RAM, is not an error. The caller
    /// refuses the model in use.
    pub fn remove_model(&self, spec: &'static ModelSpec) -> std::io::Result<()> {
        let Some(root) = &self.root else {
            return Ok(());
        };
        let models = root.models();
        remove_index_dir(&models, &models.join(spec.dir_name())).map(|_| ())
    }

    fn indexes(&self) -> Option<IndexRoot> {
        self.root.as_ref().map(IndexRoot::of)
    }

    /// Where space `id`'s indexes live: `Disk(<indexes>/<id>)`, or RAM.
    pub fn location(&self, id: &str) -> Location {
        match self.indexes() {
            Some(indexes) => indexes.location(id),
            None => Location::Memory,
        }
    }

    /// Fences space `id`'s index directory until the guard drops:
    /// [`SpaceSearch::open`] waits for it, and [`SpaceSearch::is_removing`]
    /// reports it. [`SpaceSearch::remove_space`] and
    /// [`SpaceSearch::remove_space_now`] hold one while they run; a caller
    /// that hands the removal to another task takes one first, so that an
    /// open asked for in between is fenced too.
    pub fn fence_removal(&self, id: &str) -> RemovalGuard {
        self.removals.start(id)
    }

    /// Whether space `id`'s index directory is fenced for removal
    /// ([`SpaceSearch::fence_removal`]).
    pub fn is_removing(&self, id: &str) -> bool {
        self.removals.contains(id)
    }

    /// Best effort, on its own thread: [`SpaceSearch::remove_space_now`],
    /// fenced from now on. A request still holding the old instance can at
    /// worst fail to commit into it. Call it once the space is gone from the
    /// config.
    ///
    /// The retries don't re-check the config: space ids come from
    /// `Uuid::new_v4` in `create` and are never reused, so no new instance can
    /// claim this directory while they run. Only a hand edit of `spaces.json`
    /// re-adding the same id within those 5 s could, and its open waits for
    /// the removal, then rebuilds its index from the space's files.
    pub fn remove_space(&self, id: &str) {
        if self.semantic().is_none() && self.root.is_none() {
            return;
        }
        let fence = self.fence_removal(id);
        let (search, id) = (self.clone(), id.to_string());
        std::thread::spawn(move || {
            search.remove_space_now(&id);
            drop(fence);
        });
    }

    /// Forgets space `id`'s semantic index and waits until no sink holds its
    /// file (a save in flight finishes first, so no late checkpoint
    /// recreates its directory), then removes its index directory
    /// ([`IndexRoot::remove_space_now`], with its retries), fenced while it
    /// runs. Returns once it is done (Desktop drops a closed space's indexes
    /// so its next open rebuilds them).
    pub fn remove_space_now(&self, id: &str) {
        let _fence = self.fence_removal(id);
        self.opened.lock().unwrap().remove(id);
        if let Some(semantic) = self.semantic() {
            semantic.forget(id);
        }
        if let Some(indexes) = self.indexes() {
            // A sink a toggle-off or a model switch (to another model or to
            // none) left closing still holds its file.
            silverbullet_server_search::semantic::lease::wait_closed_at(&indexes.location(id));
            indexes.remove_space_now(id);
        }
    }
}

#[cfg(test)]
mod tests;
