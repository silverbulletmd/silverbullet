//! Whether a space runs semantic search: on by default once the server has
//! a model, unless the space opts out, or follows the default while it is
//! too large and was never admitted before
//! ([`SpaceSearch::semantic_admitted_before`]). [`SpaceSearch`] owns the
//! rule, and every mode (multi-user, single-space, Desktop) asks it here:
//! [`SpaceSearch::open`] decides, attaches and records the decision when a
//! space's engine is built, [`SpaceSearch::semantic_state`] and
//! [`SpaceSearch::engine_state`] report it, [`SpaceSearch::offer`] tells
//! the dashboard about the size, and [`SpaceSearch::remove_offered_model`] guards the
//! model store. The size limit and its wording live in
//! `silverbullet_server_search::semantic::size`.

use std::fmt;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use silverbullet_server_common::space::{DiskSpacePrimitives, GitignoreMatcher};
use silverbullet_server_common::SpacePrimitives;
use silverbullet_server_search::semantic::catalog;
use silverbullet_server_search::semantic::size::{oversize_warning, too_large, SemanticTooLarge};
use silverbullet_server_search::semantic::store;
use silverbullet_server_search::{Location, SearchBackend};
use tokio::sync::broadcast;

use super::{engine, page_count, SemanticSearchOffer, SpaceSearch};
use crate::watcher::FsEvent;

/// A space's `semanticSearch` setting. Stored and sent as `Option<bool>`:
/// absent or `null` follows the default, `false` opts out, `true` opts in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(from = "Option<bool>", into = "Option<bool>")]
pub enum SemanticChoice {
    /// On once the server has a model, unless the space is too large.
    #[default]
    Default,
    Off,
    On,
}

impl SemanticChoice {
    pub fn is_default(&self) -> bool {
        *self == SemanticChoice::Default
    }
}

impl From<Option<bool>> for SemanticChoice {
    fn from(stored: Option<bool>) -> Self {
        match stored {
            None => SemanticChoice::Default,
            Some(false) => SemanticChoice::Off,
            Some(true) => SemanticChoice::On,
        }
    }
}

impl From<SemanticChoice> for Option<bool> {
    fn from(choice: SemanticChoice) -> Self {
        match choice {
            SemanticChoice::Default => None,
            SemanticChoice::Off => Some(false),
            SemanticChoice::On => Some(true),
        }
    }
}

/// Whether a space runs semantic search, and why not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticSpaceState {
    On,
    /// Its `semanticSearch` is `false`.
    OffByChoice,
    /// It follows the default but has more pages than semantic search is
    /// turned on for, and was never admitted before.
    OffTooLarge,
    /// The server has no model.
    NoModel,
}

/// The rule: the state of a space with setting `choice` when the server
/// has a model (`model`) and the space was admitted to semantic search
/// before (`admitted`, asked only for a space that follows the default),
/// and why a space following the default is off. `pages` (`None`: unknown,
/// on) is asked only when the answer depends on it. An explicit `On` is on
/// at any size.
pub(crate) fn decide(
    model: bool,
    choice: SemanticChoice,
    admitted: impl FnOnce() -> bool,
    pages: impl FnOnce() -> Option<u64>,
) -> (SemanticSpaceState, Option<SemanticTooLarge>) {
    match choice {
        _ if !model => (SemanticSpaceState::NoModel, None),
        SemanticChoice::Off => (SemanticSpaceState::OffByChoice, None),
        SemanticChoice::On => (SemanticSpaceState::On, None),
        SemanticChoice::Default if admitted() => (SemanticSpaceState::On, None),
        SemanticChoice::Default => match too_large(pages()) {
            None => (SemanticSpaceState::On, None),
            Some(off) => (SemanticSpaceState::OffTooLarge, Some(off)),
        },
    }
}

/// The pages the full-text index would index in `folder` with the space's
/// `SB_SPACE_IGNORE` rules ([`page_count`]), for the size rule of a space
/// whose engine hasn't counted them. `None` when the folder can't be read.
pub fn folder_pages(folder: &Path, space_ignore: &str) -> Option<u64> {
    let disk = DiskSpacePrimitives::new(folder, space_ignore).ok()?;
    let ignore = disk.gitignore_matcher();
    page_count(Arc::new(disk), ignore)
}

/// A space whose engine [`SpaceSearch::open`] builds.
pub struct SpaceToOpen<'a> {
    /// Its id: names its indexes' directory and its semantic index.
    pub id: &'a str,
    /// Names it in log lines.
    pub name: &'a str,
    /// What the indexes read: only the space's own files (the primary
    /// layer, not the bundled fallback such as `Library/Std`).
    pub space: Arc<dyn SpacePrimitives>,
    /// Its `SB_SPACE_IGNORE` matcher (`DiskSpacePrimitives::gitignore_matcher`).
    pub ignore: GitignoreMatcher,
    /// Keeps the indexes current (see [`super::change_events`]).
    pub events: broadcast::Receiver<FsEvent>,
    /// Its `semanticSearch`.
    pub choice: SemanticChoice,
}

/// Why [`SpaceSearch::remove_offered_model`] removed nothing.
#[derive(Debug)]
pub enum RemoveModelError {
    /// No offered model has that id.
    Unknown,
    /// It is the model in use.
    InUse,
    /// Its files couldn't be removed (the model's display name, and why).
    Io(&'static str, std::io::Error),
}

impl fmt::Display for RemoveModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RemoveModelError::Unknown => write!(f, "no such model"),
            RemoveModelError::InUse => {
                write!(f, "The model in use can't be removed; choose None first.")
            }
            RemoveModelError::Io(name, error) => write!(f, "Could not remove {name}: {error}"),
        }
    }
}

