use super::*;
use crate::semantic::catalog::Thresholds;
use crate::semantic::eval::{rank_natural, Fusion, ScoredPages};
use crate::semantic::service::SemanticService;
use crate::semantic::test_model::{fake_spec, FakeEmbedder};
use crate::test_support::TestView;
use crate::{FeedEvent, IndexKind, IndexState, Location, Progress, SearchScope};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const PAGES: &[(&str, &str)] = &[
    (
        "Bike/Puncture.md",
        "# Puncture\nPatch the tube of a flat tyre.",
    ),
    ("Bike/Chain.md", "# Chain\nOil the chain after rain."),
    ("Kitchen/Coffee.md", "# Coffee\nGrind the beans fresh."),
    (
        "Meta/Ride Template.md",
        "#template\n# Ride log\nDistance and weather.",
    ),
];

struct Fixture {
    backend: SemanticBackend,
    fake: Arc<FakeEmbedder>,
    /// What the semantic worker reads.
    sem_view: Arc<TestView>,
    _feeds: (
        mpsc::UnboundedSender<FeedEvent>,
        mpsc::UnboundedSender<FeedEvent>,
    ),
}

impl Drop for Fixture {
    /// Lets a held worker finish.
    fn drop(&mut self) {
        self.fake.hold.store(false, Ordering::SeqCst);
        self.sem_view.release();
    }
}

fn start(fake: FakeEmbedder) -> Fixture {
    start_with(fake, true)
}

/// With `opened` false, the full-text store never opens.
fn start_with(fake: FakeEmbedder, opened: bool) -> Fixture {
    let view = TestView::with(PAGES);
    let (full_tx, full_rx) = mpsc::unbounded_channel();
    let (sem_tx, sem_rx) = mpsc::unbounded_channel();
    let fulltext = Arc::new(if opened {
        FullTextBackend::new("test", Location::Memory, view.clone(), full_rx)
    } else {
        FullTextBackend::unopened(view.clone())
    });
    let fake = Arc::new(fake);
    let service = SemanticService::with_embedder(fake.clone());
    let space = service.attach("test", "test", Location::Memory, view.clone(), sem_rx);
    Fixture {
        backend: SemanticBackend::new(fulltext, space, view.clone()),
        fake,
        sem_view: view,
        _feeds: (full_tx, sem_tx),
    }
}

/// The full-text index (in memory) and queries read `view`; the semantic
/// worker reads `sem_view`, so its reads can be blocked alone.
fn start_on(view: Arc<TestView>, sem_view: Arc<TestView>, sem_location: Location) -> Fixture {
    let (full_tx, full_rx) = mpsc::unbounded_channel();
    let (sem_tx, sem_rx) = mpsc::unbounded_channel();
    let fulltext = Arc::new(FullTextBackend::new(
        "test",
        Location::Memory,
        view.clone(),
        full_rx,
    ));
    let fake = Arc::new(FakeEmbedder::new());
    let service = SemanticService::with_embedder(fake.clone());
    let space = service.attach("test", "test", sem_location, sem_view.clone(), sem_rx);
    Fixture {
        backend: SemanticBackend::new(fulltext, space, view),
        fake,
        sem_view,
        _feeds: (full_tx, sem_tx),
    }
}

/// [`PAGES`] plus `more` pages under `Pages/` (more than a semantic batch).
fn view_with_more(more: usize) -> Arc<TestView> {
    let view = TestView::with(PAGES);
    for i in 0..more {
        view.write(&format!("Pages/Moss {i:02}.md"), &format!("Moss note {i}."));
    }
    view
}

