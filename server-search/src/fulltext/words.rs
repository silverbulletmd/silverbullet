//! The query's words, analysed once, and the rules for how each word
//! matches a page ([`WordList::alternatives`]): which words are phrases,
//! their stems per language, stopwords literal or merely present, folding
//! only where it can change a token, lone CJK characters inside bigrams,
//! fuzzing only in the similar tier, which parts of a joined word it fuzzes
//! and which may be a name prefix. The plan turns each alternative into
//! clauses and the passage matcher into highlights, so neither restates a
//! rule.

use std::collections::HashSet;

use tantivy::tokenizer::TokenStream;
use tantivy::Index;

use super::analysis::{stem_tokenizer_name, Lang};
use super::schema::{FOLD_TOKENIZER, RAW_TOKENIZER};
use super::script::is_cjk;
use crate::error::SearchError;
use crate::limits;

/// Tokens shorter than this are never fuzzy-matched.
pub const FUZZY_MIN_CHARS: usize = 4;
/// At most this many parts of multi-token words are fuzzed per query (two
/// clauses each, name and body). A part repeated within one word counts
/// once; one repeated in another word counts again, since that word needs
/// it too. Later parts must match exactly. Bounds the Levenshtein automata a
/// long `a-b-c-…` word, or many of them, could otherwise ask for.
pub const MAX_FUZZY_PARTS: usize = limits::MAX_TERMS;

/// A token's position (keeping the gaps of dropped tokens, as in the index)
/// and its text.
pub type Tok = (usize, String);

/// Which tier of a Words query: every word (exact), or any word with typos
/// (similar pages).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Exact,
    Similar,
}

/// Per language ([`Lang::idx`]): whether a rule applies on pages of it.
pub type Langs = [bool; Lang::COUNT];

/// One way a query word may match a page, as [`WordList::alternatives`]
/// decides it. The plan matches a page when any alternative of every word
/// (exact tier) or of some word (similar tier) does; passages highlight the
/// alternatives marked for the page's language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Alt<'w> {
    /// The word's raw tokens, adjacent and in order (one token: itself). A
    /// lone CJK character first or last matches inside the page's bigram
    /// there; alone, inside any bigram. `queried`: the plan matches it in
    /// the raw name and body. `marked`: the languages whose pages highlight
    /// it: a multi-token word and a lone CJK character everywhere; another
    /// single token only where it is a stopword matched literally (elsewhere
    /// its stem marks the tokens it matches).
    Raw {
        toks: &'w [Tok],
        queried: bool,
        marked: Langs,
    },
    /// The word's stem in `lang`, in the stemmed name and body. `fuzzy`:
    /// also at edit distance 1; `name_prefix`: also a fuzzy prefix of the
    /// name. `marked`: passages highlight it (a lone CJK character is marked
    /// by its [`Alt::Raw`]); `scanned`: a CJK word, compared with the page's
    /// raw tokens, as stemmers leave it alone.
    Stem {
        lang: Lang,
        term: &'w str,
        fuzzy: bool,
        name_prefix: bool,
        marked: bool,
        scanned: bool,
    },
    /// A stopword in `lang` while another query word isn't one there:
    /// present on every page of that language (score 0), not highlighted.
    Present(Lang),
    /// Exact tier: the word with accents folded, ranked after the exact
    /// matches. `queried`: folding can change one of its tokens (not all
    /// CJK). `marked`: the languages whose pages highlight it, under the
    /// stopword rule of [`Alt::Raw`] and [`Alt::Present`].
    Folded { queried: bool, marked: Langs },
    /// Similar tier, a multi-token word: all its parts
    /// ([`WordList::parts_of`]), anywhere.
    Parts,
}

/// Whether folding accents can match `toks` anywhere the raw tokens don't:
/// not when they are all CJK, which folding leaves alone, so the folded
/// fields hold the same terms.
pub fn may_fold(toks: &[Tok]) -> bool {
    toks.iter().any(|(_, t)| !starts_cjk(t))
}

fn starts_cjk(t: &str) -> bool {
    t.chars().next().is_some_and(is_cjk)
}

