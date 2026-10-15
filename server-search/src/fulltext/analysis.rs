//! Analyzers, tokenization and language detection for the full-text index.
//! Ported from the search evaluation (`base_analyzer`, `stem_analyzer`,
//! `detect_lang`), with [`SbTokenizer`] for Tantivy's simple tokenizer (CJK
//! text as bigrams): tokens over 40 bytes dropped, lowercase, ASCII folding
//! only in the folded fields; stemmed fields add the language's stopwords
//! and stemmer.

use std::ops::Range;
use std::sync::LazyLock;

use tantivy::tokenizer::{
    AsciiFoldingFilter, Language, LowerCaser, RemoveLongFilter, Stemmer, StopWordFilter,
    TextAnalyzer, TextAnalyzerBuilder, TokenStream,
};
use tantivy::Index;

use super::normalize::ArabicNormalizer;
use super::schema::{FOLD_TOKENIZER, RAW_TOKENIZER};
use super::script::is_arabic;
use super::tokenizer::SbTokenizer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Nl,
    De,
    Es,
    Fr,
    Ar,
}

impl Lang {
    pub const COUNT: usize = 6;
    pub const ALL: [Lang; Lang::COUNT] =
        [Lang::En, Lang::Nl, Lang::De, Lang::Es, Lang::Fr, Lang::Ar];

    /// The language's slot in `ALL` (and in every per-language array).
    pub fn idx(self) -> usize {
        self as usize
    }

    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Nl => "nl",
            Lang::De => "de",
            Lang::Es => "es",
            Lang::Fr => "fr",
            Lang::Ar => "ar",
        }
    }

    /// The language whose [`Lang::code`] is `code`, as stored in the index.
    pub fn from_code(code: &str) -> Option<Lang> {
        Lang::ALL.into_iter().find(|l| l.code() == code)
    }

    fn tantivy(self) -> Language {
        match self {
            Lang::En => Language::English,
            Lang::Nl => Language::Dutch,
            Lang::De => Language::German,
            Lang::Es => Language::Spanish,
            Lang::Fr => Language::French,
            Lang::Ar => Language::Arabic,
        }
    }
}

pub(super) fn stem_tokenizer_name(lang: Lang) -> String {
    format!("stem_{}", lang.code())
}

/// One stopword filter per language (indexed by [`Lang::idx`]), built once:
/// the filter clones share their word set.
static STOP_WORDS: LazyLock<[StopWordFilter; Lang::COUNT]> = LazyLock::new(|| {
    Lang::ALL.map(|l| match l {
        // Tantivy has no Arabic list, and Arabic is detected by its script.
        Lang::Ar => StopWordFilter::remove(Vec::<String>::new()),
        _ => StopWordFilter::new(l.tantivy())
            .expect("tantivy's stopwords cover every other language in Lang::ALL"),
    })
});

fn stop_filter(lang: Lang) -> StopWordFilter {
    STOP_WORDS[lang.idx()].clone()
}

fn base_analyzer(arabic: ArabicNormalizer) -> TextAnalyzerBuilder {
    TextAnalyzer::builder(SbTokenizer::default())
        .filter(RemoveLongFilter::limit(40))
        .filter(LowerCaser)
        .filter(arabic)
        .dynamic()
}

fn stem_analyzer(lang: Lang) -> TextAnalyzer {
    base_analyzer(ArabicNormalizer::BEFORE_STEMMING)
        .filter_dynamic(stop_filter(lang))
        .filter_dynamic(Stemmer::new(lang.tantivy()))
        .build()
}

/// Registers `RAW_TOKENIZER` (`sb_raw`), `FOLD_TOKENIZER` (`sb_fold`) and
/// `stem_<l>` on `index`.
pub fn register_tokenizers(index: &Index) {
    let manager = index.tokenizers();
    manager.register(RAW_TOKENIZER, base_analyzer(ArabicNormalizer::FULL).build());
    manager.register(
        FOLD_TOKENIZER,
        base_analyzer(ArabicNormalizer::FULL)
            .filter_dynamic(AsciiFoldingFilter)
            .build(),
    );
    for lang in Lang::ALL {
        manager.register(&stem_tokenizer_name(lang), stem_analyzer(lang));
    }
}

/// Tokens of `text` under the named tokenizer, with byte ranges into `text`.
/// An unregistered tokenizer name yields no tokens.
pub fn tokens(index: &Index, tokenizer: &str, text: &str) -> Vec<(Range<usize>, String)> {
    let Some(mut analyzer) = index.tokenizers().get(tokenizer) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut stream = analyzer.token_stream(text);
    while let Some(t) = stream.next() {
        out.push((t.offset_from..t.offset_to, t.text.clone()));
    }
    out
}

fn count(mut analyzer: TextAnalyzer, text: &str) -> usize {
    let mut s = analyzer.token_stream(text);
    let mut n = 0;
    while s.advance() {
        n += 1;
    }
    n
}

/// Arabic when most of the letters are Arabic script; otherwise the
/// language whose stopword list covers the most tokens, with ties and no
/// matches giving English.
///
/// A page has one language, so Arabic word forms (`مكتبة` finding
/// `المكتبة`) apply only on pages written mostly in Arabic; Arabic passages
/// in a mostly English page get the spelling normalization, not the
/// stemmer. Frontmatter keys count as letters too.
pub fn detect_lang(text: &str) -> Lang {
    if mostly_arabic(text) {
        return Lang::Ar;
    }
    let base = || base_analyzer(ArabicNormalizer::FULL);
    let all = count(base().build(), text);
    let mut best = (Lang::En, 0usize);
    for lang in Lang::ALL.into_iter().filter(|&l| l != Lang::Ar) {
        let stops = all - count(base().filter_dynamic(stop_filter(lang)).build(), text);
        if stops > best.1 {
            best = (lang, stops);
        }
    }
    best.0
}

