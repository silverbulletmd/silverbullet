//! Full-text backend built on Tantivy (pure Rust): schema, analyzers and
//! language detection. One document per page, with raw (unstemmed) fields for
//! phrases and exact words and per-language stemmed fields for ranking.
//!
//! [`FullTextBackend`] ties it together: an [`IndexStore`] kept in step with
//! storage by a [`SyncWorker`], queried with the plans in [`query`] and
//! answered with the passages in [`passage`].

mod analysis;
pub mod passage;
pub mod query;
pub mod store;
pub mod sync;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use silverbullet_server_common::page::{parse_page, PageKind};
use tantivy::collector::TopDocs;
use tantivy::query::TermQuery;
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED, STRING,
};
use tantivy::{Searcher, TantivyDocument, Term};
use tokio::task::JoinHandle;

pub use analysis::{detect_lang, is_stopword, register_tokenizers, tokens, Lang};
pub use store::{IndexStore, Location};
pub use sync::{ChangeFeed, IndexStats, SyncState, SyncWorker};

use crate::backend::{BoxFut, FileStamp, SearchBackend, SpaceView};
use crate::limits;
use crate::{
    Capabilities, Match, Progress, QueryMode, QueryRequest, QueryResult, RequestCx, SearchError,
    StatusResponse,
};
use passage::{passages, Matcher};
use query::{PageFilter, Tier};

/// Name of the unstemmed analyzer (simple tokenizer + lowercase). Not "raw":
/// that is Tantivy's own whole-value tokenizer, which `STRING` fields such as
/// `path` and `lang` use, so registering over it would split paths into words.
pub const RAW_TOKENIZER: &str = "sb_raw";

pub struct Fields {
    pub path: Field,
    pub name_raw: Field,
    pub body_raw: Field,
    pub lang: Field,
    /// [`KIND_CONTENT`] or [`KIND_META`], by the page's tags.
    pub kind: Field,
    pub modified: Field,
    pub size: Field,
    pub name_stem: [(Lang, Field); 5],
    pub body_stem: [(Lang, Field); 5],
}

fn text_options(tokenizer: &str, record: IndexRecordOption) -> TextOptions {
    TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(tokenizer)
            .set_index_option(record),
    )
}

pub fn schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let path = b.add_text_field("path", STRING | STORED);
    let positions = IndexRecordOption::WithFreqsAndPositions;
    let name_raw = b.add_text_field("name_raw", text_options(RAW_TOKENIZER, positions));
    let body_raw = b.add_text_field("body_raw", text_options(RAW_TOKENIZER, positions));
    let lang = b.add_text_field("lang", STRING | STORED);
    let kind = b.add_text_field("kind", STRING);
    let modified = b.add_i64_field("modified", STORED | FAST);
    let size = b.add_u64_field("size", STORED | FAST);
    let mut stem = |prefix: &str| {
        Lang::ALL.map(|l| {
            let opts = text_options(
                &analysis::stem_tokenizer_name(l),
                IndexRecordOption::WithFreqs,
            );
            (l, b.add_text_field(&format!("{prefix}_{}", l.code()), opts))
        })
    };
    let name_stem = stem("name");
    let body_stem = stem("body");
    (
        b.build(),
        Fields {
            path,
            name_raw,
            body_raw,
            lang,
            kind,
            modified,
            size,
            name_stem,
            body_stem,
        },
    )
}

/// `kind` of a page tagged `meta`, `meta/…` or `template`.
pub const KIND_META: &str = "meta";
/// `kind` of every other page.
pub const KIND_CONTENT: &str = "content";

/// The `kind` value of a page with this text, by the classifier the server
/// shares with SEO and the bundle.
pub fn page_kind(text: &str) -> &'static str {
    match parse_page(text).metadata.kind() {
        PageKind::Meta => KIND_META,
        PageKind::Content => KIND_CONTENT,
    }
}

/// The document for one page. Its name is the path without `.md`; the body
/// goes into the raw field and into the stemmed field of its detected language.
pub fn document(fields: &Fields, path: &str, text: &str, stamp: FileStamp) -> TantivyDocument {
    let name = path.strip_suffix(".md").unwrap_or(path);
    let lang = detect_lang(text);
    let mut doc = TantivyDocument::default();
    doc.add_text(fields.path, path);
    doc.add_text(fields.name_raw, name);
    doc.add_text(fields.body_raw, text);
    doc.add_text(fields.lang, lang.code());
    doc.add_text(fields.kind, page_kind(text));
    doc.add_i64(fields.modified, stamp.modified);
    doc.add_u64(fields.size, stamp.size);
    if let Some((_, f)) = fields.name_stem.iter().find(|(l, _)| *l == lang) {
        doc.add_text(*f, name);
    }
    if let Some((_, f)) = fields.body_stem.iter().find(|(l, _)| *l == lang) {
        doc.add_text(*f, text);
    }
    doc
}