async fn until(what: &str, f: impl Fn() -> bool) {
    let started = Instant::now();
    while !f() {
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "timed out: {what}"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn ready(fake: FakeEmbedder) -> Fixture {
    let fx = start(fake);
    until("ready", || fx.backend.status().ready).await;
    fx
}

/// Its first call waits until the test clears `hold`, so the semantic
/// index stays building until then.
fn held() -> FakeEmbedder {
    let fake = FakeEmbedder::new();
    fake.hold.store(true, Ordering::SeqCst);
    fake
}

/// The fake model with a vector minimum and the shipped model's similar weight.
fn strict(search_min: f32) -> FakeEmbedder {
    weighted(
        search_min,
        crate::semantic::catalog::default_model()
            .thresholds
            .similar_weight,
    )
}

/// The fake model with a vector minimum and a similar weight.
fn weighted(search_min: f32, similar_weight: f32) -> FakeEmbedder {
    gapped(search_min, similar_weight, 1.0)
}

/// The fake model with a vector minimum, a similar weight and a gap.
fn gapped(search_min: f32, similar_weight: f32, max_gap: f32) -> FakeEmbedder {
    FakeEmbedder {
        spec: ModelSpec {
            thresholds: Thresholds {
                search_min,
                related_min: 0.0,
                related_damping: 0.0,
                max_gap,
                similar_weight,
                calibrated: false,
            },
            ..fake_spec()
        },
        ..FakeEmbedder::new()
    }
}

fn natural(query: &str) -> QueryRequest {
    QueryRequest {
        query: query.into(),
        mode: Some(QueryMode::Natural),
        ..QueryRequest::default()
    }
}

/// Pages related to `page`, with the default limit.
fn about(page: &str) -> RelatedRequest {
    RelatedRequest {
        page: page.into(),
        ..RelatedRequest::default()
    }
}

fn cx() -> RequestCx {
    RequestCx::unlimited(limits::DEADLINE)
}

/// A Natural query of `fx` ranked with `fusion`, with its scores.
async fn scored(fx: &Fixture, query: &str, fusion: Fusion) -> ScoredPages {
    fx.backend
        .scored_natural(natural(query), cx(), fusion)
        .await
        .unwrap()
}

fn pages(r: &QueryResult) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for m in &r.items {
        if !out.contains(&m.page.as_str()) {
            out.push(&m.page);
        }
    }
    out
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn natural_puts_pages_with_every_word_first_with_highlights() {
    let fx = ready(FakeEmbedder::new()).await;
    let r = fx.backend.query(natural("flat tyre"), cx()).await.unwrap();
    assert_eq!(pages(&r)[0], "Bike/Puncture");
    assert!(!r.items[0].highlights.is_empty(), "full-text passages");
    assert!(!r.partial && r.notice.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_page_found_only_by_meaning_gets_its_best_chunks() {
    let fx = ready(strict(0.5)).await;
    // No page has "clinking", nor a word close to it, so the full-text
    // index finds nothing; the fake embedder hashes it to the same
    // dimension as "chain".
    let r = fx.backend.query(natural("clinking"), cx()).await.unwrap();
    assert_eq!(
        pages(&r),
        ["Bike/Chain"],
        "the other pages share no dimension and stay under 0.5"
    );
    let m = &r.items[0];
    assert_eq!(m.heading.as_deref(), Some("Chain"));
    assert!(m.excerpt.starts_with("# Chain"));
    assert!(m.highlights.is_empty());
    assert_eq!((m.pos, m.line), (0, 1));
    assert_eq!(r.total, 1);
}

/// Task 19: below the model's vector minimum, hybrid adds no meaning
/// hits. A query the full-text index answers gets the same pages as
/// Words, and one it doesn't answer gets nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn below_the_vector_minimum_hybrid_answers_like_full_text() {
    let fx = ready(strict(0.99)).await;
    let words = |query: &str| QueryRequest {
        mode: Some(QueryMode::Words),
        ..natural(query)
    };
    let r = fx.backend.query(natural("oil chain"), cx()).await.unwrap();
    let w = fx.backend.query(words("oil chain"), cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert_eq!(pages(&r), pages(&w));
    assert!(!r.items[0].highlights.is_empty(), "full-text passages only");
    // Task 20 (M2P4) and M2P9: no page has every word, nothing passes the
    // vector minimum, and Natural answers with similar pages as Words does
    // (Task 19 expected nothing here).
    let r = fx
        .backend
        .query(natural("chain bicycle grease"), cx())
        .await
        .unwrap();
    let w = fx
        .backend
        .query(words("chain bicycle grease"), cx())
        .await
        .unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert_eq!(pages(&r), pages(&w));
    let r = fx.backend.query(natural("clinking"), cx()).await.unwrap();
    assert!(r.items.is_empty() && r.total == 0, "{:?}", pages(&r));
    // The same query with a permissive minimum does find it by meaning.
    let open = ready(strict(0.0)).await;
    let r = open.backend.query(natural("clinking"), cx()).await.unwrap();
    assert_eq!(pages(&r)[0], "Bike/Chain");
    let s = scored(&open, "clinking", Fusion::Hybrid).await;
    assert_eq!(s.pages[0].0, "Bike/Chain");
    assert!(s.pages[0].1 > 0.0);
}

/// Task 20 (M2P4), M2P9: no page has every word, one has a typo of one of
/// them. At the shipped similar weight Natural finds it through the
/// full-text similar tier, with its highlights, although its vector score
/// is below the minimum.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn natural_finds_a_typo_through_the_similar_tier_below_the_vector_minimum() {
    let fx = ready(strict(0.99)).await;
    let words = QueryRequest {
        mode: Some(QueryMode::Words),
        ..natural("puncure repair")
    };
    let r = fx
        .backend
        .query(natural("puncure repair"), cx())
        .await
        .unwrap();
    let w = fx.backend.query(words, cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Puncture"]);
    assert_eq!(pages(&r), pages(&w));
    assert!(!r.items[0].highlights.is_empty(), "full-text passages");
    // The vector half alone doesn't reach the minimum.
    let v = scored(&fx, "puncure repair", Fusion::VectorOnly).await;
    assert!(v.pages.is_empty(), "{:?}", v.pages);
}

/// Task 21: similar-tier pages enter the fusion at `similar_weight`,
/// exact-tier pages at 1; at 0 they only follow the fused pages (M2P9).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn similar_tier_pages_count_at_the_similar_weight() {
    let rrf_1 = 1.0 / (crate::semantic::index::RRF_K + 1.0);
    for w in [0.25, 1.0] {
        let fx = ready(weighted(0.99, w)).await;
        let r = scored(&fx, "puncure repair", Fusion::Hybrid).await;
        assert_eq!(r.pages, [("Bike/Puncture".to_string(), w * rrf_1)], "w {w}");
    }
    // At 0 nothing fuses, and the similar page follows (here alone), below
    // where any fused page would score, with its full-text highlights (M2P9).
    let fx = ready(weighted(0.99, 0.0)).await;
    let r = fx
        .backend
        .query(natural("puncure repair"), cx())
        .await
        .unwrap();
    assert_eq!(pages(&r), ["Bike/Puncture"]);
    assert_eq!(r.total, 1);
    assert!(!r.items[0].highlights.is_empty(), "full-text passages");
    let s = scored(&fx, "puncure repair", Fusion::Hybrid).await;
    assert_eq!(s.pages, [("Bike/Puncture".to_string(), rrf_1 / 2.0)]);
    // The exact tier keeps weight 1 whatever the similar weight.
    let r = scored(&fx, "puncture", Fusion::Hybrid).await;
    assert_eq!(r.pages[0], ("Bike/Puncture".to_string(), rrf_1));
}

/// The candidates as Natural gathers them: the lexical half with the tier
/// that answered, and every vector hit, whatever the minimum.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn candidates_report_both_halves_before_any_threshold() {
    let fx = ready(strict(0.99)).await;
    let c = fx.backend.candidates("flat tyre", cx()).await.unwrap();
    assert_eq!(
        (c.lexical, c.similar),
        (vec!["Bike/Puncture.md".to_string()], false)
    );
    assert_eq!(c.vector.len(), 4, "below the minimum too: {:?}", c.vector);
    assert!(c.vector.windows(2).all(|w| w[0].score >= w[1].score));
    let c = fx.backend.candidates("puncure repair", cx()).await.unwrap();
    assert_eq!(
        (c.lexical, c.similar),
        (vec!["Bike/Puncture.md".to_string()], true)
    );
    let c = fx.backend.candidates("clinking", cx()).await.unwrap();
    assert!(c.lexical.is_empty());
    assert!(matches!(
        fx.backend.candidates("x", cx()).await,
        Err(SearchError::QueryTooShort(_))
    ));
}

/// Natural ranks through [`rank_natural`]: its pages and scores are the
/// pure ranking of its candidates, for both fusions and with the similar
/// tier at weight 0 and above (what the eval's calibration relies on).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn natural_answers_the_pure_ranking_of_its_candidates() {
    let queries = [
        "flat tyre",
        "puncure repair",
        "clinking puncure",
        "oil chain",
        "clinking",
        "grind beans fresh",
    ];
    for fake in [
        weighted(0.0, 0.0),
        weighted(0.3, 0.5),
        strict(0.5),
        gapped(0.0, 1.0, 0.05),
        gapped(0.0, 0.0, 0.05),
    ] {
        let fx = ready(fake).await;
        let th = fx.backend.thresholds();
        for query in queries {
            let c = fx.backend.candidates(query, cx()).await.unwrap();
            for fusion in [Fusion::Hybrid, Fusion::VectorOnly] {
                let s = scored(&fx, query, fusion).await;
                let ranked = rank_natural(&c, fusion, &th);
                let expected: Vec<&str> = ranked
                    .iter()
                    .map(|r| r.path.strip_suffix(".md").unwrap())
                    .collect();
                let found: Vec<&str> = s.pages.iter().map(|(p, _)| p.as_str()).collect();
                assert_eq!(found, expected, "{query:?} {fusion:?} {th:?}");
                if fusion == Fusion::Hybrid {
                    let scores: Vec<f32> = ranked.iter().map(|r| r.score).collect();
                    let first: Vec<f32> = s.pages.iter().map(|(_, score)| *score).collect();
                    assert_eq!(first, scores, "{query:?}");
                    // Production Natural answers the same pages.
                    let r = fx.backend.query(natural(query), cx()).await.unwrap();
                    assert_eq!(pages(&r), expected, "{query:?} {th:?}");
                    assert_eq!(r.total, ranked.len());
                }
            }
        }
    }
}

/// A page the lexical half placed that its full-text passages can't read
/// (it was gone for that read) gets its best chunks instead only when it is
/// among the vector hits that count: outside the gap it is left out.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_lexical_page_outside_the_gap_lends_no_chunks() {
    const LOG: &str = "Notes/Log.md";
    let view = TestView::with(PAGES);
    view.write(
        LOG,
        "# Log\nMoss and fern on the stones.\n\n# Later\nOil chain.",
    );
    let (full_tx, full_rx) = mpsc::unbounded_channel();
    let (sem_tx, sem_rx) = mpsc::unbounded_channel();
    let fulltext = Arc::new(FullTextBackend::new(
        "test",
        Location::Memory,
        view.clone(),
        full_rx,
    ));
    let fake = Arc::new(gapped(0.0, 1.0, 0.01));
    let service = SemanticService::with_embedder(fake.clone());
    let space = service.attach("test", "test", Location::Memory, view.clone(), sem_rx);
    let fx = Fixture {
        backend: SemanticBackend::new(fulltext, space, view.clone()),
        fake,
        sem_view: view.clone(),
        _feeds: (full_tx, sem_tx),
    };
    until("ready", || fx.backend.status().ready).await;
    let query = "oil chain";
    let c = fx.backend.candidates(query, cx()).await.unwrap();
    assert!(c.lexical.contains(&LOG.to_string()), "{c:?}");
    let log = c.vector.iter().find(|h| h.path == LOG).unwrap();
    assert!(
        log.score < c.vector[0].score - 0.01,
        "outside the gap: {c:?}"
    );
    assert!(!log.chunks.is_empty());
    let before = fx.backend.query(natural(query), cx()).await.unwrap();
    assert!(pages(&before).contains(&"Notes/Log"));
    // From now on the page's first read (its full-text passages) finds it
    // gone; later reads (its chunks) find it again.
    view.reset_reads();
    *view.hook.lock().unwrap() = Some(Box::new(|view: &TestView, _| {
        let mut hidden = view.hidden.lock().unwrap();
        if view.reads(LOG) == 1 {
            hidden.insert(LOG.to_string());
        } else {
            hidden.remove(LOG);
        }
    }));
    let r = fx.backend.query(natural(query), cx()).await.unwrap();
    assert_eq!(view.reads(LOG), 1, "no chunks were read for it");
    assert!(!pages(&r).contains(&"Notes/Log"), "{:?}", r.items);
    assert_eq!(r.total, before.total - 1);
}

