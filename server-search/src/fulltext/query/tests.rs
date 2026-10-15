use super::*;
use crate::fulltext::analysis::register_tokenizers;
use crate::fulltext::schema::{document, schema};
use crate::fulltext::words::MAX_FUZZY_PARTS;
use crate::limits;
use crate::FileStamp;
use crate::QueryMode;
use tantivy::IndexWriter;

const PAGES: &[(&str, &str)] = &[
    (
        "Bike/Chain care.md",
        "# Chain care\nClean and oil the bike chain every month.",
    ),
    (
        "Bike/Puncture repair.md",
        "# Puncture repair\nFind the hole in the bike tire, patch the inner tube and pump it up.",
    ),
    (
        "Fiets/Band.md",
        "# Band\nDe band van de fiets is lek en het ventiel zit los.",
    ),
    (
        "Ops/Deploy.md",
        "# Deploy\nRun deployctl rollback when the release breaks the build.",
    ),
    (
        "Home/Network.md",
        "# Network\nThe attic-net access point sits under the roof.",
    ),
    (
        "Kitchen/Pesto.md",
        "# Pesto\nBlend fresh Basil Pesto with pine nuts and garlic.",
    ),
    (
        "Garden/Herbs.md",
        "# Herbs\nThe basil grows well; the pesto jar waits in the fridge.",
    ),
    (
        "Garden/Tomatoes.md",
        "# Plants\nWater the plants every morning in summer.",
    ),
    (
        "Notes/War diaries.md",
        "# Diaries\nOld soldiers never die; the war diaries tell the story.",
    ),
    (
        "Garten/Rosen.md",
        "# Rosen\nDer Garten war im Sommer schön und die Rosen blühten in dem Beet.",
    ),
    (
        "Kitchen/Salad.md",
        "# Salad\nSlice the tomatoes thinly and add olive oil.",
    ),
];

struct Fixture {
    index: Index,
    fields: Fields,
    searcher: Searcher,
}

fn fixture(extra: &[(String, String)]) -> Fixture {
    let (schema, fields) = schema();
    let index = Index::create_in_ram(schema);
    register_tokenizers(&index);
    let mut w: IndexWriter = index.writer_with_num_threads(1, 15_000_000).unwrap();
    let stamp = FileStamp {
        modified: 0,
        size: 0,
    };
    let pages = PAGES
        .iter()
        .map(|(p, t)| (p.to_string(), t.to_string()))
        .chain(extra.iter().cloned());
    for (path, text) in pages {
        w.add_document(document(&fields, &path, &text, stamp))
            .unwrap();
    }
    w.commit().unwrap();
    let searcher = index.reader().unwrap().searcher();
    Fixture {
        index,
        fields,
        searcher,
    }
}

fn none() -> PageFilter {
    PageFilter::default()
}

/// The plan for `q` in `mode`, validated as `run_query` does.
fn test_plan(
    fx: &Fixture,
    mode: QueryMode,
    q: &str,
    filter: &PageFilter,
) -> Result<Plan, SearchError> {
    plan(&fx.index, &fx.fields, &validate(mode, q)?, filter)
}

impl Fixture {
    fn words_with(&self, q: &str, filter: &PageFilter) -> (Vec<String>, Tier) {
        let plan = test_plan(self, QueryMode::Words, q, filter).unwrap();
        let Outcome { hits, total, tier } = run(&self.searcher, &self.fields, &plan, 50).unwrap();
        assert_eq!(hits.len(), total);
        (hits.into_iter().map(|h| h.path).collect(), tier)
    }

    fn words(&self, q: &str) -> (Vec<String>, Tier) {
        self.words_with(q, &none())
    }

    fn phrase(&self, q: &str) -> Vec<String> {
        let plan = test_plan(self, QueryMode::Phrase, q, &none()).unwrap();
        assert!(plan.similar.is_none());
        run(&self.searcher, &self.fields, &plan, 50)
            .unwrap()
            .hits
            .into_iter()
            .map(|h| h.path)
            .collect()
    }
}