const ID: &str = "fulltext";
/// The modes queries support; the first is the default. Both are public.
const MODES: [QueryMode; 2] = [QueryMode::Words, QueryMode::Phrase];
const SLOW_NOTICE: &str = "Search took too long; results may be incomplete";
/// Status `reason` while storage can't list the space.
const UNLISTED_REASON: &str = "Can't list the space's files; the search index may be out of date";

/// Query notice while the index works but the worker can't commit changes.
const STALE_NOTICE: &str = "Search results may be out of date";
/// Status `reason` while the worker can't commit changes.
const FAILED_REASON: &str = "Search index can't be updated right now";

/// Query notice while the index builds. With nothing counted yet (the store
/// is opening, or a fresh start can't list the space) there is no progress to show.
fn building_notice(done: u64, total: u64) -> String {
    if total == 0 {
        "Search index is starting".to_string()
    } else {
        format!("Search index building: {done} of {total} pages")
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
            let open = |location| tokio::task::spawn_blocking(move || IndexStore::open(location));
            let store = match open(location).await {
                Ok(store) => store,
                Err(e) => {
                    tracing::warn!(
                        "Opening the full-text index failed ({e}); keeping it in memory"
                    );
                    match open(Location::Memory).await {
                        Ok(store) => store,
                        Err(e) => {
                            tracing::warn!("Can't create the full-text index ({e}); search is off");
                            return;
                        }
                    }
                }
            };
            let store = Arc::new(store);
            let pages = store.pages();
            tracing::info!("{}", sync::opened_line(&name, store.opened(), pages));
            let worker = SyncWorker::spawn(&name, store.clone(), worker_view, feed);
            let _ = slot.set(Running { store, worker });
        });
        FullTextBackend {
            view,
            running,
            startup,
        }
    }

    /// Whether the index ended up in RAM; `None` while the store is opening.
    pub fn is_memory(&self) -> Option<bool> {
        self.running.get().map(|running| running.store.is_memory())
    }

    /// What the last "index ready" log line reported; `None` until the first
    /// build finished.
    pub fn stats(&self) -> Option<IndexStats> {
        self.running
            .get()
            .and_then(|running| running.worker.stats())
    }

    async fn run_query(
        &self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> Result<QueryResult, SearchError> {
        let mode = req.mode.unwrap_or(MODES[0]);
        match mode {
            QueryMode::Words | QueryMode::Phrase => {}
            QueryMode::Natural => {
                return Err(SearchError::Invalid(
                    "Natural language search isn't supported".into(),
                ))
            }
        }
        query::validate(&req.query)?;
        let Some(running) = self.running.get() else {
            return Ok(QueryResult {
                partial: true,
                notice: Some(building_notice(0, 0)),
                ..QueryResult::default()
            });
        };
        let slot = cx.query_slot().await?;
        // Read after waiting for the slot, so the notice matches the index searched.
        let state = running.worker.state();
        let stop = Arc::new(AtomicBool::new(false));
        let acc = Arc::new(Mutex::new(Acc::default()));
        let job = Job {
            store: running.store.clone(),
            view: self.view.clone(),
            query: req.query,
            phrase: mode == QueryMode::Phrase,
            filter: PageFilter {
                scope: req.scope.unwrap_or_default(),
                include: req.include,
                exclude: req.exclude,
            },
            limit: req
                .limit
                .unwrap_or(limits::MAX_RESULTS)
                .min(limits::MAX_RESULTS),
            stop: stop.clone(),
            acc: acc.clone(),
        };
        // The slot goes with the work and is held until the work stops, also
        // after a cancel or the deadline. A storage read that hangs therefore
        // keeps its slot (eight such reads make every query `Busy` until they
        // return); releasing it early would let stuck blocking threads pile up
        // past `MAX_QUERIES`, and the slot is the only thing that bounds them.
        let mut task = tokio::task::spawn_blocking(move || {
            let _slot = slot;
            job.run()
        });
        let timed_out = tokio::select! {
            biased;
            _ = cx.cancel.cancelled() => {
                stop.store(true, Ordering::Relaxed);
                return Err(SearchError::Cancelled);
            }
            done = &mut task => match done {
                Ok(result) => {
                    result?;
                    false
                }
                Err(e) => {
                    tracing::warn!("full-text search failed (task): {e}");
                    return Err(SearchError::Failed(query::FAILED_MESSAGE.into()));
                }
            },
            _ = tokio::time::sleep_until(cx.deadline) => {
                stop.store(true, Ordering::Relaxed);
                true
            }
        };
        let acc = std::mem::take(&mut *acc.lock().unwrap_or_else(|e| e.into_inner()));
        let (partial, notice) = match state {
            SyncState::Building { done, total } => (true, Some(building_notice(done, total))),
            _ if timed_out => (true, Some(SLOW_NOTICE.to_string())),
            SyncState::Failed(_) => (false, Some(STALE_NOTICE.to_string())),
            SyncState::Ready => (false, None),
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

/// What a query has found so far; read when it finishes or at the deadline.
#[derive(Default)]
struct Acc {
    items: Vec<Match>,
    /// Matching pages, less those found unreadable.
    total: usize,
}

/// One query's blocking work: plan, search, then passages page by page,
/// stopping between pages once `stop` is set.
struct Job {
    store: Arc<IndexStore>,
    view: Arc<dyn SpaceView>,
    query: String,
    phrase: bool,
    filter: PageFilter,
    limit: usize,
    stop: Arc<AtomicBool>,
    acc: Arc<Mutex<Acc>>,
}

impl Job {
    fn acc(&self) -> std::sync::MutexGuard<'_, Acc> {
        self.acc.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    fn run(self) -> Result<(), SearchError> {
        let (index, fields) = (self.store.index(), self.store.fields());
        let plan = if self.phrase {
            query::phrase_plan(index, fields, &self.query, &self.filter)?
        } else {
            query::words_plan(index, fields, &self.query, &self.filter)?
        };
        let searcher = self.store.searcher();
        let (hits, total, tier) = query::run(&searcher, &plan, self.limit)?;
        self.acc().total = total;
        let matcher = Matcher::new(index, &plan.words, self.phrase, tier == Tier::Similar);
        for (path, _) in hits {
            if self.stopped() {
                break;
            }
            // Gone, hidden or changed beyond what is indexed since the last sync.
            let Some(text) = read_text(self.view.as_ref(), &path) else {
                let mut acc = self.acc();
                acc.total = acc.total.saturating_sub(1);
                continue;
            };
            let lang = stored_lang(&searcher, fields, &path);
            let page = path.strip_suffix(".md").unwrap_or(&path);
            // At most `passage::PASSAGES_PER_PAGE`, best first.
            let found = passages(page, &text, lang, &matcher);
            self.acc().items.extend(found);
        }
        Ok(())
    }
}

/// The page's text as storage serves it now, or `None` when it must not be
/// shown: hidden or gone, over [`limits::MAX_FILE_BYTES`] or not UTF-8.
fn read_text(view: &dyn SpaceView, path: &str) -> Option<String> {
    let data = view.read(path)?;
    if data.len() as u64 > limits::MAX_FILE_BYTES {
        return None;
    }
    String::from_utf8(data).ok()
}

/// The language `path` was indexed in.
fn stored_lang(searcher: &Searcher, f: &Fields, path: &str) -> Option<Lang> {
    let q = TermQuery::new(
        Term::from_field_text(f.path, path),
        IndexRecordOption::Basic,
    );
    let top = searcher
        .search(&q, &TopDocs::with_limit(1).order_by_score())
        .ok()?;
    let doc: TantivyDocument = searcher.doc(top.first()?.1).ok()?;
    Lang::from_code(doc.get_first(f.lang)?.as_str()?)
}

impl SearchBackend for FullTextBackend {
    /// Queries are cheap and bounded, so everyone who can read the space can search it.
    fn public_modes(&self) -> &[QueryMode] {
        &MODES
    }

    fn default_mode(&self) -> QueryMode {
        MODES[0]
    }

    fn status(&self) -> StatusResponse {
        let (ready, progress, reason) = match self.running.get() {
            None => (false, None, None),
            Some(running) => {
                let unlisted = running
                    .worker
                    .listing_failed()
                    .then(|| UNLISTED_REASON.to_string());
                match running.worker.state() {
                    SyncState::Ready => (true, None, unlisted),
                    SyncState::Building { done, total } => {
                        let progress = unlisted.is_none().then_some(Progress { done, total });
                        (false, progress, unlisted)
                    }
                    SyncState::Failed(_) => (false, None, Some(FAILED_REASON.to_string())),
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
mod backend_tests {
    use super::*;
    use crate::{Admission, FileStamp, Gate, SearchScope};
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicI64, AtomicUsize};
    use std::sync::Condvar;
    use std::time::Duration;
    use tokio::sync::mpsc;

    /// A space in memory. Reads can be blocked (they wait until released)
    /// and are counted; listing can be made to fail.
    #[derive(Default)]
    struct TestView {
        files: Mutex<HashMap<String, (String, i64)>>,
        clock: AtomicI64,
        blocked: Mutex<bool>,
        unblocked: Condvar,
        reads: AtomicUsize,
        /// Reads of `Pages/` block from this read on (counting from 1); 0 = never.
        block_from: AtomicUsize,
        unlistable: AtomicBool,
    }

    impl TestView {
        fn with(files: &[(&str, &str)]) -> Arc<TestView> {
            let view = Arc::new(TestView::default());
            for (path, body) in files {
                view.write(path, body);
            }
            view
        }

        fn write(&self, path: &str, body: &str) {
            let modified = self.clock.fetch_add(1, Ordering::Relaxed) + 1;
            let entry = (body.to_string(), modified);
            self.files.lock().unwrap().insert(path.into(), entry);
        }

        fn remove(&self, path: &str) {
            self.files.lock().unwrap().remove(path);
        }

        fn block(&self) {
            *self.blocked.lock().unwrap() = true;
        }

        fn release(&self) {
            self.block_from.store(0, Ordering::SeqCst);
            *self.blocked.lock().unwrap() = false;
            self.unblocked.notify_all();
        }

        fn reads(&self) -> usize {
            self.reads.load(Ordering::SeqCst)
        }

        /// Blocks reads until the guard is dropped, also when a test fails
        /// (a read left blocked would hang the runtime's shutdown).
        fn blocked(self: &Arc<Self>) -> Unblock {
            self.block();
            Unblock(self.clone())
        }
    }

    struct Unblock(Arc<TestView>);

    impl Drop for Unblock {
        fn drop(&mut self) {
            self.0.release();
        }
    }

    impl SpaceView for TestView {
        fn list(&self) -> HashSet<String> {
            self.list_meta().unwrap_or_default().into_keys().collect()
        }

        fn list_meta(&self) -> Option<HashMap<String, FileStamp>> {
            if self.unlistable.load(Ordering::Relaxed) {
                return None;
            }
            let files = self.files.lock().unwrap();
            let meta = files
                .iter()
                .map(|(path, (body, modified))| {
                    let stamp = FileStamp {
                        modified: *modified,
                        size: body.len() as u64,
                    };
                    (path.clone(), stamp)
                })
                .collect();
            Some(meta)
        }

        fn read_prefix(&self, path: &str, len: usize) -> Option<Vec<u8>> {
            let data = self.read(path)?;
            Some(data[..len.min(data.len())].to_vec())
        }

        fn read(&self, path: &str) -> Option<Vec<u8>> {
            let n = self.reads.fetch_add(1, Ordering::SeqCst) + 1;
            let from = self.block_from.load(Ordering::SeqCst);
            let held = from > 0 && n >= from && path.starts_with("Pages/");
            let mut blocked = self.blocked.lock().unwrap();
            while held && self.block_from.load(Ordering::SeqCst) > 0 {
                blocked = self.unblocked.wait(blocked).unwrap();
            }
            while *blocked {
                blocked = self.unblocked.wait(blocked).unwrap();
            }
            drop(blocked);
            let files = self.files.lock().unwrap();
            files.get(path).map(|(body, _)| body.as_bytes().to_vec())
        }
    }

    const GARDEN: &[(&str, &str)] = &[
        (
            "Garden/Herbs.md",
            "# Herbs\nThe basil grows well by the door.\nMint spreads fast.\nWater the basil daily.\nBasil likes sun.\nMore basil next year.\nDry basil for winter.",
        ),
        (
            "Kitchen/Pesto.md",
            "# Pesto\nBlend fresh basil pesto with pine nuts and garlic.",
        ),
        (
            "Ops/Deploy.md",
            "# Deploy\nRun deployctl rollback when the release breaks the build.",
        ),
    ];

    struct Fixture {
        backend: FullTextBackend,
        _feed: mpsc::UnboundedSender<Option<String>>,
    }

    fn start(view: Arc<TestView>) -> Fixture {
        let (feed, rx) = mpsc::unbounded_channel();
        Fixture {
            backend: FullTextBackend::new("test", Location::Memory, view, rx),
            _feed: feed,
        }
    }

    async fn until(what: &str, f: impl Fn() -> bool) {
        let started = std::time::Instant::now();
        while !f() {
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "timed out waiting for {what}"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    async fn ready(view: Arc<TestView>) -> Fixture {
        let fx = start(view);
        until("ready", || fx.backend.status().ready).await;
        fx
    }

    fn req(query: &str, mode: Option<QueryMode>) -> QueryRequest {
        QueryRequest {
            query: query.into(),
            mode,
            scope: None,
            include: None,
            exclude: None,
            limit: None,
        }
    }

    fn cx() -> RequestCx {
        RequestCx::unlimited(limits::DEADLINE)
    }

    async fn ask(fx: &Fixture, query: &str, mode: Option<QueryMode>) -> QueryResult {
        fx.backend.query(req(query, mode), cx()).await.unwrap()
    }

    fn pages(r: &QueryResult) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for m in &r.items {
            if out.last() != Some(&m.page.as_str()) {
                out.push(&m.page);
            }
        }
        out
    }

    fn marked(m: &Match) -> Vec<String> {
        let utf16: Vec<u16> = m.excerpt.encode_utf16().collect();
        m.highlights
            .iter()
            .map(|[a, b]| String::from_utf16(&utf16[*a as usize..*b as usize]).unwrap())
            .collect()
    }

    #[tokio::test]
    async fn status_before_and_after_the_build() {
        let fx = start(TestView::with(GARDEN));
        // Nothing has run yet on this single-threaded runtime: the store isn't open.
        let before = fx.backend.status();
        assert_eq!(before.backend.as_deref(), Some("fulltext"));
        assert_eq!(
            before.capabilities.modes,
            [QueryMode::Words, QueryMode::Phrase]
        );
        assert!(!before.capabilities.related);
        assert!(!before.ready);
        assert_eq!((before.progress, before.reason), (None, None));
        assert_eq!(
            fx.backend.public_modes(),
            [QueryMode::Words, QueryMode::Phrase]
        );
        assert_eq!(fx.backend.default_mode(), QueryMode::Words);
        let early = ask(&fx, "basil", None).await;
        assert!(early.partial && early.items.is_empty());
        assert_eq!(early.notice.as_deref(), Some("Search index is starting"));

        until("ready", || fx.backend.status().ready).await;
        let after = fx.backend.status();
        assert_eq!((after.progress, after.reason), (None, None));
        assert_eq!(after.capabilities.modes, before.capabilities.modes);
    }

    #[tokio::test]
    async fn words_and_phrase_queries_return_passages() {
        let fx = ready(TestView::with(GARDEN)).await;
        let r = ask(&fx, "basil", None).await;
        assert_eq!(r.total, 2);
        assert!(!r.partial && r.notice.is_none());
        let found = pages(&r);
        assert_eq!(found.len(), 2, "each page once, in score order: {found:?}");
        let herbs: Vec<&Match> = r
            .items
            .iter()
            .filter(|m| m.page == "Garden/Herbs")
            .collect();
        assert_eq!(
            herbs.len(),
            passage::PASSAGES_PER_PAGE,
            "six basil lines, three passages"
        );
        for m in &r.items {
            assert!(m.excerpt.to_lowercase().contains("basil"), "{m:?}");
            assert!(marked(m).iter().all(|h| h.eq_ignore_ascii_case("basil")));
        }
        let pesto = r.items.iter().find(|m| m.page == "Kitchen/Pesto").unwrap();
        assert_eq!((pesto.line, pesto.heading.as_deref()), (2, Some("Pesto")));

        let phrase = ask(&fx, "basil pesto", Some(QueryMode::Phrase)).await;
        assert_eq!(pages(&phrase), ["Kitchen/Pesto"]);
        assert_eq!(marked(&phrase.items[0]), ["basil pesto"]);

        let mut filtered = req("basil", None);
        filtered.exclude = Some(vec!["Garden/Herbs".into()]);
        let r = fx.backend.query(filtered, cx()).await.unwrap();
        assert_eq!((pages(&r), r.total), (vec!["Kitchen/Pesto"], 1));

        let mut limited = req("basil", None);
        limited.limit = Some(1);
        let r = fx.backend.query(limited, cx()).await.unwrap();
        assert_eq!((pages(&r).len(), r.total), (1, 2));
    }

    #[tokio::test]
    async fn the_similar_tier_answers_without_a_notice() {
        let fx = ready(TestView::with(GARDEN)).await;
        let r = ask(&fx, "rollbakc", None).await;
        assert_eq!(pages(&r), ["Ops/Deploy"]);
        assert_eq!(r.notice, None);
        assert!(!r.partial);
        assert_eq!(marked(&r.items[0]), ["rollback"]);
        assert!(ask(&fx, "rollbakc", Some(QueryMode::Phrase))
            .await
            .items
            .is_empty());
    }

    #[tokio::test]
    async fn scope_limits_queries_to_pages_or_meta_by_tags() {
        let fx = ready(TestView::with(&[
            ("Garden/Fern.md", "Ferns like shade.\n"),
            ("Config/Fern style.md", "#meta/config\nFern colours for the theme.\n"),
            (
                "Templates/Fern log.md",
                "---\ntags: template\n---\nFern log for the week.\n",
            ),
        ]))
        .await;
        let scoped = |q: &str, scope| {
            let mut r = req(q, None);
            r.scope = scope;
            r
        };
        let found = |r: QueryRequest| {
            let fut = fx.backend.query(r, cx());
            async move {
                let mut out: Vec<String> = pages(&fut.await.unwrap())
                    .into_iter()
                    .map(String::from)
                    .collect();
                out.sort();
                out
            }
        };
        let all = ["Config/Fern style", "Garden/Fern", "Templates/Fern log"];
        assert_eq!(found(scoped("fern", None)).await, all);
        assert_eq!(found(scoped("fern", Some(SearchScope::All))).await, all);
        assert_eq!(
            found(scoped("fern", Some(SearchScope::Pages))).await,
            ["Garden/Fern"]
        );
        assert_eq!(
            found(scoped("fern", Some(SearchScope::Meta))).await,
            ["Config/Fern style", "Templates/Fern log"]
        );
        // Phrase mode and the similar tier are scoped too.
        let mut phrase = scoped("fern log", Some(SearchScope::Pages));
        phrase.mode = Some(QueryMode::Phrase);
        assert!(found(phrase).await.is_empty());
        assert_eq!(
            found(scoped("fren", Some(SearchScope::Pages))).await,
            ["Garden/Fern"]
        );
        // Scope and the explicit lists intersect.
        let mut both = scoped("fern", Some(SearchScope::Meta));
        both.exclude = Some(vec!["Templates/Fern log".into()]);
        assert_eq!(found(both).await, ["Config/Fern style"]);
        let mut both = scoped("fern", Some(SearchScope::Pages));
        both.include = Some(vec!["Config/Fern style".into()]);
        assert!(found(both).await.is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn queries_while_building_are_partial_with_progress() {
        let view = TestView::with(GARDEN);
        let unblock = view.blocked();
        let fx = start(view.clone());
        until("the build to read", || view.reads() > 0).await;
        let status = fx.backend.status();
        assert!(!status.ready);
        assert_eq!(status.progress, Some(Progress { done: 0, total: 3 }));
        // The building notice applies to every tier.
        for query in ["basil", "rollbakc"] {
            let r = ask(&fx, query, None).await;
            assert!(r.partial);
            assert_eq!(
                r.notice.as_deref(),
                Some("Search index building: 0 of 3 pages")
            );
            assert!(r.items.is_empty());
        }

        drop(unblock);
        until("ready", || fx.backend.status().ready).await;
        let r = ask(&fx, "basil", None).await;
        assert!(!r.partial && r.notice.is_none());
        assert_eq!(r.total, 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn similar_results_while_building_carry_the_building_notice() {
        // A build of two batches, stopped after the first commit: the first
        // batch (sorted by path) holds the deploy page.
        let view = TestView::with(GARDEN);
        for i in 0..sync::BATCH_PAGES {
            view.write(&format!("Pages/{i:04}.md"), "moss on the stones");
        }
        view.block_from
            .store(sync::BATCH_PAGES + 1, Ordering::SeqCst);
        let _unblock = Unblock(view.clone());
        let fx = start(view.clone());
        let total = sync::BATCH_PAGES as u64 + 3;
        let first = Some(Progress {
            done: sync::BATCH_PAGES as u64,
            total,
        });
        until("the first batch", || fx.backend.status().progress == first).await;
        let r = ask(&fx, "rollbakc", None).await;
        assert_eq!(pages(&r), ["Ops/Deploy"], "the similar tier answered");
        assert!(r.partial);
        let notice = format!(
            "Search index building: {} of {total} pages",
            sync::BATCH_PAGES
        );
        assert_eq!(r.notice, Some(notice));
    }

    #[tokio::test]
    async fn passages_use_the_language_the_page_was_indexed_in() {
        let view = TestView::with(&[(
            "Moestuin/Oogst.md",
            "Wij oogsten de tomaten in de zomer en het is een goed jaar.",
        )]);
        let fx = ready(view.clone()).await;
        // Rewritten in English without an event: the index still has it as
        // Dutch, and "tomaten" stems like "tomaat" only under the Dutch stemmer.
        let english = "The tomaten are in the shed and they are not ready for the market.";
        view.write("Moestuin/Oogst.md", english);
        assert_eq!(detect_lang(english), Lang::En);
        let r = ask(&fx, "tomaat", None).await;
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].excerpt, english);
        assert_eq!(marked(&r.items[0]), ["tomaten"]);
    }

    #[tokio::test]
    async fn unsupported_modes_and_bad_queries_are_refused() {
        let fx = ready(TestView::with(GARDEN)).await;
        let err = |query: &str, mode| {
            let fut = fx.backend.query(req(query, mode), cx());
            async move { fut.await.unwrap_err() }
        };
        assert!(matches!(
            err("basil", Some(QueryMode::Natural)).await,
            SearchError::Invalid(_)
        ));
        assert_eq!(err("b", None).await, SearchError::QueryTooShort(2));
        let long = "x".repeat(limits::MAX_QUERY_BYTES + 1);
        assert!(matches!(err(&long, None).await, SearchError::Invalid(_)));
        let many: Vec<String> = (0..17).map(|i| format!("w{i}")).collect();
        assert!(matches!(
            err(&many.join(" "), None).await,
            SearchError::Invalid(_)
        ));
    }

    #[tokio::test]
    async fn a_page_that_became_unreadable_is_dropped_from_the_result() {
        let view = TestView::with(GARDEN);
        let fx = ready(view.clone()).await;
        // Gone from storage, still in the index (no event, no reconcile yet).
        view.remove("Kitchen/Pesto.md");
        let r = ask(&fx, "basil", None).await;
        assert_eq!((pages(&r), r.total), (vec!["Garden/Herbs"], 1));
    }

    fn admission() -> Admission<'static> {
        Admission {
            space: "/spaces/garden",
            user: Some("sam"),
            writer: true,
            tab: "",
            supersede: false,
            deadline: limits::DEADLINE,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn the_ninth_concurrent_query_is_busy_after_a_second() {
        let view = TestView::with(GARDEN);
        let fx = Arc::new(ready(view.clone()).await);
        let gate = Gate::new();
        let reads = view.reads();
        let unblock = view.blocked();
        let mut running = Vec::new();
        for _ in 0..limits::MAX_QUERIES {
            let cx = gate.admit(admission()).unwrap();
            let fx = fx.clone();
            running.push(tokio::spawn(async move {
                fx.backend.query(req("deployctl", None), cx).await
            }));
        }
        until("every query to read", || {
            view.reads() >= reads + limits::MAX_QUERIES
        })
        .await;

        let started = tokio::time::Instant::now();
        let ninth = fx
            .backend
            .query(req("deployctl", None), gate.admit(admission()).unwrap())
            .await;
        assert_eq!(ninth.unwrap_err(), SearchError::Busy);
        let waited = started.elapsed();
        assert!(
            waited >= Duration::from_millis(950) && waited < Duration::from_secs(3),
            "{waited:?}"
        );

        drop(unblock);
        for task in running {
            let r = task.await.unwrap().unwrap();
            assert_eq!(pages(&r), ["Ops/Deploy"]);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_cancelled_query_stops_with_cancelled() {
        let view = TestView::with(GARDEN);
        let fx = Arc::new(ready(view.clone()).await);
        let reads = view.reads();
        let _unblock = view.blocked();
        let cx = cx();
        let cancel = cx.cancel.clone();
        let task = {
            let fx = fx.clone();
            tokio::spawn(async move { fx.backend.query(req("basil", None), cx).await })
        };
        until("the query to read", || view.reads() > reads).await;
        cancel.cancel();
        let r = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("cancellation returns promptly")
            .unwrap();
        assert_eq!(r.unwrap_err(), SearchError::Cancelled);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn past_the_deadline_the_result_is_partial() {
        let view = TestView::with(GARDEN);
        let fx = ready(view.clone()).await;
        let _unblock = view.blocked();
        let cx = RequestCx::unlimited(Duration::from_millis(200));
        let r = tokio::time::timeout(
            Duration::from_secs(5),
            fx.backend.query(req("basil", None), cx),
        )
        .await
        .expect("the deadline returns promptly")
        .unwrap();
        assert!(r.partial);
        assert_eq!(
            r.notice.as_deref(),
            Some("Search took too long; results may be incomplete")
        );
        assert!(r.items.is_empty());
        assert_eq!(r.total, 2, "matching pages not yet read still count");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_failing_listing_shows_in_status() {
        let view = TestView::with(GARDEN);
        view.unlistable.store(true, Ordering::Relaxed);
        let fx = start(view);
        until("the listing failure", || {
            fx.backend.status().reason.is_some()
        })
        .await;
        let status = fx.backend.status();
        assert!(
            !status.ready,
            "a fresh index that can't list never claims ready"
        );
        assert_eq!(status.progress, None);
        assert_eq!(status.reason.as_deref(), Some(UNLISTED_REASON));
        let r = ask(&fx, "basil", None).await;
        assert!(r.partial);
        assert_eq!(r.notice.as_deref(), Some("Search index is starting"));
    }

    #[tokio::test(start_paused = true)]
    async fn a_worker_that_cant_commit_marks_results_out_of_date() {
        let tmp = tempfile::tempdir().unwrap();
        let view = TestView::with(GARDEN);
        let (feed, rx) = mpsc::unbounded_channel();
        let backend =
            FullTextBackend::new("test", Location::Disk(tmp.path().into()), view.clone(), rx);
        until("ready", || backend.status().ready).await;

        // Another store holds the writer past the worker's retries.
        let other = IndexStore::open(Location::Disk(tmp.path().into()));
        assert!(!other.is_memory());
        let writer: tantivy::IndexWriter = other
            .index()
            .writer_with_num_threads(1, 15_000_000)
            .unwrap();
        view.write("Kitchen/Pesto.md", "# Pesto\nNo basil this year.");
        feed.send(Some("Kitchen/Pesto.md".into())).unwrap();
        until("failed", || backend.status().reason.is_some()).await;
        let status = backend.status();
        assert!(!status.ready);
        assert_eq!(
            status.reason.as_deref(),
            Some("Search index can't be updated right now")
        );
        let r = backend.query(req("basil", None), cx()).await.unwrap();
        assert!(!r.partial);
        assert_eq!(r.total, 2, "the index still answers");
        assert_eq!(
            r.notice.as_deref(),
            Some("Search results may be out of date")
        );
        drop(writer);
    }

    #[test]
    fn a_failed_search_names_no_file() {
        // The server's handler turns a SearchError into its HTTP body with
        // `code()` and `to_string()` (pinned there in Task 8).
        let leaked: SearchError = store::StoreError::Failed(
            "open writer: /data/search/indexes/x/fulltext-v1/meta.json".into(),
        )
        .into();
        for e in [leaked, SearchError::Failed(query::FAILED_MESSAGE.into())] {
            assert_eq!(e.code(), "failed");
            assert_eq!(e.to_string(), "Search failed: try again in a moment");
            assert!(!e.to_string().contains('/'));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tantivy::collector::TopDocs;
    use tantivy::query::AllQuery;
    use tantivy::schema::Value;
    use tantivy::{Index, IndexWriter};

    #[test]
    fn schema_round_trip() {
        let (schema, f) = schema();
        let index = Index::create_in_ram(schema);
        register_tokenizers(&index);
        let mut w: IndexWriter = index.writer_with_num_threads(1, 15_000_000).unwrap();
        let stamp = FileStamp {
            modified: 1_700_000_000_123,
            size: 42,
        };
        w.add_document(document(
            &f,
            "Notes/Garden.md",
            "The tomatoes are red",
            stamp,
        ))
        .unwrap();
        w.commit().unwrap();
        let searcher = index.reader().unwrap().searcher();
        let hits = searcher
            .search(&AllQuery, &TopDocs::with_limit(5).order_by_score())
            .unwrap();
        assert_eq!(hits.len(), 1);
        let doc: TantivyDocument = searcher.doc(hits[0].1).unwrap();
        assert_eq!(
            doc.get_first(f.path).unwrap().as_str(),
            Some("Notes/Garden.md")
        );
        assert_eq!(
            doc.get_first(f.modified).unwrap().as_i64(),
            Some(1_700_000_000_123)
        );
        assert_eq!(doc.get_first(f.size).unwrap().as_u64(), Some(42));
        let lang = doc.get_first(f.lang).unwrap().as_str().unwrap();
        assert_eq!(Lang::from_code(lang), Some(Lang::En));
    }

    #[test]
    fn document_name_drops_extension() {
        let (_, f) = schema();
        let stamp = FileStamp {
            modified: 0,
            size: 0,
        };
        let doc = document(&f, "Notes/Garden.md", "x", stamp);
        assert_eq!(
            doc.get_first(f.name_raw).unwrap().as_str(),
            Some("Notes/Garden")
        );
        let kind = |text: &str| {
            let doc = document(&f, "Notes/Garden.md", text, stamp);
            doc.get_first(f.kind).unwrap().as_str().unwrap().to_string()
        };
        assert_eq!(kind("x"), KIND_CONTENT);
        assert_eq!(kind("#meta/config\n"), KIND_META);
        assert_eq!(kind("---\ntags: template\n---\nWeekly"), KIND_META);
        assert_eq!(kind("Body with #meta inline"), KIND_CONTENT);
    }
}