/// Whether `t` may match at edit distance 1: long enough, and no digits.
pub fn fuzzy_ok(t: &str) -> bool {
    t.chars().count() >= FUZZY_MIN_CHARS && !t.chars().any(char::is_numeric)
}

/// The character of a one-character CJK token. CJK text is indexed as
/// two-character tokens, so such a word is matched inside them.
pub fn lone_cjk(t: &str) -> Option<char> {
    let mut chars = t.chars();
    let c = chars.next().filter(|&c| is_cjk(c))?;
    chars.next().is_none().then_some(c)
}

/// Every token the named tokenizer makes of `text`.
fn analyze(index: &Index, tokenizer: &str, text: &str) -> Vec<Tok> {
    let Some(mut analyzer) = index.tokenizers().get(tokenizer) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut stream = analyzer.token_stream(text);
    while let Some(t) = stream.next() {
        out.push((t.position, t.text.clone()));
    }
    out
}

/// Phrase mode's tokens of `query` (validated and trimmed).
#[cfg(test)]
pub fn phrase_tokens(index: &Index, query: &str) -> Vec<Tok> {
    analyze(index, RAW_TOKENIZER, query)
}

/// Phrase mode's words of `query` (validated and trimmed).
pub fn phrase_words(index: &Index, query: &str) -> QueryWords {
    QueryWords::Phrase {
        raw: analyze(index, RAW_TOKENIZER, query),
        folded: analyze(index, FOLD_TOKENIZER, query),
    }
}

/// How one query word analyses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WordKind {
    /// Several raw tokens (`F-31`, `ERR_TLS_412`, `attic-net`), matched
    /// adjacent and in order.
    Seq(Vec<Tok>),
    /// One raw token, and its stem per language (indexed by [`Lang::idx`]),
    /// `None` where it is a stopword.
    Single {
        raw: Tok,
        stems: [Option<String>; Lang::COUNT],
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Word {
    /// The word as typed.
    pub text: String,
    pub kind: WordKind,
    /// Its tokens with accents folded, at the raw tokens' positions.
    pub folded: Vec<Tok>,
}

/// One distinct part of a multi-token word, as the similar tier matches it:
/// a page must have every part of the word, anywhere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Part {
    /// The word's index in [`WordList::words`].
    pub word: usize,
    pub text: String,
    /// Matched at edit distance 1; otherwise exactly (too short, digits, or
    /// past [`MAX_FUZZY_PARTS`]).
    pub fuzzy: bool,
    /// Also a fuzzy prefix of the page name: the last word's last distinct
    /// part when [`fuzzy_ok`], past the cap too. What the user is still typing.
    pub prefix: bool,
}

/// Words mode's words: distinct (case-insensitively), in query order,
/// without words that have no token (punctuation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordList {
    pub words: Vec<Word>,
    /// The similar-tier parts of every `Seq` word, in word order.
    pub parts: Vec<Part>,
}

/// The query's words, analysed once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryWords {
    /// Phrase mode: the phrase's raw tokens, and the same folded.
    Phrase {
        raw: Vec<Tok>,
        folded: Vec<Tok>,
    },
    Words(WordList),
}

impl WordList {
    /// The words of `query` (validated and trimmed). More than
    /// [`limits::MAX_TERMS`] distinct words is `Invalid`.
    pub fn new(index: &Index, query: &str) -> Result<WordList, SearchError> {
        let mut seen = HashSet::new();
        let distinct: Vec<&str> = query
            .split_whitespace()
            .filter(|w| seen.insert(w.to_lowercase()))
            .collect();
        if distinct.len() > limits::MAX_TERMS {
            return Err(SearchError::Invalid(format!(
                "Search for at most {} words",
                limits::MAX_TERMS
            )));
        }
        let words: Vec<Word> = distinct
            .into_iter()
            .filter_map(|w| analyse_word(index, w))
            .collect();
        let parts = similar_parts(&words);
        Ok(WordList { words, parts })
    }

    /// Per language ([`Lang::idx`]): whether some word is not a stopword
    /// there (a multi-token word never is). Where none is, stopwords match
    /// literally; elsewhere they only count as present.
    pub fn content_langs(&self) -> [bool; Lang::COUNT] {
        Lang::ALL.map(|lang| {
            self.words.iter().any(|w| match &w.kind {
                WordKind::Seq(_) => true,
                WordKind::Single { stems, .. } => stems[lang.idx()].is_some(),
            })
        })
    }

