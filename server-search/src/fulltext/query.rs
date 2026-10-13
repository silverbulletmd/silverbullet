//! Query plans for the full-text index, ported from the search evaluation's
//! `tantivy-stem-and-or-fuzzy` builder.
//!
//! Words mode has two tiers. The exact tier requires every word (AND); a word
//! matches its stem in the page's language or, literally, its unstemmed
//! token, and a word that is a stopword in a page's language counts as present
//! for that page when another query word is not. When it finds nothing, the
//! similar tier matches any word (OR), with edit distance 1 on longer tokens
//! and a fuzzy prefix of the last word on names. Phrase mode is one phrase
//! query on the unstemmed fields, with no fallback. Both modes are limited to
//! the request's scope (the page `kind`) and its include/exclude lists.

use std::collections::HashSet;

use tantivy::collector::{Count, TopDocs};
use tantivy::query::{
    BooleanQuery, BoostQuery, ConstScoreQuery, EmptyQuery, FuzzyTermQuery, Occur, PhraseQuery,
    Query, TermQuery, TermSetQuery,
};
use tantivy::schema::{Field, IndexRecordOption, Value};
use tantivy::tokenizer::TokenStream;
use tantivy::{Index, Searcher, TantivyDocument, Term};

use super::analysis::stem_tokenizer_name;
use super::{Fields, KIND_CONTENT, KIND_META, RAW_TOKENIZER};
use crate::error::SearchError;
use crate::limits;
use crate::types::SearchScope;

/// Score multiplier for a match in the page name.
pub const NAME_BOOST: f32 = 2.0;
/// Tokens shorter than this are never fuzzy-matched.
pub const FUZZY_MIN_CHARS: usize = 4;
/// At most this many distinct components of multi-token words are fuzzed
/// per query (two clauses each, name and body); later ones match only
/// through their word's phrase. Bounds the Levenshtein automata a single
/// long `a-b-c-…` word could otherwise ask for.
pub const MAX_FUZZY_PARTS: usize = limits::MAX_TERMS;

/// Which tier answered a query.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Exact,
    Similar,
}

/// Limits a query to some pages: those of `scope`, and of those, the ones
/// `include` names and `exclude` doesn't. Names are page names without `.md`.
#[derive(Debug, Clone, Default)]
pub struct PageFilter {
    pub scope: SearchScope,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
}

pub struct Plan {
    pub exact: Box<dyn Query>,
    /// The fallback run when `exact` matches no page; `None` for phrases.
    pub similar: Option<Box<dyn Query>>,
    /// The query words to highlight, in query order: for Words the distinct
    /// words that have any token, for Phrase the phrase's words.
    pub words: Vec<String>,
}

