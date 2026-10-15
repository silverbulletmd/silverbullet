use super::*;
use crate::fulltext::analysis::{detect_lang, register_tokenizers};
use crate::fulltext::schema::schema;
use crate::fulltext::words::phrase_words;

fn index() -> Index {
    let (schema, _) = schema();
    let index = Index::create_in_ram(schema);
    register_tokenizers(&index);
    index
}

/// Words mode's words for `list`, joined as a query.
fn words(index: &Index, list: &[&str]) -> QueryWords {
    QueryWords::Words(WordList::new(index, &list.join(" ")).unwrap())
}

fn run(text: &str, query: &[&str], phrase: bool, fuzzy: bool) -> Vec<Match> {
    let index = index();
    let q = if phrase {
        phrase_words(&index, &query.join(" "))
    } else {
        words(&index, query)
    };
    let tier = if fuzzy { Tier::Similar } else { Tier::Exact };
    let m = Matcher::new(&index, &q, tier);
    passages("Notes/Trips", text, detect_lang(text), &m)
}

/// The highlighted substrings of a match's excerpt.
fn marked(m: &Match) -> Vec<String> {
    let utf16: Vec<u16> = m.excerpt.encode_utf16().collect();
    m.highlights
        .iter()
        .map(|[a, b]| String::from_utf16(&utf16[*a as usize..*b as usize]).unwrap())
        .collect()
}

#[test]
fn stemmed_words_highlight_their_forms() {
    let out = run("I rode my Bike to the market", &["bikes"], false, false);
    assert_eq!(out.len(), 1);
    assert_eq!(marked(&out[0]), ["Bike"]);
    assert_eq!(out[0].pos, 10);
    assert_eq!(out[0].line, 1);
}

#[test]
fn stopwords_are_not_highlighted_alone() {
    let out = run("the bike is in the shed", &["the", "bike"], false, false);
    assert_eq!(marked(&out[0]), ["bike"]);
}

#[test]
fn stopwords_searched_alone_highlight_literally() {
    let dutch = "De kettingen moeten elke maand gesmeerd worden.";
    let out = run(dutch, &["worden"], false, false);
    assert_eq!(out.len(), 1);
    assert_eq!(marked(&out[0]), ["worden"]);
    let out = run("the bike is in the shed", &["the"], false, false);
    assert_eq!(marked(&out[0]), ["the", "the"]);
    // With a content word they stay unhighlighted.
    let out = run(dutch, &["worden", "gesmeerd"], false, false);
    assert_eq!(marked(&out[0]), ["gesmeerd"]);
}

#[test]
fn phrase_highlights_only_adjacent_occurrences() {
    let text = "pesto then basil\nbasil and pesto\nfresh Basil pesto today";
    let out = run(text, &["basil", "pesto"], true, false);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].line, 3);
    assert_eq!(marked(&out[0]), ["Basil pesto"]);
}

#[test]
fn multi_token_words_match_as_sequences() {
    let text = "F 7 then 31\nthe F-31 valve";
    let out = run(text, &["F-31"], false, false);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].line, 2);
    assert_eq!(marked(&out[0]), ["F-31"]);
}

#[test]
fn fuzzy_highlights_near_misses_only_in_the_similar_tier() {
    let text = "We did a rollback yesterday";
    let out = run(text, &["rollbakc"], false, true);
    assert_eq!(marked(&out[0]), ["rollback"]);
    let exact = run(text, &["rollbakc"], false, false);
    assert_eq!(exact.len(), 1);
    assert_eq!(exact[0].excerpt, "Notes/Trips");
    assert!(exact[0].highlights.is_empty());
}

#[test]
fn fuzzy_parts_of_multi_token_words() {
    let out = run("the attic-net router", &["atic-net"], false, true);
    assert_eq!(marked(&out[0]), ["attic"]);
}

#[test]
fn emoji_before_the_match_counts_utf16_units() {
    let text = "🌱🌱 basil";
    let out = run(text, &["basil"], false, false);
    assert_eq!(out[0].pos, 5);
    assert_eq!(marked(&out[0]), ["basil"]);
}

#[test]
fn crlf_lines() {
    let text = "first\r\nsecond\r\nbasil here\r\n";
    let out = run(text, &["basil"], false, false);
    assert_eq!(out[0].line, 3);
    assert_eq!(out[0].pos, 15);
    assert_eq!(out[0].excerpt, "basil here");
    assert_eq!(marked(&out[0]), ["basil"]);
}