    /// Whether word `i` is the last one (fuzzy name prefixes apply to it).
    pub fn is_last(&self, i: usize) -> bool {
        i + 1 == self.words.len()
    }

    /// The similar-tier parts of word `i`.
    pub fn parts_of(&self, i: usize) -> impl Iterator<Item = &Part> {
        self.parts.iter().filter(move |p| p.word == i)
    }

    /// How word `i` may match in `tier`, in the order the plan's clauses
    /// take: its raw tokens, then per language its stem or its presence,
    /// then (similar tier) its parts, or (exact tier) its folded tokens.
    pub fn alternatives(&self, i: usize, tier: Tier) -> Vec<Alt<'_>> {
        let word = &self.words[i];
        let exact = tier == Tier::Exact;
        // Where some word is not a stopword, stopwords only count as
        // present; elsewhere they match literally.
        let content = self.content_langs();
        let mut out = Vec::new();
        match &word.kind {
            WordKind::Seq(toks) => {
                out.push(Alt::Raw {
                    toks,
                    queried: true,
                    marked: [true; Lang::COUNT],
                });
                if !exact {
                    out.push(Alt::Parts);
                }
            }
            WordKind::Single { raw, stems } => {
                let lone = lone_cjk(&raw.1).is_some();
                // A word that literally appears in a page always matches it
                // in the exact tier. In the similar tier a stopword of any
                // language has no literal alternative, or "the quantum"
                // would fall back to every English page.
                out.push(Alt::Raw {
                    toks: std::slice::from_ref(raw),
                    queried: exact || stems.iter().all(Option::is_some),
                    marked: Lang::ALL
                        .map(|l| lone || (stems[l.idx()].is_none() && !content[l.idx()])),
                });
                for lang in Lang::ALL {
                    let l = lang.idx();
                    match &stems[l] {
                        // "the bike" keeps English pages for "the"; alone,
                        // "the" (or "die" for German) would match every page
                        // of the language.
                        None if exact && content[l] => out.push(Alt::Present(lang)),
                        None => {}
                        Some(term) => {
                            let fuzzy = !exact && fuzzy_ok(term);
                            out.push(Alt::Stem {
                                lang,
                                term,
                                fuzzy,
                                name_prefix: fuzzy && self.is_last(i),
                                marked: !lone,
                                scanned: starts_cjk(&raw.1),
                            });
                        }
                    }
                }
            }
        }
        if exact {
            // Folding never makes or changes CJK.
            let marked = match &word.kind {
                WordKind::Single { raw: (_, r), stems } => Lang::ALL
                    .map(|l| !starts_cjk(r) && (stems[l.idx()].is_some() || !content[l.idx()])),
                WordKind::Seq(_) => [may_fold(&word.folded); Lang::COUNT],
            };
            out.push(Alt::Folded {
                queried: may_fold(&word.folded),
                marked,
            });
        }
        out
    }
}

/// `None` for a word without tokens (punctuation).
fn analyse_word(index: &Index, word: &str) -> Option<Word> {
    let mut raw = analyze(index, RAW_TOKENIZER, word);
    let kind = if raw.len() > 1 {
        WordKind::Seq(raw)
    } else {
        let raw = raw.pop()?;
        let stems = Lang::ALL.map(|lang| {
            analyze(index, &stem_tokenizer_name(lang), word)
                .into_iter()
                .next()
                .map(|(_, t)| t)
        });
        WordKind::Single { raw, stems }
    };
    Some(Word {
        text: word.to_string(),
        kind,
        folded: analyze(index, FOLD_TOKENIZER, word),
    })
}

