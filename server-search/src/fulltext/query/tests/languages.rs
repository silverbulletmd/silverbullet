//! Words mode across scripts and accents: CJK text without spaces, Arabic
//! spelling and word forms, accent-folded matches.

use super::*;

fn with(pages: &[(&str, &str)]) -> Fixture {
    let pages: Vec<(String, String)> = pages
        .iter()
        .map(|(p, t)| (p.to_string(), t.to_string()))
        .collect();
    fixture(&pages)
}

/// What [`Fixture::words`] gives when the exact tier finds `paths`, in order.
fn exact(paths: &[&str]) -> (Vec<String>, Tier) {
    (paths.iter().map(|p| p.to_string()).collect(), Tier::Exact)
}

const LIBRARY: (&str, &str) = (
    "Books/Neighbourhood library.md",
    "زار أحمد المكتبة الكبيرة يوم الخميس، ثم ذهب إلى المستشفى.",
);

#[test]
fn cjk_words_match_inside_unspaced_text() {
    let fx = with(&[
        (
            "Travel/Tokyo night.md",
            "我们在东京塔看夜景，然后去吃拉面。",
        ),
        ("Notes/Hakgyo.md", "학교에서 친구와 공부했다."),
        ("Shop/Case.md", "iPhone用のケースを買った。"),
    ]);
    assert_eq!(fx.words("东京塔"), exact(&["Travel/Tokyo night.md"]));
    assert_eq!(fx.words("拉面"), exact(&["Travel/Tokyo night.md"]));
    assert_eq!(fx.words("학교"), exact(&["Notes/Hakgyo.md"]));
    assert_eq!(fx.words("iphone ケース"), exact(&["Shop/Case.md"]));
}

#[test]
fn long_cjk_runs_are_searchable() {
    let fx = with(&[(
        "Notes/Walk.md",
        "今天早上我们一起去公园散步然后在湖边喝了咖啡",
    )]);
    assert_eq!(fx.words("湖边"), exact(&["Notes/Walk.md"]));
}

#[test]
fn arabic_spelling_variants_match_in_the_exact_tier() {
    let fx = with(&[LIBRARY]);
    // Hamza on the alef, ة/ه, harakat, tatweel, ى/ي.
    for q in ["احمد", "مكتبه", "المَكْتَبَة", "المكتـــبة", "المستشفي"]
    {
        assert_eq!(fx.words(q), exact(&[LIBRARY.0]), "{q}");
    }
}

#[test]
fn arabic_word_forms_match_by_stem() {
    let fx = with(&[
        LIBRARY,
        ("Garden/Backyard.md", "جلسنا في حديقة صغيرة خلف البيت."),
    ]);
    assert_eq!(fx.words("مكتبة"), exact(&[LIBRARY.0]));
    assert_eq!(fx.words("الحديقة"), exact(&["Garden/Backyard.md"]));
}

#[test]
fn accents_fold_after_exact_matches() {
    let fx = with(&[
        ("Pets/Żółw.md", "Mój żółw śpi zimą w piwnicy."),
        ("Notes/Cafe hours.md", "The cafe opens at nine."),
        ("Notes/Café list.md", "The café on the corner serves tea."),
    ]);
    assert_eq!(fx.words("zolw"), exact(&["Pets/Żółw.md"]));
    assert_eq!(
        fx.words("cafe"),
        exact(&["Notes/Cafe hours.md", "Notes/Café list.md"])
    );
    assert_eq!(
        fx.words("café"),
        exact(&["Notes/Café list.md", "Notes/Cafe hours.md"])
    );
}

#[test]
fn queries_of_only_arabic_marks_find_nothing() {
    let fx = with(&[LIBRARY]);
    assert_eq!(fx.words("ـــــ"), (vec![], Tier::Exact));
    assert_eq!(fx.phrase("ـــــ"), Vec::<String>::new());
}

#[test]
fn a_single_cjk_character_is_a_word() {
    let fx = with(&[
        ("Pets/Kuro.md", "黒猫が好きです。"),
        ("Pets/Xiaomao.md", "我家有一只小猫"),
        ("Pets/Dogs.md", "犬と散歩した。"),
    ]);
    let sorted = |mut v: Vec<String>| {
        v.sort();
        v
    };
    let (found, tier) = fx.words("猫");
    assert_eq!(tier, Tier::Exact);
    assert_eq!(sorted(found), ["Pets/Kuro.md", "Pets/Xiaomao.md"]);
    assert_eq!(sorted(fx.phrase("猫")), ["Pets/Kuro.md", "Pets/Xiaomao.md"]);
    assert_eq!(fx.words("犬").0, ["Pets/Dogs.md"]);
}

#[test]
fn a_page_with_both_forms_counts_once() {
    let fx = with(&[("Notes/Menu.md", "Café au lait, or a plain cafe latte.")]);
    assert_eq!(fx.words("cafe"), exact(&["Notes/Menu.md"]));
    assert_eq!(fx.words("café"), exact(&["Notes/Menu.md"]));
}

