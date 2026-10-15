use super::*;
use crate::fulltext::analysis::{detect_lang, Lang};
use crate::fulltext::store;
use crate::job;
use crate::test_support::{TestView, Unblock};
use crate::FeedEvent;
use crate::{Admission, Gate, IndexState, Progress, SearchScope};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::mpsc;

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
    _feed: mpsc::UnboundedSender<FeedEvent>,
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
        crate::fulltext::passage::PASSAGES_PER_PAGE,
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
        (
            "Config/Fern style.md",
            "#meta/config\nFern colours for the theme.\n",
        ),
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
    until("the build to read", || view.total_reads() > 0).await;
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
    for i in 0..store::BATCH_PAGES {
        view.write(&format!("Pages/{i:04}.md"), "moss on the stones");
    }
    view.block_from
        .store(store::BATCH_PAGES + 1, Ordering::SeqCst);
    let _unblock = Unblock(view.clone());
    let fx = start(view.clone());
    let total = store::BATCH_PAGES as u64 + 3;
    let first = Some(Progress {
        done: store::BATCH_PAGES as u64,
        total,
    });
    until("the first batch", || fx.backend.status().progress == first).await;
    let r = ask(&fx, "rollbakc", None).await;
    assert_eq!(pages(&r), ["Ops/Deploy"], "the similar tier answered");
    assert!(r.partial);
    let notice = format!(
        "Search index building: {} of {total} pages",
        store::BATCH_PAGES
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
    let reads = view.total_reads();
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
        view.total_reads() >= reads + limits::MAX_QUERIES
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
    let reads = view.total_reads();
    let _unblock = view.blocked();
    let cx = cx();
    let cancel = cx.cancel.clone();
    let task = {
        let fx = fx.clone();
        tokio::spawn(async move { fx.backend.query(req("basil", None), cx).await })
    };
    until("the query to read", || view.total_reads() > reads).await;
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
    let backend = FullTextBackend::new("test", Location::Disk(tmp.path().into()), view.clone(), rx);
    until("ready", || backend.status().ready).await;

    // Another store holds the writer past the worker's retries.
    let other = IndexStore::open(Location::Disk(tmp.path().into()));
    assert!(!other.is_memory());
    let writer: tantivy::IndexWriter = other
        .index()
        .writer_with_num_threads(1, 15_000_000)
        .unwrap();
    view.write("Kitchen/Pesto.md", "# Pesto\nNo basil this year.");
    feed.send(FeedEvent::Changed("Kitchen/Pesto.md".into()))
        .unwrap();
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
    for e in [leaked, SearchError::Failed(job::FAILED_MESSAGE.into())] {
        assert_eq!(e.code(), "failed");
        assert_eq!(e.to_string(), "Search failed: try again in a moment");
        assert!(!e.to_string().contains('/'));
    }
}

/// F1: the highlighter fuzzes exactly the parts the similar tier's query
/// fuzzes. The first word fuzzes its 10 parts; the second word may fuzz only
/// 6 more before `MAX_FUZZY_PARTS`, so its later parts, "quartz" among them,
/// must match exactly. The page matched through the first word alone, and
/// "quarts" (one edit from "quartz") is no highlight.
#[tokio::test]
async fn highlights_fuzz_the_same_parts_as_the_similar_query() {
    let first = "amber-birch-cedar-delta-ember-fjord-grove-heron-iris-juniper";
    let second = format!("{first}-kestrel-lilac-maple-nettle-orchid-quartz");
    let fx = ready(TestView::with(&[(
        "Notes/Trees.md",
        "amber birch cedar delta ember fjord grove heron iris juniper quarts",
    )]))
    .await;
    let r = ask(&fx, &format!("{first} {second}"), None).await;
    assert_eq!(pages(&r), ["Notes/Trees"]);
    assert_eq!(
        marked(&r.items[0]),
        ["amber birch cedar delta ember fjord grove heron iris juniper"]
    );
}

