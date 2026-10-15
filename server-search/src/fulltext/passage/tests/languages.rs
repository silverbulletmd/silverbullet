//! Passages across scripts and accents.

use super::*;

#[test]
fn cjk_words_highlight_inside_unspaced_text() {
    let out = run("我们在东京塔看夜景", &["东京塔"], false, false);
    assert_eq!(marked(&out[0]), ["东京塔"]);
    let out = run("学校で勉強した", &["学校"], false, false);
    assert_eq!(marked(&out[0]), ["学校"]);
}

#[test]
fn arabic_highlights_cover_the_written_word() {
    // Harakat inside the highlight, as written.
    let out = run("قرأت المَكْتَبَةُ أمس", &["المكتبة"], false, false);
    assert_eq!(marked(&out[0]), ["المَكْتَبَةُ"]);
    // ة on the page, ه in the query: the same stem.
    let out = run("زار أحمد المكتبة الكبيرة", &["مكتبه"], false, false);
    assert_eq!(marked(&out[0]), ["المكتبة"]);
}

#[test]
fn folded_words_highlight_their_accented_forms() {
    let out = run("Mój żółw śpi zimą.", &["zolw"], false, false);
    assert_eq!(marked(&out[0]), ["żółw"]);
    let out = run(
        "Bake the crème brûlée slowly.",
        &["creme", "brulee"],
        true,
        false,
    );
    assert_eq!(marked(&out[0]), ["crème brûlée"]);
}

#[test]
fn folded_highlights_follow_the_exact_rules() {
    // A stopword next to a content word stays unhighlighted, folded or not.
    let out = run("the café is open", &["the", "cafe"], false, false);
    assert_eq!(marked(&out[0]), ["café"]);
    // Both forms on one line, each marked once.
    let out = run("Café au lait or cafe latte", &["cafe"], false, false);
    assert_eq!(marked(&out[0]), ["Café", "cafe"]);
    // A joined word folds as a sequence.
    let out = run(
        "see the crème-brûlée recipe",
        &["creme-brulee"],
        false,
        false,
    );
    assert_eq!(marked(&out[0]), ["crème-brûlée"]);
}

#[test]
fn accented_queries_highlight_plain_forms() {
    let out = run("Order a cafe latte", &["café"], false, false);
    assert_eq!(marked(&out[0]), ["cafe"]);
    let out = run(
        "Bake the creme brulee slowly.",
        &["crème", "brûlée"],
        true,
        false,
    );
    assert_eq!(marked(&out[0]), ["creme brulee"]);
}

/// A xorshift generator, so the large pages are the same every run.
fn xorshift(mut seed: u64) -> impl FnMut() -> u64 {
    move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    }
}

/// 50 pages of ~1 MiB Chinese text (one token per character).
fn cjk_pages() -> Vec<String> {
    let mut next = xorshift(0x9e37_79b9);
    let chars: Vec<char> = ('\u{4E00}'..='\u{4FFF}').collect();
    (0..50)
        .map(|_| {
            let mut page = String::with_capacity(1 << 20);
            while page.len() < (1 << 20) - 8 {
                page.push(chars[(next() % chars.len() as u64) as usize]);
                match next() % 200 {
                    0 => page.push('\n'),
                    1..=6 => page.push('。'),
                    _ => {}
                }
            }
            page
        })
        .collect()
}

/// 50 pages of ~1 MiB of 20,000 random words of `letters`.
fn word_pages(letters: &str) -> Vec<String> {
    let mut next = xorshift(0x2545_f491);
    let letters: Vec<char> = letters.chars().collect();
    let vocab: Vec<String> = (0..20_000)
        .map(|_| {
            let len = 3 + (next() % 8) as usize;
            (0..len)
                .map(|_| letters[(next() % letters.len() as u64) as usize])
                .collect()
        })
        .collect();
    (0..50)
        .map(|_| {
            let mut page = String::with_capacity(1 << 20);
            while page.len() < (1 << 20) - 64 {
                page.push_str(&vocab[(next() % vocab.len() as u64) as usize]);
                page.push(if next().is_multiple_of(12) { '\n' } else { ' ' });
            }
            page
        })
        .collect()
}