#[test]
fn every_word_may_match_exactly_or_folded() {
    let fx = with(&[
        ("Travel/Station.md", "A crème brûlée near the station."),
        ("Travel/Hotel.md", "Creme brulee at the hotel."),
    ]);
    let (mut found, tier) = fx.words("crème brulee");
    found.sort();
    assert_eq!(tier, Tier::Exact);
    assert_eq!(found, ["Travel/Hotel.md", "Travel/Station.md"]);
}

#[test]
fn exact_matches_fill_the_limit_first() {
    let fx = with(&[
        ("Notes/Cafe hours.md", "The cafe opens at nine."),
        ("Notes/Café list.md", "The café on the corner serves tea."),
    ]);
    let plan = test_plan(&fx, QueryMode::Words, "cafe", &none()).unwrap();
    let Outcome { hits, total, tier } = run(&fx.searcher, &fx.fields, &plan, 1).unwrap();
    let paths: Vec<_> = hits.into_iter().map(|h| h.path).collect();
    assert_eq!(
        (paths, total, tier),
        (vec!["Notes/Cafe hours.md".to_string()], 2, Tier::Exact)
    );
}

#[test]
fn the_folded_pass_keeps_to_the_filter() {
    let fx = with(&[
        ("Notes/Cafe hours.md", "The cafe opens at nine."),
        ("Notes/Café list.md", "The café on the corner serves tea."),
    ]);
    let filter = PageFilter {
        exclude: Some(vec!["Notes/Café list".to_string()]),
        ..PageFilter::default()
    };
    assert_eq!(
        fx.words_with("cafe", &filter),
        exact(&["Notes/Cafe hours.md"])
    );
}

#[test]
fn phrases_fold_accents_after_exact_matches() {
    let fx = with(&[
        ("Kitchen/Dessert.md", "Bake the crème brûlée slowly."),
        ("Kitchen/Notes.md", "A creme brulee needs a torch."),
    ]);
    assert_eq!(
        fx.phrase("crème brûlée"),
        ["Kitchen/Dessert.md", "Kitchen/Notes.md"]
    );
    assert_eq!(
        fx.phrase("creme brulee"),
        ["Kitchen/Notes.md", "Kitchen/Dessert.md"]
    );
    assert_eq!(fx.phrase("brulee creme"), Vec::<String>::new());
}

#[test]
fn fullwidth_letters_fold_to_ascii() {
    let fx = with(&[("Work/Meeting.md", "ＡＢＣ商事の会議は三時から")]);
    assert_eq!(fx.words("abc"), exact(&["Work/Meeting.md"]));
}

#[test]
fn joined_words_fold_accents_after_exact_matches() {
    let fx = with(&[
        ("Notes/Corner.md", "Meet at the café-bar on the corner."),
        ("Notes/Square.md", "Meet at the cafe-bar on the square."),
    ]);
    assert_eq!(
        fx.words("cafe-bar"),
        exact(&["Notes/Square.md", "Notes/Corner.md"])
    );
    assert_eq!(
        fx.words("café-bar"),
        exact(&["Notes/Corner.md", "Notes/Square.md"])
    );
}

#[test]
fn mixed_words_match_where_the_cjk_text_goes_on() {
    let fx = with(&[
        ("Shop/Case.md", "iPhone用のケースを買った。"),
        ("Plans/March.md", "会議は2026年3月に決まった。"),
        ("Plans/Date.md", "会議は3月14日に決まった。"),
        ("Shop/Phone.md", "新しいiPhoneが届いた。"),
    ]);
    let sorted = |mut v: Vec<String>| {
        v.sort();
        v
    };
    assert_eq!(fx.words("iPhone用"), exact(&["Shop/Case.md"]));
    assert_eq!(fx.phrase("iPhone用"), ["Shop/Case.md"]);
    for q in ["14日", "3月14日"] {
        assert_eq!(fx.words(q), exact(&["Plans/Date.md"]), "{q}");
        assert_eq!(fx.phrase(q), ["Plans/Date.md"], "{q}");
    }
    let (found, tier) = fx.words("3月");
    assert_eq!(tier, Tier::Exact);
    assert_eq!(sorted(found), ["Plans/Date.md", "Plans/March.md"]);
    assert_eq!(
        sorted(fx.phrase("3月")),
        ["Plans/Date.md", "Plans/March.md"]
    );
    // A lone character first: the page's bigram ends with it.
    assert_eq!(fx.words("いiPhone"), exact(&["Shop/Phone.md"]));
    // The edge still has to be there.
    assert_eq!(fx.phrase("iPhone用の"), ["Shop/Case.md"]);
    assert_eq!(fx.phrase("iPhone犬"), Vec::<String>::new());
}
