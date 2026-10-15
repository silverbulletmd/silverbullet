//! What the dashboards show about search, the Server's (admin API) and
//! Desktop's alike: the model card ([`model_card`]) and each space's search
//! status ([`SpaceSearch::space_status`]) with its size offer
//! ([`SpaceSearch::space_info`]).

use serde::{Deserialize, Serialize};
use silverbullet_server_search::semantic::catalog;
use silverbullet_server_search::semantic::download::DownloadState;
use silverbullet_server_search::{IndexReport, SearchBackend};

use super::policy::{SemanticChoice, SemanticSpaceState};
use super::SpaceSearch;

/// The model in use, what this server offers and stores ([`model_card`]).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchModelCard {
    model: Option<&'static str>,
    catalog: Vec<CatalogEntry>,
    download: Option<DownloadState>,
    stored: Vec<StoredEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    id: &'static str,
    display_name: &'static str,
    languages: &'static str,
    download_bytes: u64,
    resident_bytes: u64,
    license: &'static str,
    homepage: &'static str,
    notice: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredEntry {
    id: &'static str,
    display_name: &'static str,
    bytes: u64,
    complete: bool,
    active: bool,
}

/// The model card of `search`: the model in use, the offered models, its
/// download, and the models on disk. Walks the model store: call it off
/// async workers.
pub fn model_card(search: &SpaceSearch) -> SearchModelCard {
    let active = search.model().map(|spec| spec.id);
    let catalog = catalog::offered()
        .into_iter()
        .map(|spec| CatalogEntry {
            id: spec.id,
            display_name: spec.display_name,
            languages: spec.languages,
            download_bytes: spec.download_bytes(),
            resident_bytes: spec.resident_bytes,
            license: spec.license,
            homepage: spec.homepage,
            notice: spec.notice,
        })
        .collect();
    let stored = search
        .stored_models()
        .into_iter()
        .map(|stored| StoredEntry {
            id: stored.spec.id,
            display_name: stored.spec.display_name,
            bytes: stored.bytes,
            complete: stored.complete,
            active: active == Some(stored.spec.id),
        })
        .collect();
    SearchModelCard {
        model: active,
        catalog,
        download: search.semantic().map(|service| service.download_state()),
        stored,
    }
}

/// How the dashboard offers semantic search for a space
/// ([`SpaceSearch::offer`]): `offByDefault` when it is off by default for
/// its size (the note the box shows, checked or not), else `warning` when
/// it is above the limit (each `null` otherwise).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchOffer {
    pub off_by_default: Option<String>,
    pub warning: Option<String>,
}

/// A space's search: its effective state, page count and indexes
/// ([`SpaceSearch::space_status`]).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSearchStatus {
    /// Whether it runs semantic search (`semantic` is `on`).
    pub semantic_search: bool,
    /// Its stored `semanticSearch`: `null` follows the default.
    pub semantic_choice: SemanticChoice,
    pub semantic: SemanticSpaceState,
    /// The pages its full-text index counts (the size rule's count, and
    /// what a rebuild re-reads).
    pub pages: Option<u64>,
    /// Its indexes; empty without an engine.
    pub indexes: Vec<IndexReport>,
}

/// A space's search with its size offer: `GET spaces/{id}/search`, and
/// Desktop's space settings ([`SpaceSearch::space_info`]).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceSearchInfo {
    #[serde(flatten)]
    pub status: SpaceSearchStatus,
    pub offer: SemanticSearchOffer,
}

impl SpaceSearch {
    /// The search status of space `id` (setting `choice`) whose engine is
    /// `engine` (`None`: it has none, e.g. a closed Desktop space). Its
    /// pages are the engine's live count, else `pages` (a count kept from
    /// an earlier engine, or its folder's).
    pub fn space_status(
        &self,
        id: &str,
        choice: SemanticChoice,
        engine: Option<&dyn SearchBackend>,
        pages: Option<u64>,
    ) -> SpaceSearchStatus {
        let indexes = engine.map(|e| e.indexes()).unwrap_or_default();
        let pages = engine.and_then(|e| e.pages()).or(pages);
        let semantic = self.engine_state(id, choice, engine.is_some(), pages);
        SpaceSearchStatus {
            semantic_search: semantic == SemanticSpaceState::On,
            semantic_choice: choice,
            semantic,
            pages,
            indexes,
        }
    }

    /// [`SpaceSearch::space_status`] with its offer ([`SpaceSearch::offer`]).
    pub fn space_info(
        &self,
        id: &str,
        choice: SemanticChoice,
        engine: Option<&dyn SearchBackend>,
        pages: Option<u64>,
    ) -> SpaceSearchInfo {
        let status = self.space_status(id, choice, engine, pages);
        SpaceSearchInfo {
            offer: self.offer(id, status.pages),
            status,
        }
    }
}
