//! [`FullTextBackend`]: an [`IndexStore`] kept in step with storage by a
//! [`SyncWorker`], queried with the plans in `query` and answered with the
//! passages in `passage`.

use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

use tokio::task::JoinHandle;

use super::passage::{passages, Matcher};
use super::query::{self, Hit, Outcome, Tier, ValidQuery};
use super::store::IndexStore;
use super::words::QueryWords;
use crate::backend::{BoxFut, SearchBackend, SpaceView};
use crate::index::page_text;
use crate::job::{self, run_blocking, Acc, Finished, JobCx, SLOW_NOTICE, STARTING};
use crate::limits;
use crate::stats::{opened_line, IndexStats};
use crate::sync::SyncWorker;
use crate::{
    Capabilities, IndexKind, IndexReport, IndexState, Match, PageFilter, QueryMode, QueryRequest,
    QueryResult, RequestCx, SearchError, StatusResponse,
};
use crate::{ChangeFeed, Location};

const ID: &str = "fulltext";
/// The modes queries support; the first is the default. Both are public.
const MODES: [QueryMode; 2] = [QueryMode::Words, QueryMode::Phrase];
/// Status `reason` while storage can't list the space.
const UNLISTED_REASON: &str = "Can't list the space's files; the search index may be out of date";

/// Query notice while the index works but the worker can't commit changes.
const STALE_NOTICE: &str = "Search results may be out of date";
/// Status `reason` while the worker can't commit changes.
const FAILED_REASON: &str = "Search index can't be updated right now";

/// What [`FullTextBackend::rank`] found: pages best first, and what
/// [`FullTextBackend::passages`] needs to highlight them.
pub struct Ranking {
    hits: Vec<Hit>,
    words: QueryWords,
    total: usize,
    /// `Similar` when no page has every word; the passages highlight as it does.
    tier: Tier,
}

impl Ranking {
    /// Page paths (with `.md`), best first.
    pub fn paths(&self) -> impl Iterator<Item = &str> {
        self.hits.iter().map(|h| h.path.as_str())
    }

    pub fn contains(&self, path: &str) -> bool {
        self.hits.iter().any(|h| h.path == path)
    }

    /// Matching pages before the `k` cut.
    pub fn total(&self) -> usize {
        self.total
    }

    /// The similar tier answered: no page has every word.
    pub fn is_similar(&self) -> bool {
        self.tier == Tier::Similar
    }
}

/// The store and its worker, once the store is open.
struct Running {
    store: Arc<IndexStore>,
    worker: SyncWorker,
}

/// The full-text index backend for one space: Words and Phrase queries,
/// open to public visitors, answered from the index (also while it builds,
/// then partial with a notice).
pub struct FullTextBackend {
    view: Arc<dyn SpaceView>,
    running: Arc<OnceLock<Running>>,
    startup: JoinHandle<()>,
}

impl FullTextBackend {
    /// Opens the store (in `spawn_blocking`, it can take seconds) and then
    /// spawns the [`SyncWorker`] on the current tokio runtime. Returns at
    /// once; until the store is open, status is not ready and queries get an
    /// empty partial result. `name` identifies the space in log lines (its
    /// id, or its folder's name when it has none worth showing).
    pub fn new(name: &str, location: Location, view: Arc<dyn SpaceView>, feed: ChangeFeed) -> Self {
        let name = name.to_string();
        let running = Arc::new(OnceLock::new());
        let (slot, worker_view) = (running.clone(), view.clone());
        let startup = tokio::spawn(async move {
            // `IndexStore::open` handles every failure itself (retries, RAM
            // fallback, caught panics); only a panic outside that leaves no store.
            let store = match tokio::task::spawn_blocking(move || IndexStore::open(location)).await
            {
                Ok(store) => store,
                Err(e) => {
                    tracing::warn!("Can't open the full-text index ({e}); search is off");
                    return;
                }
            };
            let store = Arc::new(store);
            let pages = store.pages();
            tracing::info!("{}", opened_line(&name, store.opened(), pages));
            let worker = SyncWorker::spawn(&name, store.clone(), worker_view, feed);
            let _ = slot.set(Running { store, worker });
        });
        FullTextBackend {
            view,
            running,
            startup,
        }
    }