#[test]
fn frontmatter_is_searchable_without_a_heading() {
    let text = "---\nstatus: rollback\n---\n# Plan\n```sh\n# not a heading\n```\nrollback steps";
    let out = run(text, &["rollback"], false, false);
    assert_eq!(out.len(), 2);
    let fm = out.iter().find(|m| m.line == 2).unwrap();
    assert_eq!(fm.heading, None);
    let body = out.iter().find(|m| m.line == 8).unwrap();
    assert_eq!(body.heading.as_deref(), Some("Plan"));
}

#[test]
fn frontmatter_follows_the_classifier_and_headings_are_whole() {
    // `...` doesn't close frontmatter: the heading inside counts.
    let text = "---\n# inside\n...\nrollback steps";
    let out = run(text, &["rollback"], false, false);
    assert_eq!(out[0].heading.as_deref(), Some("inside"));
    // `---` with trailing spaces doesn't open frontmatter either.
    let out = run("--- \n# inside\n---\nrollback", &["rollback"], false, false);
    assert_eq!(out[0].heading.as_deref(), Some("inside"));
    // Full-text headings aren't capped (chunks cap theirs).
    let long = "h".repeat(300);
    let out = run(&format!("# {long}\nrollback"), &["rollback"], false, false);
    assert_eq!(out[0].heading.as_deref(), Some(long.as_str()));
}

#[test]
fn headings_are_atx_and_nearest_above() {
    let text = "# Top\n#tag basil\n## Sub ##\nbasil";
    let out = run(text, &["basil"], false, false);
    let lines: Vec<_> = out.iter().map(|m| (m.line, m.heading.clone())).collect();
    assert_eq!(
        lines,
        [(2, Some("Top".to_string())), (4, Some("Sub".to_string()))]
    );
}

#[test]
fn three_best_lines_in_order() {
    let text = "basil\nmint\nbasil mint sage\nbasil basil\nsage mint\nbasil";
    let out = run(text, &["basil", "mint", "sage"], false, false);
    let lines: Vec<u32> = out.iter().map(|m| m.line).collect();
    assert_eq!(lines, [3, 5, 4]);
}

#[test]
fn tag_lines_only_as_a_fallback() {
    let out = run("tags: basil\nsome basil", &["basil"], false, false);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].line, 2);
    let only = run("tags: basil", &["basil"], false, false);
    assert_eq!(only[0].line, 1);
}

#[test]
fn long_lines_are_windowed_around_the_hit() {
    let text = format!("{}needle {}", "lorem ".repeat(200), "ipsum ".repeat(200));
    let out = run(&text, &["needle"], false, false);
    let m = &out[0];
    assert!(m.excerpt.chars().count() <= EXCERPT_CHARS);
    assert_eq!(marked(m), ["needle"]);
    assert_eq!(m.highlights[0][0], LEAD_CHARS as u32);
    assert_eq!(m.pos, 1200);
}

#[test]
fn windows_never_split_characters() {
    let text = format!("{}needle", "🌱 ".repeat(150));
    let out = run(&text, &["needle"], false, false);
    let m = &out[0];
    assert!(m.excerpt.chars().count() <= EXCERPT_CHARS);
    assert_eq!(marked(m), ["needle"]);
}

#[test]
fn name_only_match() {
    let index = index();
    let q = words(&index, &["gardens"]);
    let m = Matcher::new(&index, &q, Tier::Exact);
    let out = passages("Garden Plans", "nothing to see", Lang::En, &m);
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].pos, out[0].line), (0, 1));
    assert_eq!(out[0].excerpt, "Garden Plans");
    assert_eq!(marked(&out[0]), ["Garden"]);
    let q = words(&index, &["plan", "gard"]);
    let fuzzy = Matcher::new(&index, &q, Tier::Similar);
    let out = passages("Garden Plans", "", Lang::En, &fuzzy);
    assert_eq!(marked(&out[0]), ["Garden", "Plans"]);
}

#[test]
fn empty_text() {
    let out = run("", &["basil"], false, false);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].excerpt, "Notes/Trips");
    assert!(out[0].highlights.is_empty());
}