#[test]
fn known_item_and_hit() {
    let fx = fixture(&[]);
    assert_eq!(
        fx.words("deployctl rollback"),
        (vec!["Ops/Deploy.md".to_string()], Tier::Exact)
    );
    // Stemmed: "bikes" and "chains" match "bike chain".
    assert_eq!(fx.words("bikes chains").0, ["Bike/Chain care.md"]);
}

#[test]
fn a_missing_word_excludes_the_page_in_the_exact_tier() {
    let fx = fixture(&[]);
    assert_eq!(fx.words("bike chain").0, ["Bike/Chain care.md"]);
    let (hits, tier) = fx.words("bike tire");
    assert_eq!(
        (hits, tier),
        (vec!["Bike/Puncture repair.md".into()], Tier::Exact)
    );
}

#[test]
fn stopwords_count_as_present_in_the_page_language() {
    let fx = fixture(&[]);
    let (hits, tier) = fx.words("the bike");
    assert_eq!(tier, Tier::Exact);
    assert!(hits.contains(&"Bike/Chain care.md".to_string()));
    assert!(hits.contains(&"Bike/Puncture repair.md".to_string()));
    assert!(!hits.contains(&"Fiets/Band.md".to_string()));
    assert_eq!(
        fx.words("de fiets"),
        (vec!["Fiets/Band.md".to_string()], Tier::Exact)
    );
    // Regression from the eval: stopwords never match every page in OR.
    assert_eq!(fx.words("the quantum"), (vec![], Tier::Exact));
    assert_eq!(fx.words("de quantum"), (vec![], Tier::Exact));
}

#[test]
fn no_and_result_falls_back_to_similar() {
    let fx = fixture(&[]);
    let (hits, tier) = fx.words("fix a flat bike tire");
    assert_eq!(tier, Tier::Similar);
    assert_eq!(hits[0], "Bike/Puncture repair.md");
}

#[test]
fn typos_match_only_in_the_similar_tier() {
    let fx = fixture(&[]);
    let plan = test_plan(&fx, QueryMode::Words, "rollbakc", &none()).unwrap();
    let (_, total) = collect(&fx.searcher, &fx.fields, &*plan.exact, 50).unwrap();
    assert_eq!(total, 0);
    assert_eq!(
        fx.words("rollbakc"),
        (vec!["Ops/Deploy.md".to_string()], Tier::Similar)
    );
    // An exact hit never reaches the fuzzy tier.
    assert_eq!(fx.words("rollback").1, Tier::Exact);
}

#[test]
fn multi_token_words_are_phrases_and_fuzzed_per_component() {
    let fx = fixture(&[]);
    assert_eq!(
        fx.words("attic-net"),
        (vec!["Home/Network.md".to_string()], Tier::Exact)
    );
    // Not adjacent in this order: no exact hit.
    assert_eq!(fx.words("net-attic").1, Tier::Similar);
    assert_eq!(
        fx.words("atic-net"),
        (vec!["Home/Network.md".to_string()], Tier::Similar)
    );
}

#[test]
fn fuzzed_parts_of_a_word_must_all_match() {
    let fx = fixture(&[
        (
            "Ops/Quota.md".to_string(),
            "# Quota\nERR_DISK_QUOTA means the volume is full.".to_string(),
        ),
        (
            "Office/Desk.md".to_string(),
            "# Desk\nThe desk lamp needs a new bulb.".to_string(),
        ),
        (
            "Ops/Checkout.md".to_string(),
            "# Checkout\nThe test_checkout_timeout test fails on slow runners.".to_string(),
        ),
    ]);
    for q in ["ERR_DISK_QOUTA", "ERR_DESK_QUOTA"] {
        assert_eq!(
            fx.words(q),
            (vec!["Ops/Quota.md".to_string()], Tier::Similar),
            "{q}"
        );
    }
    assert_eq!(fx.words("ERR_DISK_QUOTA").1, Tier::Exact);
    // One part alone, fuzzed or not, is no match.
    for q in ["ERR_DESK_LAMPS", "SYS_DESK_QUOTA", "desk_quotas_xyz"] {
        assert!(
            !fx.words(q).0.contains(&"Office/Desk.md".to_string()),
            "{q}"
        );
        assert!(!fx.words(q).0.contains(&"Ops/Quota.md".to_string()), "{q}");
    }
    assert_eq!(
        fx.words("test_chekout_timeout"),
        (vec!["Ops/Checkout.md".to_string()], Tier::Similar)
    );
    // The last part, still being typed, as a prefix of the name.
    assert_eq!(fx.words("ops-chec").0, vec!["Ops/Checkout.md".to_string()]);
}