    /// A backend whose store never opens: `rank` and `admitted` stay
    /// `Unavailable`, and queries get the "starting" partial result.
    #[cfg(test)]
    pub(crate) fn unopened(view: Arc<dyn SpaceView>) -> Self {
        FullTextBackend {
            view,
            running: Arc::new(OnceLock::new()),
            startup: tokio::spawn(async {}),
        }
    }

    /// What the last "index ready" log line reported; `None` until the first
    /// build finished.
    pub fn stats(&self) -> Option<IndexStats> {
        self.running
            .get()
            .and_then(|running| running.worker.status().stats)
    }

    /// This index's state, pages and size, for the dashboard.
    pub fn report(&self) -> IndexReport {
        match self.running.get() {
            Some(running) => running.worker.report(),
            None => IndexReport::starting(IndexKind::FullText),
        }
    }

    /// Re-reads every page into the index, replacing each page's document in
    /// place: queries keep answering from the old documents meanwhile (the
    /// state is `Building`, as for any large reconcile). Does nothing while a
    /// rebuild runs; `Unavailable` until the store is open.
    pub fn rebuild(&self) -> Result<(), SearchError> {
        let running = self
            .running
            .get()
            .ok_or_else(|| SearchError::Unavailable(STARTING.into()))?;
        running.worker.rebuild();
        Ok(())
    }

    fn store(&self) -> Result<&Arc<IndexStore>, SearchError> {
        self.running
            .get()
            .map(|running| &running.store)
            .ok_or_else(|| SearchError::Unavailable(STARTING.into()))
    }

    /// The pages Words mode finds for `query`, ranked as Words mode ranks
    /// them: the exact tier (every word, as a stem, literally or with accents
    /// folded, exact accents first) and, when it finds nothing, the
    /// similar-pages tier (any word, fuzzy). Best first, at most `k` (clamped
    /// to `MAX_RESULTS`), limited by `filter`. Validated like a Words query.
    /// Blocking: callers run it in `spawn_blocking`.
    pub fn rank(&self, query: &str, filter: &PageFilter, k: usize) -> Result<Ranking, SearchError> {
        let valid = query::validate(QueryMode::Words, query)?;
        let store = self.store()?;
        let (index, fields) = (store.index(), store.fields());
        let plan = query::plan(index, fields, &valid, filter)?;
        let k = k.min(limits::MAX_RESULTS);
        let Outcome { hits, total, tier } = query::run(&store.searcher(), fields, &plan, k)?;
        Ok(Ranking {
            hits,
            words: plan.words,
            total,
            tier,
        })
    }

    /// Every indexed page `filter` admits, or `None` when it admits every
    /// page. Blocking.
    pub fn admitted(&self, filter: &PageFilter) -> Result<Option<HashSet<String>>, SearchError> {
        if filter.is_unrestricted() {
            return Ok(None);
        }
        let store = self.store()?;
        query::admitted(&store.searcher(), store.fields(), filter).map(Some)
    }

    /// Up to `passage::PASSAGES_PER_PAGE` passages of the ranked page `path`,
    /// highlighted as Words mode highlights them; none when `path` isn't in
    /// `ranking` or can't be read now. Blocking.
    pub fn passages(&self, ranking: &Ranking, path: &str) -> Vec<Match> {
        let Ok(store) = self.store() else {
            return Vec::new();
        };
        let Some(hit) = ranking.hits.iter().find(|h| h.path == path) else {
            return Vec::new();
        };
        let Ok(text) = page_text(self.view.as_ref(), path, None) else {
            return Vec::new();
        };
        let matcher = Matcher::new(store.index(), &ranking.words, ranking.tier);
        passages(
            path.strip_suffix(".md").unwrap_or(path),
            &text,
            hit.lang,
            &matcher,
        )
    }