impl std::error::Error for RemoveModelError {}

impl SpaceSearch {
    /// Whether space `id` was admitted to semantic search with the current
    /// model before: it has a semantic index directory with the model's
    /// file. A first build that started and was interrupted counts too, so
    /// it keeps building after a restart at any size, even when the space
    /// follows the default and is now above the limit (a ruling: the file's
    /// completion flag is deliberately not read).
    pub fn semantic_admitted_before(&self, id: &str) -> bool {
        match (self.model(), self.location(id)) {
            (Some(spec), Location::Disk(dir)) => store::file_path(&dir, &spec).is_file(),
            _ => false,
        }
    }

    fn decide(
        &self,
        id: &str,
        choice: SemanticChoice,
        pages: impl FnOnce() -> Option<u64>,
    ) -> (SemanticSpaceState, Option<SemanticTooLarge>) {
        decide(
            self.model().is_some(),
            choice,
            || self.semantic_admitted_before(id),
            pages,
        )
    }

    /// Whether space `id` with setting `choice` runs semantic search when
    /// its engine is built: `NoModel` without a model, else as the choice
    /// says; a space that follows the default is on unless its `pages`
    /// (asked only then, and only when it wasn't admitted before) are above
    /// the limit.
    pub fn semantic_state(
        &self,
        id: &str,
        choice: SemanticChoice,
        pages: impl FnOnce() -> Option<u64>,
    ) -> SemanticSpaceState {
        self.decide(id, choice, pages).0
    }

    /// The state of space `id` (setting `choice`, `pages` pages) whose
    /// engine is `running` or not: what [`SpaceSearch::open`] decided for
    /// its running engine (on, or too large) wins over what opening it now
    /// would do. No model or an opt-out always wins: the engine is rebuilt
    /// for those.
    pub fn engine_state(
        &self,
        id: &str,
        choice: SemanticChoice,
        running: bool,
        pages: Option<u64>,
    ) -> SemanticSpaceState {
        match self.semantic_state(id, choice, || pages) {
            state @ (SemanticSpaceState::NoModel | SemanticSpaceState::OffByChoice) => state,
            state if running => match self.opened_state(id) {
                Some(opened @ (SemanticSpaceState::On | SemanticSpaceState::OffTooLarge)) => opened,
                _ => state,
            },
            state => state,
        }
    }

    /// What [`SpaceSearch::open`] last decided for space `id`; `None` when
    /// it never opened (or its indexes were removed since).
    pub(crate) fn opened_state(&self, id: &str) -> Option<SemanticSpaceState> {
        self.opened.lock().unwrap().get(id).copied()
    }

    /// Builds `space`'s engine at its location ([`SpaceSearch::location`]):
    /// full-text search, attached to the semantic service when
    /// [`SpaceSearch::semantic_state`] says it runs semantic search.
    /// `pages` counts the space for the size rule (see [`folder_pages`]);
    /// a space too large stays full-text, which is logged. Off (or never
    /// on), its semantic index leaves memory and its file stays; closing it
    /// may wait for a save, so that happens off this thread. The decision is
    /// recorded for [`SpaceSearch::engine_state`]. Waits while the space's
    /// index directory is being removed ([`SpaceSearch::fence_removal`]).
    ///
    /// Must be called inside a tokio runtime: the indexes' tasks are spawned
    /// on it and stop with it.
    pub fn open(
        &self,
        space: SpaceToOpen<'_>,
        pages: impl FnOnce() -> Option<u64>,
    ) -> Arc<dyn SearchBackend> {
        let SpaceToOpen {
            id,
            name,
            space,
            ignore,
            events,
            choice,
        } = space;
        self.removals.wait(id);
        let (state, off) = self.decide(id, choice, pages);
        self.opened.lock().unwrap().insert(id.to_string(), state);
        if let Some(off) = off {
            tracing::info!("Search (space \"{name}\"): {off}");
        }
        let semantic = match self.semantic() {
            Some(service) if state == SemanticSpaceState::On => Some((service, id)),
            Some(service) => {
                service.forget_in_background(id);
                None
            }
            None => None,
        };
        engine(name, space, ignore, self.location(id), events, semantic)
    }

    /// How the dashboard offers semantic search for space `id` with
    /// `pages` pages: `off_by_default` when the space is above the limit and
    /// wasn't admitted before (following the default leaves it off; turning
    /// it on explicitly builds it anyway), else `warning` when it is above
    /// the limit. Any setting may be saved.
    pub fn offer(&self, id: &str, pages: Option<u64>) -> SemanticSearchOffer {
        let off_by_default = too_large(pages).filter(|_| !self.semantic_admitted_before(id));
        SemanticSearchOffer {
            warning: off_by_default
                .is_none()
                .then(|| oversize_warning(pages))
                .flatten(),
            off_by_default: off_by_default.map(|off| off.to_string()),
        }
    }

    /// Deletes the files of offered model `id` from the model store, unless
    /// it is the model in use. Blocks while they are removed.
    pub fn remove_offered_model(&self, id: &str) -> Result<(), RemoveModelError> {
        let spec = catalog::resolve(id).map_err(|_| RemoveModelError::Unknown)?;
        if self.model().is_some_and(|active| active.id == spec.id) {
            return Err(RemoveModelError::InUse);
        }
        self.remove_model(spec)
            .map_err(|error| RemoveModelError::Io(spec.display_name, error))
    }
}

#[cfg(test)]
mod tests;
