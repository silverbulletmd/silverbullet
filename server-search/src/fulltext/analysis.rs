//! Analyzers, tokenization and language detection for the full-text index.
//! Ported from the search evaluation (`base_analyzer`, `stem_analyzer`,
//! `detect_lang`): simple tokenizer, tokens over 40 bytes dropped, lowercase,
//! no ASCII folding; stemmed fields add the language's stopwords and stemmer.

use std::ops::Range;
use std::sync::LazyLock;

use tantivy::tokenizer::{
    Language, LowerCaser, RemoveLongFilter, SimpleTokenizer, Stemmer, StopWordFilter, TextAnalyzer,
    TextAnalyzerBuilder, TokenStream,
};
use tantivy::Index;

use super::RAW_TOKENIZER;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Nl,
    De,
    Es,
    Fr,
}

impl Lang {
    pub const ALL: [Lang; 5] = [Lang::En, Lang::Nl, Lang::De, Lang::Es, Lang::Fr];

    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Nl => "nl",
            Lang::De => "de",
            Lang::Es => "es",
            Lang::Fr => "fr",
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
        }
    }
}

pub(super) fn stem_tokenizer_name(lang: Lang) -> String {
    format!("stem_{}", lang.code())
}

/// One stopword filter per language (`Lang::ALL` order), built once: the
/// filter clones share their word set.
static STOP_WORDS: LazyLock<[Option<StopWordFilter>; 5]> =
    LazyLock::new(|| Lang::ALL.map(|l| StopWordFilter::new(l.tantivy())));

fn stop_filter(lang: Lang) -> Option<StopWordFilter> {
    let i = Lang::ALL.iter().position(|l| *l == lang)?;
    STOP_WORDS[i].clone()
}

fn base_analyzer() -> TextAnalyzerBuilder {
    TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(RemoveLongFilter::limit(40))
        .filter(LowerCaser)
        .dynamic()
}

fn stem_analyzer(lang: Lang) -> TextAnalyzer {
    let mut b = base_analyzer();
    if let Some(stop) = stop_filter(lang) {
        b = b.filter_dynamic(stop);
    }
    b.filter_dynamic(Stemmer::new(lang.tantivy())).build()
}

/// Registers `RAW_TOKENIZER` (`sb_raw`) and `stem_<l>` on `index`.
pub fn register_tokenizers(index: &Index) {
    let manager = index.tokenizers();
    manager.register(RAW_TOKENIZER, base_analyzer().build());
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

/// The language whose stopword list covers the most tokens; ties and no
/// matches give English.
pub fn detect_lang(text: &str) -> Lang {
    let all = count(base_analyzer().build(), text);
    let mut best = (Lang::En, 0usize);
    for lang in Lang::ALL {
        let Some(stop) = stop_filter(lang) else {
            continue;
        };
        let stops = all - count(base_analyzer().filter_dynamic(stop).build(), text);
        if stops > best.1 {
            best = (lang, stops);
        }
    }
    best.0
}

/// Whether `word` (already lowercase or not) is a stopword of `lang`.
pub fn is_stopword(lang: Lang, word: &str) -> bool {
    let Some(stop) = stop_filter(lang) else {
        return false;
    };
    let lower = word.to_lowercase();
    let all = count(base_analyzer().build(), &lower);
    all > 0 && count(base_analyzer().filter_dynamic(stop).build(), &lower) == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fulltext::schema;

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
}