/// Review Focus 1: validation doesn't wait for the store.
#[tokio::test]
async fn queries_are_validated_before_the_store_opens() {
    let fx = start(TestView::with(GARDEN));
    // Nothing has run yet on this single-threaded runtime: the store isn't open.
    assert!(!fx.backend.status().ready);
    let err = |query: &str, mode| {
        let fut = fx.backend.query(req(query, mode), cx());
        async move { fut.await.unwrap_err() }
    };
    assert_eq!(err("b", None).await, SearchError::QueryTooShort(2));
    let long = "x".repeat(limits::MAX_QUERY_BYTES + 1);
    assert!(matches!(err(&long, None).await, SearchError::Invalid(_)));
    // The mode is checked first, whatever the text.
    assert!(matches!(
        err("b", Some(QueryMode::Natural)).await,
        SearchError::Invalid(_)
    ));
    let r = ask(&fx, "basil", None).await;
    assert!(r.partial);
    assert_eq!(r.notice.as_deref(), Some("Search index is starting"));
}

/// Review Focus 2: one clamp, in `run_query`.
#[tokio::test]
async fn the_limit_is_clamped_once_and_zero_counts_without_items() {
    let files: Vec<(String, &str)> = (0..60)
        .map(|i| (format!("Log/Entry {i}.md"), "Picked courgettes today."))
        .collect();
    let files: Vec<(&str, &str)> = files.iter().map(|(p, b)| (p.as_str(), *b)).collect();
    let fx = ready(TestView::with(&files)).await;
    let with_limit = |limit: usize| {
        let mut r = req("courgettes", None);
        r.limit = Some(limit);
        fx.backend.query(r, cx())
    };
    let r = with_limit(usize::MAX).await.unwrap();
    assert_eq!((pages(&r).len(), r.total), (limits::MAX_RESULTS, 60));
    let r = with_limit(0).await.unwrap();
    assert_eq!((r.items.len(), r.total), (0, 60));
}

use crate::PageFilter;
use std::collections::HashSet;

fn set(paths: &[&str]) -> HashSet<String> {
    paths.iter().map(|p| p.to_string()).collect()
}

#[tokio::test]
async fn rank_ranks_as_words_mode_does_with_its_similar_fallback() {
    let fx = ready(TestView::with(GARDEN)).await;
    let all = PageFilter::default();
    let ranking = fx.backend.rank("basil", &all, 10).unwrap();
    let ranked: Vec<&str> = ranking
        .paths()
        .map(|p| p.strip_suffix(".md").unwrap())
        .collect();
    let words = ask(&fx, "basil", Some(QueryMode::Words)).await;
    assert_eq!(
        ranked,
        pages(&words),
        "same pages in the same order as Words mode"
    );
    assert_eq!(ranking.total(), 2);
    assert!(ranking.contains("Kitchen/Pesto.md"));
    assert_eq!(
        fx.backend.rank("basil", &all, 1).unwrap().paths().count(),
        1
    );
    // No page has the word: rank falls back to similar pages, as Words does.
    assert_eq!(
        pages(&ask(&fx, "rollbakc", Some(QueryMode::Words)).await),
        ["Ops/Deploy"]
    );
    assert_eq!(
        fx.backend
            .rank("rollbakc", &all, 10)
            .unwrap()
            .paths()
            .collect::<Vec<_>>(),
        ["Ops/Deploy.md"]
    );
    assert_eq!(
        fx.backend.rank("b", &all, 10).err(),
        Some(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS))
    );
}