/// M2P9: with the similar weight at 0, the fused list (here a page found
/// by meaning) comes first with its best chunks, and the similar pages it
/// doesn't hold follow with their full-text highlights.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn similar_pages_follow_a_non_empty_fused_list() {
    let fx = ready(strict(0.5)).await;
    assert_eq!(fx.backend.thresholds().similar_weight, 0.0);
    // No page has both words. "puncure" is a typo the similar tier
    // corrects; "clinking" shares the fake embedder's dimension with "chain".
    let r = fx
        .backend
        .query(natural("clinking puncure"), cx())
        .await
        .unwrap();
    assert_eq!(pages(&r), ["Bike/Chain", "Bike/Puncture"]);
    assert_eq!(r.total, 2);
    let chain = r.items.iter().find(|m| m.page == "Bike/Chain").unwrap();
    assert!(
        chain.highlights.is_empty(),
        "a meaning match: its best chunk"
    );
    let puncture = r.items.iter().find(|m| m.page == "Bike/Puncture").unwrap();
    assert!(!puncture.highlights.is_empty(), "a similar page: full text");
    let s = scored(&fx, "clinking puncure", Fusion::Hybrid).await;
    assert!(s.pages[1].1 < s.pages[0].1, "{:?}", s.pages);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn vector_hits_carry_their_cosine() {
    let fx = ready(FakeEmbedder::new()).await;
    let r = scored(&fx, "oil chain", Fusion::VectorOnly).await;
    let first = r.pages[0].1;
    assert!(first > 0.0 && first <= 1.0 + 1e-6, "{first}");
    let scores: Vec<f32> = r.pages.iter().map(|(_, score)| *score).collect();
    assert!(scores.windows(2).all(|w| w[0] >= w[1]), "{scores:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn words_and_phrase_go_to_the_full_text_index() {
    let fx = ready(FakeEmbedder::new()).await;
    for mode in [QueryMode::Words, QueryMode::Phrase] {
        let req = QueryRequest {
            query: "flat tyre".into(),
            mode: Some(mode),
            ..QueryRequest::default()
        };
        let ours = fx.backend.query(req.clone(), cx()).await.unwrap();
        let theirs = fx.backend.fulltext.query(req, cx()).await.unwrap();
        assert_eq!(ours, theirs, "{mode:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn natural_while_building_answers_from_words_with_the_notice() {
    let fx = start(held());
    until("full-text ready", || fx.backend.fulltext.status().ready).await;
    until(
        "building with a total",
        || matches!(fx.backend.space().state(), IndexState::Building { total, .. } if total > 0),
    )
    .await;
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert!(r.partial);
    assert!(r.notice.unwrap().starts_with("Search index building: "));
}

/// Review Focus 2 (the backend half).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn public_visitors_get_words_and_phrase_while_building() {
    let fx = start(held());
    until("full-text ready", || fx.backend.fulltext.status().ready).await;
    assert_eq!(
        fx.backend.public_modes(),
        [QueryMode::Words, QueryMode::Phrase]
    );
    let status = fx.backend.status();
    assert_eq!(status.capabilities.modes, MODES);
    assert!(!status.capabilities.related && !status.ready);
    assert_eq!(status.model.as_deref(), Some("test-fake"));
    fx.fake.hold.store(false, Ordering::SeqCst);
    until("ready", || fx.backend.status().ready).await;
    assert_eq!(fx.backend.public_modes(), MODES);
    assert!(fx.backend.status().capabilities.related);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn related_appears_once_ready_and_leaves_the_page_out() {
    let fx = start(held());
    assert_eq!(
        fx.backend.related(about("Bike/Chain"), cx()).await,
        Err(SearchError::Unavailable(RELATED_BUILDING.into()))
    );
    fx.fake.hold.store(false, Ordering::SeqCst);
    until("ready", || fx.backend.status().ready).await;
    let r = fx.backend.related(about("Bike/Chain"), cx()).await.unwrap();
    assert!(!pages(&r).contains(&"Bike/Chain"));
    assert_eq!(pages(&r).len(), 3, "every other page passes a 0.0 minimum");
    assert_eq!(
        fx.backend.related(about("Missing"), cx()).await,
        Err(SearchError::Unavailable(NOT_INDEXED.into()))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn related_in_the_pages_scope_leaves_meta_pages_out() {
    let fx = ready(FakeEmbedder::new()).await;
    let r = fx.backend.related(about("Bike/Chain"), cx()).await.unwrap();
    assert!(pages(&r).contains(&"Meta/Ride Template"));
    let req = RelatedRequest {
        scope: Some(SearchScope::Pages),
        ..about("Bike/Chain")
    };
    let r = fx.backend.related(req, cx()).await.unwrap();
    let mut got = pages(&r);
    got.sort();
    assert_eq!(got, ["Bike/Puncture", "Kitchen/Coffee"]);
    // A page outside the scope relates to nothing in it: a regular page in
    // the meta scope, a Meta page in the pages scope.
    let req = RelatedRequest {
        scope: Some(SearchScope::Meta),
        ..about("Bike/Chain")
    };
    let r = fx.backend.related(req, cx()).await.unwrap();
    assert!(pages(&r).is_empty());
    let r = fx
        .backend
        .related(about("Meta/Ride Template"), cx())
        .await
        .unwrap();
    assert!(
        !pages(&r).is_empty(),
        "all scopes: a Meta page has related pages"
    );
    let req = RelatedRequest {
        scope: Some(SearchScope::Pages),
        ..about("Meta/Ride Template")
    };
    let r = fx.backend.related(req, cx()).await.unwrap();
    assert!(pages(&r).is_empty(), "on a Meta page, no related pages");
    assert_eq!(r.total, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn related_without_a_limit_gets_ten_pages() {
    let view = view_with_more(20);
    let fx = start_on(view.clone(), view, Location::Memory);
    until("ready", || fx.backend.status().ready).await;
    let r = fx.backend.related(about("Bike/Chain"), cx()).await.unwrap();
    assert_eq!((r.total, pages(&r).len()), (RELATED_LIMIT, 10));
    let four = RelatedRequest {
        limit: Some(4),
        ..about("Bike/Chain")
    };
    let r = fx.backend.related(four, cx()).await.unwrap();
    assert_eq!((r.total, pages(&r).len()), (4, 4));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scope_include_and_exclude_apply_to_meaning_results() {
    let fx = ready(FakeEmbedder::new()).await;
    let ask = |scope, exclude: Option<Vec<String>>| QueryRequest {
        scope: Some(scope),
        exclude,
        ..natural("ride weather distance")
    };
    let r = fx
        .backend
        .query(ask(SearchScope::Meta, None), cx())
        .await
        .unwrap();
    assert_eq!(pages(&r), ["Meta/Ride Template"]);
    let r = fx
        .backend
        .query(ask(SearchScope::Pages, None), cx())
        .await
        .unwrap();
    assert!(!pages(&r).contains(&"Meta/Ride Template"));
    let r = fx
        .backend
        .query(
            ask(SearchScope::Pages, Some(vec!["Bike/Chain".into()])),
            cx(),
        )
        .await
        .unwrap();
    assert!(!pages(&r).contains(&"Bike/Chain"));
    assert_eq!(r.total, pages(&r).len(), "hidden pages never count");
    let only_chain = QueryRequest {
        include: Some(vec!["Bike/Chain".into()]),
        ..ask(SearchScope::Pages, None)
    };
    let r = fx.backend.query(only_chain, cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert_eq!(r.total, 1);
}

/// M2R23 while Ready: the index is built, then the model fails (say it
/// was unloaded idle and can't reload). The query goes through the
/// embed and answers from Words with the notice.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_embed_failure_while_ready_falls_back_to_words() {
    let fx = ready(FakeEmbedder::new()).await;
    let calls = fx.fake.calls.load(Ordering::SeqCst);
    fx.fake.fail.store(true, Ordering::SeqCst);
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert_eq!(fx.fake.calls.load(Ordering::SeqCst), calls + 1, "embedded");
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert!(r.partial);
    assert_eq!(r.notice.as_deref(), Some(UNAVAILABLE_NOTICE));
}

/// M2R23: an embed that misses the deadline is `Busy` (429), not Words.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_embed_past_the_deadline_is_busy() {
    let fx = ready(FakeEmbedder::new()).await;
    fx.fake.hold.store(true, Ordering::SeqCst);
    assert_eq!(
        fx.backend
            .query(natural("chain"), RequestCx::unlimited(Duration::ZERO))
            .await,
        Err(SearchError::Busy)
    );
}

/// Pair 8: a semantic index that is Ready (a reused file) before the
/// full-text store opens. A restricted query can't be admitted yet and
/// answers from Words, starting; an unrestricted one ranks by vectors
/// alone and says so.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn natural_before_the_full_text_store_opens_says_it_is_starting() {
    let fx = start_with(FakeEmbedder::new(), false);
    until("semantic ready", || fx.backend.space().state().is_ready()).await;
    let scoped = QueryRequest {
        scope: Some(SearchScope::Pages),
        ..natural("chain oil")
    };
    let r = fx.backend.query(scoped, cx()).await.unwrap();
    assert!(r.partial && r.items.is_empty());
    assert_eq!(r.notice.as_deref(), Some(STARTING));
    let r = fx.backend.query(natural("chain oil"), cx()).await.unwrap();
    assert_eq!(pages(&r)[0], "Bike/Chain");
    assert!(r.items[0].highlights.is_empty(), "no full-text passages");
    assert!(r.partial);
    assert_eq!(r.notice.as_deref(), Some(STARTING));
}

/// Review Focus 5 (the query half).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_model_that_fails_to_load_falls_back_to_words() {
    let fake = FakeEmbedder::new();
    fake.fail.store(true, Ordering::SeqCst);
    let fx = start(fake);
    until("failed", || {
        matches!(fx.backend.space().state(), IndexState::Failed { .. })
    })
    .await;
    until("full-text ready", || fx.backend.fulltext.status().ready).await;
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert_eq!(r.notice.as_deref(), Some(UNAVAILABLE_NOTICE));
    let status = fx.backend.status();
    assert!(!status.ready && !status.capabilities.related);
    assert_eq!(
        status.reason.as_deref(),
        Some("The semantic index can't be updated")
    );
    assert!(fx.backend.related(about("Bike/Chain"), cx()).await.is_err());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_natural_query_is_cancelled() {
    let fx = ready(FakeEmbedder::new()).await;
    let cx = cx();
    cx.cancel.cancel();
    assert_eq!(
        fx.backend.query(natural("chain"), cx).await,
        Err(SearchError::Cancelled)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_natural_queries_get_the_usual_errors() {
    let fx = ready(FakeEmbedder::new()).await;
    assert_eq!(
        fx.backend.query(natural("x"), cx()).await,
        Err(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS))
    );
    let long = "a".repeat(limits::MAX_QUERY_BYTES + 1);
    assert!(matches!(
        fx.backend.query(natural(&long), cx()).await,
        Err(SearchError::Invalid(_))
    ));
}

/// Ready with no catch-up running.
fn caught_up(fx: &Fixture) -> bool {
    fx.backend.space().state() == IndexState::Ready { catch_up: None }
}

/// Natural answers from the vectors, Related and public Natural stay, and
/// the catch-up shows as progress of a ready index.
async fn usable_while_catching_up(fx: &Fixture, total: u64) {
    until("catch-up progress", || {
        matches!(
            fx.backend.space().state(),
            IndexState::Ready { catch_up: Some(_) }
        )
    })
    .await;
    assert!(fx.backend.space().state().is_ready());
    let status = fx.backend.status();
    assert!(status.ready && status.capabilities.related);
    assert_eq!(status.progress, Some(Progress { done: 0, total }));
    assert_eq!(fx.backend.public_modes(), MODES);
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert_eq!(pages(&r)[0], "Bike/Chain");
    assert!(!r.partial && r.notice.is_none(), "{:?}", r.notice);
    let related = fx.backend.related(about("Bike/Chain"), cx());
    assert!(related.await.is_ok());
    assert_eq!(fx.backend.space().index().unwrap().len(), PAGES.len());
}

/// M2P13: a catch-up of more than a batch (33 pages) doesn't make a built
/// index "building", and doesn't wait for the build slot another space holds.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_ready_index_keeps_answering_while_a_large_change_catches_up() {
    let (view, sem_view) = (TestView::with(PAGES), TestView::with(PAGES));
    let fx = start_on(view.clone(), sem_view.clone(), Location::Memory);
    until("ready", || fx.backend.status().ready).await;
    let _other_build = crate::semantic::sink::BUILDS.acquire().await.unwrap();
    for i in 0..33 {
        let (path, body) = (format!("Pages/Moss {i:02}.md"), format!("Moss note {i}."));
        view.write(&path, &body);
        sem_view.write(&path, &body);
    }
    // The semantic worker's reads of `Pages/` wait until it is released.
    sem_view.block_from.store(1, Ordering::SeqCst);
    fx._feeds.1.send(FeedEvent::Rescan).unwrap();
    usable_while_catching_up(&fx, 33).await;
    sem_view.release();
    until("caught up", || caught_up(&fx)).await;
    assert_eq!(fx.backend.space().index().unwrap().len(), PAGES.len() + 33);
    assert_eq!(fx.backend.status().progress, None);
    assert_eq!(
        fx.backend.space().state(),
        IndexState::Ready { catch_up: None }
    );
}

/// M2P13: a reused index file with offline changes is ready at once; its
/// first reconcile catches up without a build slot.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reused_index_with_offline_changes_is_ready_while_it_catches_up() {
    let tmp = tempfile::tempdir().unwrap();
    let location = Location::Disk(tmp.path().to_path_buf());
    let file = crate::semantic::store::file_path(tmp.path(), &fake_spec());
    {
        let view = TestView::with(PAGES);
        let fx = start_on(view.clone(), view, location.clone());
        until("ready", || fx.backend.status().ready).await;
        until("saved", || file.exists()).await;
    }
    let _other_build = crate::semantic::sink::BUILDS.acquire().await.unwrap();
    let (view, sem_view) = (view_with_more(33), view_with_more(33));
    sem_view.block_from.store(1, Ordering::SeqCst);
    let fx = start_on(view, sem_view.clone(), location);
    until("ready", || fx.backend.status().ready).await;
    usable_while_catching_up(&fx, 33).await;
    sem_view.release();
    until("caught up", || caught_up(&fx)).await;
    assert_eq!(fx.backend.space().index().unwrap().len(), PAGES.len() + 33);
    let stats = fx.backend.space().stats().unwrap();
    assert!(stats.caught_up);
}

/// R1 (M2P15): a file checkpointed during a first build that didn't finish
/// reopens as a first build: Building, waiting for the build slot, Natural
/// from Words with the notice; Ready once the build finished.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unfinished_first_build_resumes_as_a_first_build() {
    use crate::semantic::inference::Inference;
    use crate::semantic::sink::SemanticSink;
    use crate::{Change, IndexSink};
    let tmp = tempfile::tempdir().unwrap();
    let location = Location::Disk(tmp.path().to_path_buf());
    let view = view_with_more(33);
    {
        // What a first build checkpointed before the server stopped.
        let inference = Inference::with_embedder(Arc::new(FakeEmbedder::new()));
        let sink = SemanticSink::open(&location, inference);
        let stamps = view.list_meta().unwrap();
        let changes: Vec<Change> = ["Bike/Chain.md", "Bike/Puncture.md"]
            .into_iter()
            .map(|path| Change::Upsert {
                path: path.into(),
                text: String::from_utf8(view.read(path).unwrap()).unwrap(),
                stamp: stamps[path],
            })
            .collect();
        sink.apply(&changes).unwrap();
        sink.settle();
    }
    let other_build = crate::semantic::sink::BUILDS.acquire().await.unwrap();
    let fx = start_on(view.clone(), view, location);
    until("full-text ready", || fx.backend.fulltext.status().ready).await;
    until(
        "waiting to build",
        || matches!(fx.backend.space().state(), IndexState::Waiting { total } if total > 0),
    )
    .await;
    assert_eq!(fx.backend.space().index().unwrap().len(), 2, "vectors kept");
    let status = fx.backend.status();
    assert!(!status.ready && !status.capabilities.related);
    assert_eq!(fx.backend.public_modes(), BUILDING_MODES);
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert!(r.partial);
    assert!(r.notice.unwrap().starts_with("Search index building: "));
    // Still waiting for the slot another space's build holds.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(matches!(
        fx.backend.space().state(),
        IndexState::Waiting { .. }
    ));
    drop(other_build);
    until("ready", || fx.backend.status().ready).await;
    assert_eq!(fx.backend.space().index().unwrap().len(), PAGES.len() + 33);
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert!(!r.partial && r.notice.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuild_clears_the_vectors_and_meaning_answers_with_all_words_until_done() {
    let fx = start_on(
        TestView::with(PAGES),
        TestView::with(PAGES),
        Location::Memory,
    );
    until("ready", || fx.backend.status().ready).await;
    let embedded = fx.fake.texts.load(Ordering::SeqCst);
    let kinds: Vec<IndexKind> = fx.backend.indexes().iter().map(|r| r.kind).collect();
    assert_eq!(kinds, [IndexKind::FullText, IndexKind::Semantic]);

    fx.sem_view.block();
    fx.backend.rebuild().unwrap();
    until("semantic building", || {
        matches!(
            fx.backend.indexes()[1].state,
            IndexState::Building { total: 4, .. }
        )
    })
    .await;
    assert!(
        fx.backend.space().index().unwrap().is_empty(),
        "vectors cleared"
    );
    let r = fx.backend.query(natural("chain"), cx()).await.unwrap();
    assert_eq!(pages(&r), ["Bike/Chain"]);
    assert!(
        r.notice.unwrap().starts_with("Search index building: "),
        "Semantic served by All words while it rebuilds"
    );
    assert_eq!(
        fx.backend.related(about("Bike/Chain"), cx()).await,
        Err(SearchError::Unavailable(RELATED_BUILDING.into()))
    );

    fx.sem_view.release();
    until("semantic ready", || {
        matches!(fx.backend.indexes()[1].state, IndexState::Ready { .. })
    })
    .await;
    assert!(fx.backend.related(about("Bike/Chain"), cx()).await.is_ok());
    assert_eq!(
        fx.fake.texts.load(Ordering::SeqCst),
        embedded * 2,
        "every chunk embedded again"
    );
    let semantic = &fx.backend.indexes()[1];
    assert_eq!(semantic.pages, Some(4));
    assert!(semantic.build_secs.is_some());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuild_before_the_full_text_store_opens_is_unavailable() {
    let fx = start_with(FakeEmbedder::new(), false);
    assert!(matches!(
        fx.backend.rebuild(),
        Err(SearchError::Unavailable(_))
    ));
    assert_eq!(fx.backend.indexes()[0].state, IndexState::Starting);
}

#[test]
fn an_excerpt_starts_after_the_frontmatter() {
    let chunk = "---\ntags: person\nrole: Gardener\n---\nGrows tomatoes on the balcony.";
    let left = chunk.find("Grows").unwrap();
    assert_eq!(excerpt(chunk, left), "Grows tomatoes on the balcony.");
    // A later chunk has no frontmatter left to skip.
    assert_eq!(excerpt("Plain text.", 0), "Plain text.");
    // A page that is only frontmatter keeps it rather than showing nothing.
    assert_eq!(
        excerpt("---\ntags: person\n---\n", 21),
        "---\ntags: person\n---"
    );
}