#[test]
fn phrases_match_adjacent_words_only() {
    let fx = fixture(&[]);
    assert_eq!(fx.phrase("basil pesto"), ["Kitchen/Pesto.md"]);
    assert_eq!(fx.phrase("BASIL Pesto"), ["Kitchen/Pesto.md"]);
    assert!(fx.phrase("pesto basil").is_empty());
    // One word is a term query on the raw fields.
    let mut one = fx.phrase("basil");
    one.sort();
    assert_eq!(one, ["Garden/Herbs.md", "Kitchen/Pesto.md"]);
    // Words mode finds both pages.
    assert_eq!(fx.words("basil pesto").0.len(), 2);
    assert_eq!(fx.phrase("?!"), Vec::<String>::new());
}

#[test]
fn include_and_exclude_apply_to_both_tiers() {
    let fx = fixture(&[]);
    let include = |n: &[&str]| PageFilter {
        include: Some(n.iter().map(|s| s.to_string()).collect()),
        ..PageFilter::default()
    };
    let exclude = |n: &[&str]| PageFilter {
        exclude: Some(n.iter().map(|s| s.to_string()).collect()),
        ..PageFilter::default()
    };
    // Exact tier.
    assert_eq!(
        fx.words_with("bike", &include(&["Bike/Chain care"])),
        (vec!["Bike/Chain care.md".to_string()], Tier::Exact)
    );
    assert_eq!(
        fx.words_with("bike", &exclude(&["Bike/Chain care"])),
        (vec!["Bike/Puncture repair.md".to_string()], Tier::Exact)
    );
    // Similar tier.
    assert_eq!(
        fx.words_with("rollbakc", &include(&["Ops/Deploy"])),
        (vec!["Ops/Deploy.md".to_string()], Tier::Similar)
    );
    assert_eq!(
        fx.words_with("rollbakc", &include(&["Bike/Chain care"])).0,
        Vec::<String>::new()
    );
    assert_eq!(
        fx.words_with("rollbakc", &exclude(&["Ops/Deploy"])).0,
        Vec::<String>::new()
    );
    // A filtered-out exact hit lets the similar tier answer, still filtered.
    let (hits, tier) = fx.words_with("fix bike tire", &exclude(&["Bike/Puncture repair"]));
    assert_eq!(tier, Tier::Similar);
    assert!(!hits.contains(&"Bike/Puncture repair.md".to_string()));
    // Phrase mode.
    let plan = test_plan(
        &fx,
        QueryMode::Phrase,
        "basil",
        &exclude(&["Kitchen/Pesto"]),
    )
    .unwrap();
    let paths: Vec<_> = run(&fx.searcher, &fx.fields, &plan, 50)
        .unwrap()
        .hits
        .into_iter()
        .map(|h| h.path)
        .collect();
    assert_eq!(paths, ["Garden/Herbs.md"]);
}

#[test]
fn name_match_ranks_above_body_only_match() {
    let fx = fixture(&[]);
    let (hits, _) = fx.words("tomatoes");
    assert_eq!(hits, ["Garden/Tomatoes.md", "Kitchen/Salad.md"]);
}