#[tokio::test]
async fn ranked_passages_are_the_ones_words_mode_returns() {
    let fx = ready(TestView::with(GARDEN)).await;
    let ranking = fx
        .backend
        .rank("basil pesto", &PageFilter::default(), 10)
        .unwrap();
    assert_eq!(ranking.paths().collect::<Vec<_>>(), ["Kitchen/Pesto.md"]);
    let words = ask(&fx, "basil pesto", Some(QueryMode::Words)).await;
    assert_eq!(
        fx.backend.passages(&ranking, "Kitchen/Pesto.md"),
        words.items
    );
    assert!(
        fx.backend.passages(&ranking, "Garden/Herbs.md").is_empty(),
        "not in the ranking"
    );
    // Similar pages are highlighted as Words mode highlights them.
    let similar = fx
        .backend
        .rank("rollbakc", &PageFilter::default(), 10)
        .unwrap();
    let words = ask(&fx, "rollbakc", Some(QueryMode::Words)).await;
    let passages = fx.backend.passages(&similar, "Ops/Deploy.md");
    assert!(!passages.is_empty() && !passages[0].highlights.is_empty());
    assert_eq!(passages, words.items);
}

#[tokio::test]
async fn admitted_applies_scope_include_and_exclude() {
    let view = TestView::with(GARDEN);
    view.write("Meta/Config.md", "#meta\nsettings for the garden");
    let fx = ready(view).await;
    assert_eq!(fx.backend.admitted(&PageFilter::default()).unwrap(), None);
    let meta = PageFilter {
        scope: SearchScope::Meta,
        ..PageFilter::default()
    };
    assert_eq!(
        fx.backend.admitted(&meta).unwrap(),
        Some(set(&["Meta/Config.md"]))
    );
    let pages_but_deploy = PageFilter {
        scope: SearchScope::Pages,
        exclude: Some(vec!["Ops/Deploy".into()]),
        ..PageFilter::default()
    };
    assert_eq!(
        fx.backend.admitted(&pages_but_deploy).unwrap(),
        Some(set(&["Garden/Herbs.md", "Kitchen/Pesto.md"]))
    );
    let only = PageFilter {
        include: Some(vec!["Kitchen/Pesto".into()]),
        ..PageFilter::default()
    };
    assert_eq!(
        fx.backend.admitted(&only).unwrap(),
        Some(set(&["Kitchen/Pesto.md"]))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuild_keeps_answering_with_the_old_index() {
    let view = TestView::with(GARDEN);
    let fx = ready(view.clone()).await;
    let reads = view.total_reads();
    let unblock = view.blocked();
    fx.backend.rebuild().unwrap();
    until("the rebuild to read", || view.total_reads() > reads).await;
    let report = fx.backend.report();
    assert_eq!(report.state, IndexState::Building { done: 0, total: 3 });
    // Documents are replaced one by one, never dropped first (ranked
    // without reading pages, which are blocked).
    let ranking = fx
        .backend
        .rank("basil", &PageFilter::default(), 10)
        .unwrap();
    assert_eq!(ranking.total(), 2);
    assert_eq!(
        fx.backend.status().progress,
        Some(Progress { done: 0, total: 3 })
    );

    drop(unblock);
    until("ready", || fx.backend.status().ready).await;
    assert_eq!(view.total_reads(), reads + 3, "every page re-read once");
    let report = fx.backend.report();
    assert_eq!(report.kind, IndexKind::FullText);
    assert_eq!(report.state, IndexState::Ready { catch_up: None });
    assert_eq!(report.pages, Some(3));
    assert!(report.memory);
    assert!(report.build_secs.is_some());
    assert_eq!(fx.backend.indexes(), [report]);
    assert_eq!(
        pages(&ask(&fx, "basil", None).await),
        ["Garden/Herbs", "Kitchen/Pesto"]
    );
}

#[tokio::test]
async fn a_rebuild_before_the_store_opens_is_unavailable() {
    let backend = FullTextBackend::unopened(Arc::new(TestView::default()));
    assert!(matches!(
        backend.rebuild(),
        Err(SearchError::Unavailable(_))
    ));
    assert_eq!(backend.report(), IndexReport::starting(IndexKind::FullText));
}