/// The parts of every multi-token word: each distinct within its word; the
/// first [`MAX_FUZZY_PARTS`] that [`fuzzy_ok`] fuzzed, counted over all
/// words; the last word's last part a name prefix.
fn similar_parts(words: &[Word]) -> Vec<Part> {
    let last = words.len().saturating_sub(1);
    let mut fuzzed = 0;
    let mut out = Vec::new();
    for (i, word) in words.iter().enumerate() {
        let WordKind::Seq(toks) = &word.kind else {
            continue;
        };
        let mut seen = HashSet::new();
        let distinct: Vec<&str> = toks
            .iter()
            .map(|(_, t)| t.as_str())
            .filter(|t| seen.insert(*t))
            .collect();
        let tail = distinct.len().saturating_sub(1);
        for (k, t) in distinct.into_iter().enumerate() {
            let fuzzy = fuzzy_ok(t) && fuzzed < MAX_FUZZY_PARTS;
            if fuzzy {
                fuzzed += 1;
            }
            out.push(Part {
                word: i,
                text: t.to_string(),
                fuzzy,
                prefix: i == last && k == tail && fuzzy_ok(t),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fulltext::analysis::register_tokenizers;
    use crate::fulltext::schema::schema;

    fn index() -> Index {
        let index = Index::create_in_ram(schema().0);
        register_tokenizers(&index);
        index
    }

    /// `(word, text, fuzzy, prefix)` of every part.
    fn parts(q: &str) -> Vec<(usize, String, bool, bool)> {
        WordList::new(&index(), q)
            .unwrap()
            .parts
            .into_iter()
            .map(|p| (p.word, p.text, p.fuzzy, p.prefix))
            .collect()
    }

    #[test]
    fn a_part_repeated_in_another_word_belongs_to_both() {
        assert_eq!(
            parts("abcd-wxyz wxyz-abcd"),
            [
                (0, "abcd".to_string(), true, false),
                (0, "wxyz".to_string(), true, false),
                (1, "wxyz".to_string(), true, false),
                (1, "abcd".to_string(), true, true),
            ]
        );
    }

    #[test]
    fn the_fuzz_cap_counts_every_words_parts() {
        let first = "amber-birch-cedar-delta-ember-fjord-grove-heron-iris-juniper";
        let second = format!("{first}-kestrel-lilac-maple-nettle-orchid-quartz");
        let all = parts(&format!("{first} {second}"));
        assert_eq!(all.iter().filter(|p| p.2).count(), MAX_FUZZY_PARTS);
        let fuzzed: Vec<&str> = all
            .iter()
            .filter(|p| p.0 == 1 && p.2)
            .map(|p| p.1.as_str())
            .collect();
        assert_eq!(
            fuzzed,
            ["amber", "birch", "cedar", "delta", "ember", "fjord"]
        );
        assert!(
            all.iter().any(|p| p.1 == "quartz" && !p.2 && p.3),
            "past the cap, but still the name prefix"
        );
    }

    #[test]
    fn the_name_prefix_is_the_last_distinct_part_of_the_last_word() {
        let prefixes = |q: &str| -> Vec<String> {
            parts(q).into_iter().filter(|p| p.3).map(|p| p.1).collect()
        };
        assert_eq!(prefixes("abcd-wxyz-abcd"), ["wxyz"]);
        assert!(prefixes("atic-net").is_empty(), "too short");
        assert!(
            prefixes("tailpiece-net plain").is_empty(),
            "not the last word"
        );
    }

    #[test]
    fn words_are_distinct_have_tokens_and_are_bounded() {
        let index = index();
        let list = WordList::new(&index, "Bike bike ?! chain").unwrap();
        let texts: Vec<&str> = list.words.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["Bike", "chain"]);
        let many: Vec<String> = (0..=limits::MAX_TERMS).map(|i| format!("w{i}")).collect();
        assert!(matches!(
            WordList::new(&index, &many.join(" ")),
            Err(SearchError::Invalid(_))
        ));
        let toks: Vec<String> = phrase_tokens(&index, "on and on")
            .into_iter()
            .map(|(_, t)| t)
            .collect();
        assert_eq!(toks, ["on", "and", "on"]);
    }

    #[test]
    fn content_languages_follow_the_stopwords_of_each_language() {
        let index = index();
        let list = WordList::new(&index, "the bike").unwrap();
        assert!(list.content_langs()[Lang::En.idx()]);
        let list = WordList::new(&index, "the").unwrap();
        assert!(!list.content_langs()[Lang::En.idx()]);
        assert!(
            list.content_langs()[Lang::Nl.idx()],
            "\"the\" is no Dutch stopword"
        );
    }
}