#[test]
fn odd_queries_never_panic() {
    let fx = fixture(&[]);
    let plan = |q: &str| test_plan(&fx, QueryMode::Words, q, &none());
    // Stopwords only: no page has them all, and the similar tier doesn't
    // fall back to every page of their languages.
    assert_eq!(fx.words("the of and"), (vec![], Tier::Exact));
    assert_eq!(fx.words("de het een"), (vec![], Tier::Exact));
    assert_eq!(fx.words("?! ... --"), (vec![], Tier::Exact));
    assert_eq!(fx.words("東京タワー 夜景").0, Vec::<String>::new());
    assert_eq!(fx.phrase("東京タワー 夜景"), Vec::<String>::new());
    assert_eq!(
        plan("a").err(),
        Some(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS))
    );
    assert_eq!(
        plan("   ").err(),
        Some(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS))
    );
    // 4096 bytes is allowed; one over is not.
    let long = "x".repeat(limits::MAX_QUERY_BYTES);
    assert_eq!(fx.words(&long), (vec![], Tier::Exact));
    assert_eq!(fx.phrase(&long), Vec::<String>::new());
    assert!(matches!(
        plan(&format!("{long}y")),
        Err(SearchError::Invalid(_))
    ));
    let ascii_words = "ab ".repeat(limits::MAX_QUERY_BYTES / 3) + "c";
    assert_eq!(ascii_words.len(), limits::MAX_QUERY_BYTES);
    assert!(plan(&ascii_words).is_ok());
    let terms = |n: usize| {
        (0..n)
            .map(|i| format!("word{i}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    assert!(plan(&terms(limits::MAX_TERMS)).is_ok());
    assert!(matches!(
        plan(&terms(limits::MAX_TERMS + 1)),
        Err(SearchError::Invalid(_))
    ));
    // A long phrase is fine.
    assert!(test_plan(&fx, QueryMode::Phrase, &terms(40), &none()).is_ok());
}

#[test]
fn total_counts_every_matching_page() {
    let extra: Vec<_> = (0..7)
        .map(|i| {
            (
                format!("Log/Day {i}.md"),
                format!("Harvested zucchini on day {i}."),
            )
        })
        .collect();
    let fx = fixture(&extra);
    let plan = test_plan(&fx, QueryMode::Words, "zucchini", &none()).unwrap();
    let Outcome { hits, total, tier } = run(&fx.searcher, &fx.fields, &plan, 3).unwrap();
    assert_eq!((hits.len(), total, tier), (3, 7, Tier::Exact));
    let plan = test_plan(&fx, QueryMode::Words, "zuchini", &none()).unwrap();
    let Outcome { hits, total, tier } = run(&fx.searcher, &fx.fields, &plan, 3).unwrap();
    assert_eq!((hits.len(), total, tier), (3, 7, Tier::Similar));
}

#[test]
fn stopwords_of_other_languages_still_search() {
    let fx = fixture(&[]);
    // "war" and "die" are German stopwords, "die" also Dutch: they search
    // English pages normally, and German pages only where they appear.
    let sorted = |q: &str| {
        let (mut hits, tier) = fx.words(q);
        hits.sort();
        (hits, tier)
    };
    let both = vec![
        "Garten/Rosen.md".to_string(),
        "Notes/War diaries.md".to_string(),
    ];
    assert_eq!(sorted("war"), (both.clone(), Tier::Exact));
    assert_eq!(sorted("die"), (both, Tier::Exact));
    assert_eq!(fx.words("war diaries").0, ["Notes/War diaries.md"]);
    assert!(fx
        .words("the bike")
        .0
        .contains(&"Bike/Chain care.md".to_string()));
    assert_eq!(fx.words("de fiets").0, ["Fiets/Band.md"]);
    // Mixed: "de" is present in Dutch pages, "bike" in English ones; no page
    // has both, so the similar tier answers with the bike pages.
    let (mut hits, tier) = fx.words("de bike");
    hits.sort();
    assert_eq!(tier, Tier::Similar);
    assert_eq!(hits, ["Bike/Chain care.md", "Bike/Puncture repair.md"]);
}

#[test]
fn literal_stopwords_find_the_pages_they_appear_in() {
    let dutch = "# Onderhoud\nDe kettingen moeten elke maand gesmeerd worden.";
    let fx = fixture(&[("Fiets/Onderhoud.md".into(), dutch.into())]);
    assert_eq!(
        crate::fulltext::analysis::detect_lang(dutch),
        crate::fulltext::analysis::Lang::Nl
    );
    // A Dutch stopword in a Dutch page.
    assert_eq!(
        fx.words("worden"),
        (vec!["Fiets/Onderhoud.md".to_string()], Tier::Exact)
    );
    // "the" alone finds the English pages containing it, and only those.
    let (hits, tier) = fx.words("the");
    assert_eq!(tier, Tier::Exact);
    for page in [
        "Bike/Chain care.md",
        "Bike/Puncture repair.md",
        "Notes/War diaries.md",
    ] {
        assert!(hits.contains(&page.to_string()), "{page}: {hits:?}");
    }
    assert!(!hits.contains(&"Kitchen/Pesto.md".to_string()));
    assert!(!hits.contains(&"Fiets/Band.md".to_string()));
    // "the bike" still requires "bike".
    let (mut hits, tier) = fx.words("the bike");
    hits.sort();
    assert_eq!(tier, Tier::Exact);
    assert_eq!(hits, ["Bike/Chain care.md", "Bike/Puncture repair.md"]);
}

#[test]
fn scope_applies_to_both_tiers_and_combines_with_the_lists() {
    let fx = fixture(&[
        (
            "Config/Bike theme.md".into(),
            "#meta/config\nColours for the bike pages.".into(),
        ),
        (
            "Templates/Bike log.md".into(),
            "---\ntags: template\n---\nBike log for the week.".into(),
        ),
    ]);
    let scoped = |scope| PageFilter {
        scope,
        ..PageFilter::default()
    };
    let sorted = |q: &str, filter: &PageFilter| {
        let (mut hits, tier) = fx.words_with(q, filter);
        hits.sort();
        (hits, tier)
    };
    let pages = scoped(SearchScope::Pages);
    let meta = scoped(SearchScope::Meta);
    assert_eq!(
        sorted("bike", &pages),
        (
            vec![
                "Bike/Chain care.md".to_string(),
                "Bike/Puncture repair.md".to_string()
            ],
            Tier::Exact
        )
    );
    assert_eq!(
        sorted("bike", &meta),
        (
            vec![
                "Config/Bike theme.md".to_string(),
                "Templates/Bike log.md".to_string()
            ],
            Tier::Exact
        )
    );
    assert_eq!(sorted("bike", &scoped(SearchScope::All)).0.len(), 4);
    // Similar tier.
    assert_eq!(
        sorted("biek", &meta),
        (
            vec![
                "Config/Bike theme.md".to_string(),
                "Templates/Bike log.md".to_string()
            ],
            Tier::Similar
        )
    );
    assert_eq!(sorted("rollbakc", &meta), (vec![], Tier::Exact));
    assert_eq!(
        sorted("rollbakc", &pages),
        (vec!["Ops/Deploy.md".to_string()], Tier::Similar)
    );
    // Phrase mode.
    let plan = test_plan(&fx, QueryMode::Phrase, "bike log", &pages).unwrap();
    assert_eq!(run(&fx.searcher, &fx.fields, &plan, 50).unwrap().total, 0);
    let plan = test_plan(&fx, QueryMode::Phrase, "bike log", &meta).unwrap();
    assert_eq!(run(&fx.searcher, &fx.fields, &plan, 50).unwrap().total, 1);
    // With include/exclude: the intersection.
    let filter = PageFilter {
        scope: SearchScope::Meta,
        exclude: Some(vec!["Config/Bike theme".into()]),
        ..PageFilter::default()
    };
    assert_eq!(sorted("bike", &filter).0, ["Templates/Bike log.md"]);
    let filter = PageFilter {
        scope: SearchScope::Pages,
        include: Some(vec!["Config/Bike theme".into(), "Bike/Chain care".into()]),
        ..PageFilter::default()
    };
    assert_eq!(sorted("bike", &filter).0, ["Bike/Chain care.md"]);
}

#[test]
fn long_multi_token_words_fuzz_a_bounded_number_of_parts() {
    let fx = fixture(&[]);
    let fuzzy_clauses = |q: &str| {
        let plan = test_plan(&fx, QueryMode::Words, q, &none()).unwrap();
        format!("{:?}", plan.similar.unwrap())
            .matches("FuzzyTermQuery")
            .count()
    };
    // Distinct letter-only components, about 4 KB.
    let letters = |i: usize| -> String {
        (0..4)
            .map(|k| (b'a' + ((i / 26usize.pow(k)) % 26) as u8) as char)
            .collect()
    };
    let mut distinct = String::new();
    let mut i = 0;
    while distinct.len() + 5 <= limits::MAX_QUERY_BYTES {
        if i > 0 {
            distinct.push('-');
        }
        distinct.push_str(&letters(i));
        i += 1;
    }
    assert!(i > 800);
    assert_eq!(fuzzy_clauses(&distinct), 2 * MAX_FUZZY_PARTS + 1);
    let repeated = vec!["abcd"; 800].join("-");
    assert_eq!(fuzzy_clauses(&repeated), 3);
    // Each word needs all of its parts, so a part shared across words is
    // fuzzed in each: four parts, and the prefix.
    assert_eq!(fuzzy_clauses("abcd-wxyz wxyz-abcd"), 9);
    // Many words share the one budget.
    let many: Vec<String> = (0..limits::MAX_TERMS)
        .map(|i| format!("{}-{}", letters(2 * i), letters(2 * i + 1)))
        .collect();
    assert_eq!(fuzzy_clauses(&many.join(" ")), 2 * MAX_FUZZY_PARTS + 1);
    let started = std::time::Instant::now();
    for q in [&distinct, &repeated] {
        let plan = test_plan(&fx, QueryMode::Words, q, &none()).unwrap();
        let Outcome { hits, .. } = run(&fx.searcher, &fx.fields, &plan, 50).unwrap();
        assert!(hits.is_empty());
    }
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
fn failures_hide_internal_detail() {
    let io =
        std::io::Error::other("cannot open /srv/data/search/indexes/sp1/fulltext-v1/meta.json");
    let err = failed("search", tantivy::TantivyError::from(io));
    assert_eq!(err.code(), "failed");
    let shown = err.to_string();
    assert_eq!(shown, "Search failed: try again in a moment");
    assert!(!shown.contains('/') && !shown.contains("meta.json"));
}

#[test]
fn name_prefix_goes_to_the_last_part_past_the_cap() {
    let fx = fixture(&[]);
    let mut q: Vec<String> = (0..MAX_FUZZY_PARTS)
        .map(|i| format!("word{}", (b'a' + i as u8) as char))
        .collect();
    q.push("tailpiece".into());
    let plan = test_plan(&fx, QueryMode::Words, &q.join("-"), &none()).unwrap();
    let shown = format!("{:?}", plan.similar.unwrap());
    // The cap stops "tailpiece" being fuzzed, but it still gets the name
    // prefix: two phrase terms, two exact part terms and the prefix.
    assert_eq!(shown.matches("tailpiece").count(), 2 + 2 + 1);
    // A short last part gets no prefix.
    let plan = test_plan(&fx, QueryMode::Words, "atic-net", &none()).unwrap();
    let shown = format!("{:?}", plan.similar.unwrap());
    assert_eq!(shown.matches("FuzzyTermQuery").count(), 2);
}

/// Review Focus 3: a hit without a usable stored language still counts.
#[test]
fn a_hit_without_a_stored_language_reads_as_english() {
    let (schema, fields) = schema();
    let index = Index::create_in_ram(schema);
    register_tokenizers(&index);
    let mut w: IndexWriter = index.writer_with_num_threads(1, 15_000_000).unwrap();
    let mut doc = TantivyDocument::default();
    doc.add_text(fields.path, "Old/Page.md");
    doc.add_text(fields.body_raw, "basil");
    w.add_document(doc).unwrap();
    w.commit().unwrap();
    let searcher = index.reader().unwrap().searcher();
    let q = TermQuery::new(
        Term::from_field_text(fields.body_raw, "basil"),
        IndexRecordOption::Basic,
    );
    let (hits, total) = collect(&searcher, &fields, &q, 10).unwrap();
    assert_eq!(total, 1);
    assert_eq!(
        hits,
        [Hit {
            path: "Old/Page.md".into(),
            lang: Lang::En,
        }]
    );
}

mod languages;