/// `(position, text)` of every token the named tokenizer makes of `text`.
/// Positions keep the gaps of dropped tokens, as in the index.
fn analyze(index: &Index, tokenizer: &str, text: &str) -> Vec<(usize, String)> {
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

fn fuzzy_ok(t: &str) -> bool {
    t.chars().count() >= FUZZY_MIN_CHARS && !t.chars().any(char::is_numeric)
}

fn boosted(q: impl Query, boost: f32) -> (Occur, Box<dyn Query>) {
    (Occur::Should, Box::new(BoostQuery::new(Box::new(q), boost)))
}

fn fuzzy(field: Field, t: &str) -> FuzzyTermQuery {
    FuzzyTermQuery::new(Term::from_field_text(field, t), 1, true)
}

fn fuzzy_prefix(field: Field, t: &str) -> (Occur, Box<dyn Query>) {
    let q = FuzzyTermQuery::new_prefix(Term::from_field_text(field, t), 1, true);
    (Occur::Should, Box::new(q))
}

/// Phrase (or, for one token, term) clauses for `toks` on the raw name
/// (boosted) and body fields.
fn raw_clauses(f: &Fields, toks: &[(usize, String)]) -> Vec<(Occur, Box<dyn Query>)> {
    let mut out = Vec::new();
    let Some(first) = toks.first().map(|(p, _)| *p) else {
        return out;
    };
    for (field, boost) in [(f.name_raw, NAME_BOOST), (f.body_raw, 1.0)] {
        if toks.len() == 1 {
            let term = Term::from_field_text(field, &toks[0].1);
            out.push(boosted(
                TermQuery::new(term, IndexRecordOption::WithFreqs),
                boost,
            ));
        } else {
            let terms = toks
                .iter()
                .map(|(p, t)| (p - first, Term::from_field_text(field, t)))
                .collect();
            out.push(boosted(PhraseQuery::new_with_offset(terms), boost));
        }
    }
    out
}

/// How one word analyses: several raw tokens (a phrase), or its one raw
/// token and per language (`Lang::ALL` order) its stemmed token, `None` where
/// it is a stopword.
enum Analysed {
    Phrase(Vec<(usize, String)>),
    Stems {
        raw: (usize, String),
        stems: Vec<Option<String>>,
    },
}

/// `None` for a word without tokens (punctuation).
fn analyse_word(index: &Index, f: &Fields, word: &str) -> Option<Analysed> {
    let mut raw = analyze(index, RAW_TOKENIZER, word);
    if raw.len() > 1 {
        return Some(Analysed::Phrase(raw));
    }
    let raw = raw.pop()?;
    let stems = f
        .name_stem
        .iter()
        .map(|(lang, _)| {
            analyze(index, &stem_tokenizer_name(*lang), word)
                .into_iter()
                .next()
                .map(|(_, t)| t)
        })
        .collect();
    Some(Analysed::Stems { raw, stems })
}

/// One clause per word, matching it in any language's fields:
/// - several tokens (`F-31`, `ERR_TLS_412`, `attic-net`): a phrase query on the
///   raw fields (stemmed fields have no positions); with `fuzzy`, also each
///   distinct component of 4+ characters without digits at edit distance 1
///   (at most `MAX_FUZZY_PARTS` per query), and the last word's last
///   component, if it qualifies, as a fuzzy prefix of names;
/// - one token, analysed per language with its stemmer:
///   - a token: term queries in name (boosted) and body; with `fuzzy`, the
///     same at edit distance 1 for 4+ characters without digits, and the last
///     word also as a fuzzy prefix of names;
///   - no token (a stopword in that language): nothing, or, when `required`
///     (AND) and some other query word is not a stopword in that language, a
///     score-0 match on every page of that language, so "the bike" doesn't
///     exclude English pages for "the". Under OR that clause would match
///     every page; with no such other word ("the" alone, or "die" for German)
///     it would match every page of the language.
///
///   The word's raw token is also an alternative, as a term query on the raw
///   name (boosted) and body: a word that literally appears in a page always
///   matches it, even where it is a stopword of the page's language
///   ("worden" in a Dutch page, "the" alone in English ones). In the similar
///   tier (OR) a word that is a stopword in any language gets no raw
///   alternative, or "the quantum" would fall back to every English page.
fn word_clauses(
    f: &Fields,
    words: &[Analysed],
    required: bool,
    fuzzy_on: bool,
) -> Vec<Box<dyn Query>> {
    let n_langs = f.name_stem.len();
    // Languages in which some word is not a stopword.
    let content: Vec<bool> = (0..n_langs)
        .map(|l| {
            words.iter().any(|w| match w {
                Analysed::Phrase(_) => true,
                Analysed::Stems { stems, .. } => stems[l].is_some(),
            })
        })
        .collect();
    let mut fuzzed_parts: HashSet<&str> = HashSet::new();
    let last = words.len().saturating_sub(1);
    let mut out = Vec::with_capacity(words.len());
    for (i, word) in words.iter().enumerate() {
        let mut should = Vec::new();
        match word {
            Analysed::Phrase(raw) => {
                should.extend(raw_clauses(f, raw));
                if fuzzy_on {
                    for (_, t) in raw.iter().filter(|(_, t)| fuzzy_ok(t)) {
                        if fuzzed_parts.contains(t.as_str()) {
                            continue;
                        }
                        if fuzzed_parts.len() >= MAX_FUZZY_PARTS {
                            break;
                        }
                        fuzzed_parts.insert(t);
                        should.push(boosted(fuzzy(f.name_raw, t), NAME_BOOST));
                        should.push(boosted(fuzzy(f.body_raw, t), 1.0));
                    }
                    // The name prefix goes to the word's own last part (what
                    // the user was still typing), even past the cap.
                    let tail = raw.last().map(|(_, t)| t.as_str()).filter(|t| fuzzy_ok(t));
                    if let Some(t) = tail.filter(|_| i == last) {
                        should.push(fuzzy_prefix(f.name_raw, t));
                    }
                }
            }
            Analysed::Stems { raw, stems } => {
                if required || stems.iter().all(Option::is_some) {
                    should.extend(raw_clauses(f, std::slice::from_ref(raw)));
                }
                let fields = f.name_stem.iter().zip(&f.body_stem);
                for (l, ((lang, name), (_, body))) in fields.enumerate() {
                    let Some(t) = &stems[l] else {
                        if required && content[l] {
                            let all_lang = TermQuery::new(
                                Term::from_field_text(f.lang, lang.code()),
                                IndexRecordOption::Basic,
                            );
                            should.push((
                                Occur::Should,
                                Box::new(ConstScoreQuery::new(Box::new(all_lang), 0.0)),
                            ));
                        }
                        continue;
                    };
                    for (field, boost) in [(*name, NAME_BOOST), (*body, 1.0)] {
                        let term = Term::from_field_text(field, t);
                        should.push(boosted(
                            TermQuery::new(term, IndexRecordOption::WithFreqs),
                            boost,
                        ));
                        if fuzzy_on && fuzzy_ok(t) {
                            should.push(boosted(fuzzy(field, t), boost));
                        }
                    }
                    if fuzzy_on && i == last && fuzzy_ok(t) {
                        should.push(fuzzy_prefix(*name, t));
                    }
                }
            }
        }
        out.push(Box::new(BooleanQuery::new(should)) as Box<dyn Query>);
    }
    out
}

/// `query` trimmed, or the error `limits` give for it.
pub(super) fn validate(query: &str) -> Result<&str, SearchError> {
    let trimmed = query.trim();
    if trimmed.len() > limits::MAX_QUERY_BYTES {
        return Err(SearchError::Invalid("Search query is too long".into()));
    }
    if trimmed.chars().count() < limits::MIN_QUERY_CHARS {
        return Err(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS));
    }
    Ok(trimmed)
}