/// Passages for `query` on every page, in under 3 s; how many there are.
fn timed(
    label: &str,
    query: &[&str],
    phrase: bool,
    tier: Tier,
    lang: Lang,
    pages: &[String],
) -> usize {
    let index = index();
    let q = if phrase {
        phrase_words(&index, &query.join(" "))
    } else {
        words(&index, query)
    };
    let m = Matcher::new(&index, &q, tier);
    let started = std::time::Instant::now();
    let found: usize = pages
        .iter()
        .enumerate()
        .map(|(i, page)| passages(&format!("Page {i}"), page, lang, &m).len())
        .sum();
    let elapsed = started.elapsed();
    eprintln!("50 x 1 MiB pages, {label}: {elapsed:?}, {found} passages");
    assert!(
        elapsed < std::time::Duration::from_secs(3),
        "{label}: {elapsed:?}"
    );
    found
}

/// The exact tier on CJK pages, all-CJK and with a single character.
/// Debug builds are too slow to be meaningful; run with
/// `cargo test --release -p silverbullet-server-search fulltext::passage -- --ignored --nocapture`.
#[test]
#[ignore]
fn large_cjk_pages_are_fast() {
    let pages = cjk_pages();
    let q = ["东京塔", "两个", "上下"];
    assert!(timed("CJK, exact", &q, false, Tier::Exact, Lang::En, &pages) >= 50);
    assert!(
        timed(
            "CJK, lone character",
            &["两"],
            false,
            Tier::Exact,
            Lang::En,
            &pages
        ) >= 50
    );
}

/// CJK pages for a query mixing scripts and in the similar tier; pages of
/// accented and of Arabic words. Run as [`large_cjk_pages_are_fast`].
#[test]
#[ignore]
fn large_pages_in_other_scripts_are_fast() {
    let cjk = cjk_pages();
    let mixed = ["iphone", "两个"];
    assert!(
        timed(
            "CJK, mixed, exact",
            &mixed,
            false,
            Tier::Exact,
            Lang::En,
            &cjk
        ) >= 50
    );
    let q = ["东京塔", "两个"];
    assert!(timed("CJK, similar", &q, false, Tier::Similar, Lang::En, &cjk) >= 50);
    let polish = word_pages("abcdeęfghijklłmnoóprsśtuwyzźżą");
    let q = ["zolw", "kot"];
    timed("accented, exact", &q, false, Tier::Exact, Lang::En, &polish);
    timed("accented, phrase", &q, true, Tier::Exact, Lang::En, &polish);
    let arabic = word_pages("ابتثجحخدذرزسشصضطظعغفقكلمنهويةىأإآ");
    let q = ["مكتبة", "كتاب"];
    timed("Arabic, exact", &q, false, Tier::Exact, Lang::Ar, &arabic);
}

#[test]
fn a_single_cjk_character_highlights_inside_bigrams() {
    let out = run("黒猫が好きです。猫は眠い", &["猫"], false, false);
    assert_eq!(marked(&out[0]), ["猫", "猫"]);
    let out = run("我家有一只小猫", &["猫"], true, false);
    assert_eq!(marked(&out[0]), ["猫"]);
}

#[test]
fn mixed_words_highlight_to_the_cjk_character() {
    let out = run("iPhone用のケースを買った", &["iPhone用"], false, false);
    assert_eq!(marked(&out[0]), ["iPhone用"]);
    let out = run("会議は3月14日に決まった", &["3月14日"], true, false);
    assert_eq!(marked(&out[0]), ["3月14日"]);
    let out = run("会議は2026年3月に決まった", &["3月"], false, false);
    assert_eq!(marked(&out[0]), ["3月"]);
    let out = run("新しいiPhoneが届いた", &["いiPhone"], false, false);
    assert_eq!(marked(&out[0]), ["いiPhone"]);
    let out = run("iPhone犬", &["iPhone用"], false, false);
    assert!(out[0].highlights.is_empty());
}

#[test]
fn letters_outside_the_folded_blocks_fold_to_themselves() {
    let index = index();
    let text: String = ('\u{80}'..='\u{3FFFF}')
        .filter(|&c| c.is_alphanumeric() && !may_fold(c))
        .flat_map(|c| [c, ' '])
        .collect();
    let toks = |name: &str| -> Vec<String> {
        tokens(&index, name, &text)
            .into_iter()
            .map(|(_, t)| t)
            .collect()
    };
    assert_eq!(toks(FOLD_TOKENIZER), toks(RAW_TOKENIZER));
}