    async fn run_query(
        &self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> Result<QueryResult, SearchError> {
        // Before the store is open, too: a bad query always gets its error.
        let query = query::validate(req.mode.unwrap_or(MODES[0]), &req.query)?;
        let Some(running) = self.running.get() else {
            return Ok(QueryResult {
                partial: true,
                notice: job::notice(&IndexState::Starting),
                ..QueryResult::default()
            });
        };
        let slot = cx.query_slot().await?;
        // Read after waiting for the slot, so the notice matches the index searched.
        let state = running.worker.status().state();
        let job = Job {
            store: running.store.clone(),
            view: self.view.clone(),
            filter: req.filter(),
            limit: req.limit(),
            query,
        };
        let Finished { acc, timed_out } =
            run_blocking(&cx, slot, "full-text search", move |work| job.run(work)).await?;
        let (partial, notice) = match job::notice(&state) {
            Some(building) => (true, Some(building)),
            None if timed_out => (true, Some(SLOW_NOTICE.to_string())),
            None if matches!(state, IndexState::Failed { .. }) => {
                (false, Some(STALE_NOTICE.to_string()))
            }
            None => (false, None),
        };
        Ok(QueryResult {
            items: acc.items,
            total: acc.total,
            partial,
            notice,
        })
    }
}

impl Drop for FullTextBackend {
    /// Stops a startup still opening the store; the worker stops when the
    /// last reference to it goes.
    fn drop(&mut self) {
        self.startup.abort();
    }
}

/// One query's blocking work: plan, search, then passages page by page,
/// stopping between pages once the query is stopped.
struct Job {
    store: Arc<IndexStore>,
    view: Arc<dyn SpaceView>,
    query: ValidQuery,
    filter: PageFilter,
    limit: usize,
}

impl Job {
    fn run(self, work: &JobCx<Acc>) -> Result<(), SearchError> {
        let (index, fields) = (self.store.index(), self.store.fields());
        let plan = query::plan(index, fields, &self.query, &self.filter)?;
        let searcher = self.store.searcher();
        let Outcome { hits, total, tier } = query::run(&searcher, fields, &plan, self.limit)?;
        work.acc().total = total;
        let matcher = Matcher::new(index, &plan.words, tier);
        for Hit { path, lang } in hits {
            if work.stopped() {
                break;
            }
            // Gone, hidden or changed beyond what is indexed since the last sync.
            let Ok(text) = page_text(self.view.as_ref(), &path, None) else {
                let mut acc = work.acc();
                acc.total = acc.total.saturating_sub(1);
                continue;
            };
            let page = path.strip_suffix(".md").unwrap_or(&path);
            // At most `passage::PASSAGES_PER_PAGE`, best first.
            let found = passages(page, &text, lang, &matcher);
            work.acc().items.extend(found);
        }
        Ok(())
    }
}

impl SearchBackend for FullTextBackend {
    /// Queries are cheap and bounded, so everyone who can read the space can search it.
    fn public_modes(&self) -> &[QueryMode] {
        &MODES
    }

    fn default_mode(&self) -> QueryMode {
        MODES[0]
    }

    fn pages(&self) -> Option<u64> {
        let running = self.running.get()?;
        let status = running.worker.status();
        if status.listing_failed {
            return None;
        }
        let counted = running.store.pages();
        match status.state() {
            IndexState::Ready { .. } => Some(counted),
            // Not listed yet: no count.
            IndexState::Building { total: 0, .. } | IndexState::Waiting { total: 0 }
                if counted == 0 =>
            {
                None
            }
            IndexState::Building { total, .. } | IndexState::Waiting { total } => {
                Some(counted.max(total))
            }
            IndexState::Starting | IndexState::Downloading { .. } | IndexState::Failed { .. } => {
                None
            }
        }
    }

    fn indexes(&self) -> Vec<IndexReport> {
        vec![self.report()]
    }

    fn rebuild(&self) -> Result<(), SearchError> {
        FullTextBackend::rebuild(self)
    }

    fn status(&self) -> StatusResponse {
        let (ready, progress, reason) = match self.running.get() {
            None => (false, None, None),
            Some(running) => {
                let status = running.worker.status();
                let state = status.state();
                let unlisted = status.listing_failed.then(|| UNLISTED_REASON.to_string());
                match state {
                    IndexState::Failed { .. } => (false, None, Some(FAILED_REASON.to_string())),
                    // No progress while the listing fails: it can't be counted.
                    _ => {
                        let progress = state.progress().filter(|_| unlisted.is_none());
                        (state.is_ready(), progress, unlisted)
                    }
                }
            }
        };
        StatusResponse {
            backend: Some(ID.to_string()),
            model: None,
            capabilities: Capabilities {
                modes: MODES.to_vec(),
                related: false,
            },
            ready,
            progress,
            reason,
        }
    }

    fn query<'a>(
        &'a self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        Box::pin(self.run_query(req, cx))
    }
}

#[cfg(test)]
mod tests;