fn path_terms(f: &Fields, names: &[String]) -> TermSetQuery {
    TermSetQuery::new(
        names
            .iter()
            .map(|n| Term::from_field_text(f.path, &format!("{n}.md"))),
    )
}

/// `core` restricted by `filter`.
fn filtered(f: &Fields, core: Box<dyn Query>, filter: &PageFilter) -> Box<dyn Query> {
    let kind = match filter.scope {
        SearchScope::Pages => Some(KIND_CONTENT),
        SearchScope::Meta => Some(KIND_META),
        SearchScope::All => None,
    };
    if kind.is_none() && filter.include.is_none() && filter.exclude.is_none() {
        return core;
    }
    let mut clauses: Vec<(Occur, Box<dyn Query>)> = vec![(Occur::Must, core)];
    if let Some(kind) = kind {
        let term = TermQuery::new(
            Term::from_field_text(f.kind, kind),
            IndexRecordOption::Basic,
        );
        clauses.push((Occur::Must, Box::new(term)));
    }
    if let Some(names) = &filter.include {
        clauses.push((Occur::Must, Box::new(path_terms(f, names))));
    }
    if let Some(names) = &filter.exclude {
        clauses.push((Occur::MustNot, Box::new(path_terms(f, names))));
    }
    Box::new(BooleanQuery::new(clauses))
}

fn empty_plan(words: Vec<String>) -> Plan {
    Plan {
        exact: Box::new(EmptyQuery),
        similar: None,
        words,
    }
}

/// The Words plan: every word required, falling back to similar pages.
/// A query of punctuation only matches nothing.
pub fn words_plan(
    index: &Index,
    f: &Fields,
    query: &str,
    filter: &PageFilter,
) -> Result<Plan, SearchError> {
    let trimmed = validate(query)?;
    let mut seen = HashSet::new();
    let distinct: Vec<&str> = trimmed
        .split_whitespace()
        .filter(|w| seen.insert(w.to_lowercase()))
        .collect();
    if distinct.len() > limits::MAX_TERMS {
        return Err(SearchError::Invalid(format!(
            "Search for at most {} words",
            limits::MAX_TERMS
        )));
    }
    let (words, analysed): (Vec<String>, Vec<Analysed>) = distinct
        .into_iter()
        .filter_map(|w| Some((w.to_string(), analyse_word(index, f, w)?)))
        .unzip();
    if analysed.is_empty() {
        return Ok(empty_plan(words));
    }
    let exact: Box<dyn Query> = Box::new(BooleanQuery::new(
        word_clauses(f, &analysed, true, false)
            .into_iter()
            .map(|q| (Occur::Must, q))
            .collect(),
    ));
    let similar: Box<dyn Query> = Box::new(BooleanQuery::new(
        word_clauses(f, &analysed, false, true)
            .into_iter()
            .map(|q| (Occur::Should, q))
            .collect(),
    ));
    Ok(Plan {
        exact: filtered(f, exact, filter),
        similar: Some(filtered(f, similar, filter)),
        words,
    })
}