#[test]
fn edit_distance_one() {
    assert!(within_one("rollback", "rollbakc"));
    assert!(within_one("rollback", "rolback"));
    assert!(within_one("rollback", "rollbacks"));
    assert!(within_one("rollback", "rollbock"));
    assert!(!within_one("rollback", "rolbakc"));
    assert!(!within_one("abcd", "badc"));
    assert!(prefix_within_one("gardening", "gard"));
    assert!(prefix_within_one("gardening", "gadr"));
    assert!(!prefix_within_one("gardening", "grdn"));
}

#[test]
fn inline_triple_backticks_do_not_open_a_fence() {
    let text = "```npm i```\n# Setup\nbasil\n~~~x~~~\n# Later\nbasil";
    let out = run(text, &["basil"], false, false);
    let headings: Vec<_> = out.iter().map(|m| m.heading.clone()).collect();
    // "~~~x~~~" does open a fence (a tilde info string may hold tildes),
    // so "# Later" is code.
    assert_eq!(
        headings,
        [Some("Setup".to_string()), Some("Setup".to_string())]
    );
}

#[test]
fn name_only_excerpt_shows_the_whole_name() {
    let index = index();
    let name = format!("{}/Greenhouse", "Projects/Long Folder Name".repeat(5));
    let q = words(&index, &["greenhouse"]);
    let m = Matcher::new(&index, &q, Tier::Exact);
    let out = passages(&name, "nothing to see", Lang::En, &m);
    assert_eq!(out[0].excerpt, name);
    assert_eq!(marked(&out[0]), ["Greenhouse"]);
}

#[test]
fn the_callers_language_is_used() {
    let index = index();
    // "tomaten" stems like "tomaat" only under the Dutch stemmer.
    let q = words(&index, &["tomaat"]);
    let m = Matcher::new(&index, &q, Tier::Exact);
    let text = "tomaten";
    let nl = passages("P", text, Lang::Nl, &m);
    assert_eq!(marked(&nl[0]), ["tomaten"]);
    let en = passages("P", text, Lang::En, &m);
    assert_eq!(en[0].excerpt, "P");
}

#[test]
fn edit_distance_handles_multibyte_chars() {
    assert!(within_one("café", "cafe"));
    assert!(within_one("caféx", "cafxé"));
    assert!(within_one("naïve", "naïv"));
    assert!(!within_one("🌱🌱🌱", "a"));
    assert!(prefix_within_one("über", "üb"));
}

/// 50 pages of ~1 MiB in each tier with 16 words. Debug builds
/// are too slow to be meaningful; run with
/// `cargo test --release -p silverbullet-server-search fulltext::passage -- --ignored --nocapture`.
#[test]
#[ignore]
fn large_pages_are_fast_in_both_tiers() {
    let index = index();
    let mut seed = 0x2545_f491_u64;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let letters: Vec<char> = "abcdefghijklmnoprstuvwy".chars().collect();
    let vocab: Vec<String> = (0..20_000)
        .map(|_| {
            let len = 3 + (next() % 8) as usize;
            (0..len)
                .map(|_| letters[(next() % letters.len() as u64) as usize])
                .collect()
        })
        .collect();
    let query: Vec<String> = (0..16)
        .map(|i| {
            if i % 4 == 3 {
                format!("{}-{}", vocab[i * 7], vocab[i * 11])
            } else {
                vocab[i * 13].clone()
            }
        })
        .collect();
    let q = QueryWords::Words(WordList::new(&index, &query.join(" ")).unwrap());
    let pages: Vec<String> = (0..50)
        .map(|_| {
            let mut page = String::with_capacity(1 << 20);
            while page.len() < (1 << 20) - 64 {
                page.push_str(&vocab[(next() % vocab.len() as u64) as usize]);
                page.push(if next() % 12 == 0 { '\n' } else { ' ' });
            }
            page
        })
        .collect();
    for tier in [Tier::Exact, Tier::Similar] {
        let m = Matcher::new(&index, &q, tier);
        let started = std::time::Instant::now();
        let mut found = 0;
        for (i, page) in pages.iter().enumerate() {
            found += passages(&format!("Page {i}"), page, Lang::En, &m).len();
        }
        let elapsed = started.elapsed();
        eprintln!("50 x 1 MiB pages, {tier:?}: {elapsed:?}, {found} passages");
        if tier == Tier::Similar {
            assert_eq!(found, 150);
        } else {
            assert!(found >= 50, "{found}");
        }
        assert!(elapsed < std::time::Duration::from_secs(3), "{elapsed:?}");
    }
}

mod languages;