fn mostly_arabic(text: &str) -> bool {
    let (arabic, letters) = text
        .chars()
        .filter(|c| c.is_alphabetic())
        .fold((0usize, 0usize), |(a, n), c| {
            (a + usize::from(is_arabic(c)), n + 1)
        });
    arabic * 2 > letters
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fulltext::schema::schema;

    fn index() -> Index {
        let (schema, _) = schema();
        let index = Index::create_in_ram(schema);
        register_tokenizers(&index);
        index
    }

    fn stems(index: &Index, lang: Lang, text: &str) -> Vec<String> {
        tokens(index, &stem_tokenizer_name(lang), text)
            .into_iter()
            .map(|(_, t)| t)
            .collect()
    }

    /// Whether `word` (any case) is a stopword of `lang`.
    fn is_stopword(lang: Lang, word: &str) -> bool {
        let lower = word.to_lowercase();
        let base = || base_analyzer(ArabicNormalizer::FULL);
        let all = count(base().build(), &lower);
        all > 0 && count(base().filter_dynamic(stop_filter(lang)).build(), &lower) == 0
    }

    #[test]
    fn lang_idx_is_the_position_in_all() {
        for (i, lang) in Lang::ALL.into_iter().enumerate() {
            assert_eq!(lang.idx(), i);
        }
    }

    #[test]
    fn lang_codes_round_trip() {
        for lang in Lang::ALL {
            assert_eq!(Lang::from_code(lang.code()), Some(lang));
        }
        assert_eq!(Lang::from_code("xx"), None);
        assert_eq!(Lang::from_code(""), None);
    }

    #[test]
    fn detects_languages() {
        assert_eq!(
            detect_lang("the cat is on the table and it is happy"),
            Lang::En
        );
        assert_eq!(
            detect_lang("de kat zit op de tafel en het is een mooie dag"),
            Lang::Nl
        );
        assert_eq!(
            detect_lang("der Hund ist auf dem Tisch und das ist ein schöner Tag"),
            Lang::De
        );
        assert_eq!(
            detect_lang("el gato está en la mesa y es un día muy bonito"),
            Lang::Es
        );
        assert_eq!(
            detect_lang("le chat est sur la table et c'est une belle journée"),
            Lang::Fr
        );
        assert_eq!(detect_lang(""), Lang::En);
    }

    #[test]
    fn ranges_slice_back_after_emoji_and_crlf() {
        let index = index();
        let text = "Hello 🌱 garden\r\nSecond line café";
        let toks = tokens(&index, RAW_TOKENIZER, text);
        assert!(!toks.is_empty());
        for (range, tok) in &toks {
            assert_eq!(text[range.clone()].to_lowercase(), *tok);
        }
        let words: Vec<_> = toks.iter().map(|(_, t)| t.as_str()).collect();
        assert_eq!(words, ["hello", "garden", "second", "line", "café"]);
    }

    #[test]
    fn stems_match_singulars() {
        let index = index();
        assert_eq!(
            stems(&index, Lang::En, "bikes"),
            stems(&index, Lang::En, "bike")
        );
        assert_eq!(
            stems(&index, Lang::De, "Fahrräder"),
            stems(&index, Lang::De, "Fahrrad")
        );
        assert_eq!(
            stems(&index, Lang::Nl, "tomaten"),
            stems(&index, Lang::Nl, "tomaat")
        );
    }

    #[test]
    fn stopwords_only_in_their_language() {
        let index = index();
        assert!(stems(&index, Lang::En, "the").is_empty());
        assert!(!stems(&index, Lang::Nl, "the").is_empty());
        assert!(stems(&index, Lang::Nl, "het").is_empty());
        assert!(is_stopword(Lang::En, "The"));
        assert!(!is_stopword(Lang::En, "het"));
        assert!(is_stopword(Lang::Nl, "het"));
        assert!(!is_stopword(Lang::En, "garden"));
    }

    #[test]
    fn cjk_text_becomes_overlapping_bigrams() {
        let index = index();
        let words: Vec<String> = tokens(&index, RAW_TOKENIZER, "東京タワーの夜景")
            .into_iter()
            .map(|(_, t)| t)
            .collect();
        assert_eq!(
            words,
            ["東京", "京タ", "タワ", "ワー", "ーの", "の夜", "夜景"]
        );
    }

    #[test]
    fn long_cjk_runs_are_indexed() {
        let index = index();
        // 15 characters, 45 bytes: over the 40-byte limit as one token.
        let text = "我们在东京塔看夜景然后去吃拉面";
        assert_eq!(tokens(&index, RAW_TOKENIZER, text).len(), 14);
    }

    #[test]
    fn arabic_forms_share_a_stem() {
        let index = index();
        for (a, b) in [
            ("المكتبة", "مكتبة"),
            ("مكتبه", "مكتبة"),
            ("الحديقة", "حديقة"),
            ("المستشفى", "مستشفي"),
            ("الكِتَابُ", "كتاب"),
        ] {
            assert_eq!(
                stems(&index, Lang::Ar, a),
                stems(&index, Lang::Ar, b),
                "{a} / {b}"
            );
        }
    }

    #[test]
    fn arabic_pages_are_detected_by_script() {
        let arabic = "زار أحمد المكتبة الكبيرة يوم الخميس واستعار كتابين.";
        assert_eq!(detect_lang(arabic).code(), "ar");
        let with_frontmatter = format!("---\ntags: notes\n---\n{arabic}");
        assert_eq!(detect_lang(&with_frontmatter).code(), "ar");
        assert_eq!(detect_lang("the cat is on the table, قطة").code(), "en");
    }
}