/// The Phrase plan: the query's tokens adjacent and in order, in the page
/// name or body, case-insensitively. No similar tier.
pub fn phrase_plan(
    index: &Index,
    f: &Fields,
    query: &str,
    filter: &PageFilter,
) -> Result<Plan, SearchError> {
    let trimmed = validate(query)?;
    let toks = analyze(index, RAW_TOKENIZER, trimmed);
    let words: Vec<String> = trimmed
        .split_whitespace()
        .filter(|w| !analyze(index, RAW_TOKENIZER, w).is_empty())
        .map(String::from)
        .collect();
    if toks.is_empty() {
        return Ok(empty_plan(words));
    }
    let core: Box<dyn Query> = Box::new(BooleanQuery::new(raw_clauses(f, &toks)));
    Ok(Plan {
        exact: filtered(f, core, filter),
        similar: None,
        words,
    })
}

/// One tier's result: the top hits as (path, score), and how many pages match.
type Hits = (Vec<(String, f32)>, usize);
/// [`Hits`] plus the tier that produced them.
pub type Outcome = (Vec<(String, f32)>, usize, Tier);

/// Client-facing text of a failed index read. Tantivy errors can name index
/// files and directories, so the detail goes only to the server log.
pub(super) const FAILED_MESSAGE: &str = "try again in a moment";

fn failed(context: &str, e: impl std::fmt::Display) -> SearchError {
    tracing::warn!("full-text search failed ({context}): {e}");
    SearchError::Failed(FAILED_MESSAGE.into())
}

/// The top `limit` (at most `MAX_RESULTS`) hits of `query`.
fn collect(searcher: &Searcher, query: &dyn Query, limit: usize) -> Result<Hits, SearchError> {
    let limit = limit.min(limits::MAX_RESULTS);
    let path = searcher
        .schema()
        .get_field("path")
        .map_err(|e| failed("schema", e))?;
    let collector = (TopDocs::with_limit(limit.max(1)).order_by_score(), Count);
    let (top, total) = searcher
        .search(query, &collector)
        .map_err(|e| failed("search", e))?;
    let mut hits = Vec::with_capacity(top.len());
    for (score, addr) in top.into_iter().take(limit) {
        let doc = searcher
            .doc::<TantivyDocument>(addr)
            .map_err(|e| failed("read hit", e))?;
        if let Some(p) = doc.get_first(path).and_then(|v| v.as_str()) {
            hits.push((p.to_string(), score));
        }
    }
    Ok((hits, total))
}

/// Runs the exact tier, then, if it matched no page, the similar tier.
/// Returns the top `limit` (at most `MAX_RESULTS`) (path, score) pairs, the
/// number of matching pages and the tier that matched; a query nothing
/// matches reports `Tier::Exact`. Index errors are `SearchError::Failed`.
pub fn run(searcher: &Searcher, plan: &Plan, limit: usize) -> Result<Outcome, SearchError> {
    let (hits, total) = collect(searcher, &*plan.exact, limit)?;
    if total > 0 {
        return Ok((hits, total, Tier::Exact));
    }
    let Some(similar) = &plan.similar else {
        return Ok((hits, total, Tier::Exact));
    };
    Ok(match collect(searcher, &**similar, limit)? {
        (_, 0) => (Vec::new(), 0, Tier::Exact),
        (hits, total) => (hits, total, Tier::Similar),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::FileStamp;
    use crate::fulltext::{document, register_tokenizers, schema};
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

    impl Fixture {
        fn words_with(&self, q: &str, filter: &PageFilter) -> (Vec<String>, Tier) {
            let plan = words_plan(&self.index, &self.fields, q, filter).unwrap();
            let (hits, total, tier) = run(&self.searcher, &plan, 50).unwrap();
            assert_eq!(hits.len(), total);
            (hits.into_iter().map(|(p, _)| p).collect(), tier)
        }

        fn words(&self, q: &str) -> (Vec<String>, Tier) {
            self.words_with(q, &none())
        }

        fn phrase(&self, q: &str) -> Vec<String> {
            let plan = phrase_plan(&self.index, &self.fields, q, &none()).unwrap();
            assert!(plan.similar.is_none());
            run(&self.searcher, &plan, 50)
                .unwrap()
                .0
                .into_iter()
                .map(|(p, _)| p)
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
        let plan = words_plan(&fx.index, &fx.fields, "rollbakc", &none()).unwrap();
        let (_, total) = collect(&fx.searcher, &*plan.exact, 50).unwrap();
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
        let plan =
            phrase_plan(&fx.index, &fx.fields, "basil", &exclude(&["Kitchen/Pesto"])).unwrap();
        let paths: Vec<_> = run(&fx.searcher, &plan, 50)
            .unwrap()
            .0
            .into_iter()
            .map(|h| h.0)
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
        let plan = |q: &str| words_plan(&fx.index, &fx.fields, q, &none());
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
        assert!(phrase_plan(&fx.index, &fx.fields, &terms(40), &none()).is_ok());
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
        let plan = words_plan(&fx.index, &fx.fields, "zucchini", &none()).unwrap();
        let (hits, total, tier) = run(&fx.searcher, &plan, 3).unwrap();
        assert_eq!((hits.len(), total, tier), (3, 7, Tier::Exact));
        let plan = words_plan(&fx.index, &fx.fields, "zuchini", &none()).unwrap();
        let (hits, total, tier) = run(&fx.searcher, &plan, 3).unwrap();
        assert_eq!((hits.len(), total, tier), (3, 7, Tier::Similar));
    }

    #[test]
    fn plan_words_are_the_distinct_query_words() {
        let fx = fixture(&[]);
        let plan = words_plan(&fx.index, &fx.fields, "Bike bike ?! chain", &none()).unwrap();
        assert_eq!(plan.words, ["Bike", "chain"]);
        let plan = phrase_plan(&fx.index, &fx.fields, "on and on", &none()).unwrap();
        assert_eq!(plan.words, ["on", "and", "on"]);
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
        assert_eq!(crate::fulltext::detect_lang(dutch), crate::fulltext::Lang::Nl);
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
        let plan = phrase_plan(&fx.index, &fx.fields, "bike log", &pages).unwrap();
        assert_eq!(run(&fx.searcher, &plan, 50).unwrap().1, 0);
        let plan = phrase_plan(&fx.index, &fx.fields, "bike log", &meta).unwrap();
        assert_eq!(run(&fx.searcher, &plan, 50).unwrap().1, 1);
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
            let plan = words_plan(&fx.index, &fx.fields, q, &none()).unwrap();
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
        // Shared across words, too.
        assert_eq!(fuzzy_clauses("abcd-wxyz wxyz-abcd"), 5);
        let started = std::time::Instant::now();
        for q in [&distinct, &repeated] {
            let plan = words_plan(&fx.index, &fx.fields, q, &none()).unwrap();
            let (hits, _, _) = run(&fx.searcher, &plan, 50).unwrap();
            assert!(hits.is_empty());
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[test]
    fn limit_is_clamped_to_max_results() {
        let extra: Vec<_> = (0..60)
            .map(|i| {
                (
                    format!("Log/Entry {i}.md"),
                    "Picked courgettes today.".to_string(),
                )
            })
            .collect();
        let fx = fixture(&extra);
        let plan = words_plan(&fx.index, &fx.fields, "courgettes", &none()).unwrap();
        let (hits, total, _) = run(&fx.searcher, &plan, usize::MAX).unwrap();
        assert_eq!((hits.len(), total), (limits::MAX_RESULTS, 60));
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
        let plan = words_plan(&fx.index, &fx.fields, &q.join("-"), &none()).unwrap();
        let shown = format!("{:?}", plan.similar.unwrap());
        // The cap stops "tailpiece" being fuzzed, but it still gets the name
        // prefix: two phrase terms plus the prefix, no fuzzy term clauses.
        assert_eq!(shown.matches("tailpiece").count(), 2 + 1);
        // A short last part gets no prefix.
        let plan = words_plan(&fx.index, &fx.fields, "atic-net", &none()).unwrap();
        let shown = format!("{:?}", plan.similar.unwrap());
        assert_eq!(shown.matches("FuzzyTermQuery").count(), 2);
    }
}
