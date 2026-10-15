//! Query plans for the full-text index, ported from the search evaluation's
//! `tantivy-stem-and-or-fuzzy` builder.
//!
//! Words mode has two tiers. The exact tier requires every word (AND); a word
//! matches its stem in the page's language or, literally, its unstemmed
//! token, and a word that is a stopword in a page's language counts as
//! present for that page when another query word is not. When it finds
//! nothing, the similar tier matches any word (OR), with edit distance 1 on
//! longer tokens and a fuzzy prefix of the last word on names. Pages the
//! exact tier misses that have every word with accents folded (`zolw` for
//! `żółw`) follow its hits, so exact accents rank first; both count as the
//! exact tier. That pass compares folded spellings, not word forms:
//! `cafés` finds `café` by its stem, but `cafes` doesn't (stems aren't
//! folded). Phrase mode is one phrase query on the unstemmed fields, then on
//! the folded ones, with no similar tier. A sequence whose first or last
//! token is a lone CJK character matches it inside the page's bigrams (see
//! `edge_patterns`). Both modes are limited to the request's scope (the page
//! `kind`) and its include/exclude lists. The words come analysed from
//! `words`, which the passage matcher uses too.

use std::collections::HashSet;

use tantivy::collector::{Count, DocSetCollector, TopDocs};
use tantivy::query::{
    AllQuery, BooleanQuery, BoostQuery, ConstScoreQuery, EmptyQuery, FuzzyTermQuery, Occur,
    PhraseQuery, Query, RegexPhraseQuery, RegexQuery, TermQuery, TermSetQuery,
};
use tantivy::schema::{Field, IndexRecordOption, Value};
use tantivy::{Index, Searcher, TantivyDocument, Term};

use super::analysis::Lang;
use super::schema::{Fields, KIND_CONTENT, KIND_META};
pub use super::words::Tier;
use super::words::{lone_cjk, may_fold, phrase_words, Alt, Part, QueryWords, Tok, WordList};
use crate::error::SearchError;
use crate::job::{validate_text, FAILED_MESSAGE};
use crate::types::{PageFilter, QueryMode, SearchScope};

/// Score multiplier for a match in the page name.
pub const NAME_BOOST: f32 = 2.0;

/// A query [`validate`] accepted: its mode, and its text trimmed and within
/// the limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidQuery {
    Words(String),
    Phrase(String),
}

pub struct Plan {
    pub exact: Box<dyn Query>,
    /// Pages the exact tier misses that match with accents folded, ranked
    /// after it; `None` for a query without a word that has a token, or
    /// whose tokens are all CJK (folding leaves CJK alone).
    pub folded: Option<Box<dyn Query>>,
    /// The fallback run when `exact` matches no page; `None` for phrases and
    /// for a query without a word that has a token.
    pub similar: Option<Box<dyn Query>>,
    /// The query's words, analysed once; the passage matcher borrows them.
    pub words: QueryWords,
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

/// The raw name (boosted) and body fields.
fn raw_fields(f: &Fields) -> [(Field, f32); 2] {
    [(f.name_raw, NAME_BOOST), (f.body_raw, 1.0)]
}

/// The accent-folded name (boosted) and body fields.
fn fold_fields(f: &Fields) -> [(Field, f32); 2] {
    [(f.name_fold, NAME_BOOST), (f.body_fold, 1.0)]
}

/// Phrase (or, for one token, term) clauses for `toks` on `fields`.
fn token_clauses(fields: [(Field, f32); 2], toks: &[Tok]) -> Vec<(Occur, Box<dyn Query>)> {
    let mut out = Vec::new();
    let Some(first) = toks.first().map(|(p, _)| *p) else {
        return out;
    };
    for (field, boost) in fields {
        if toks.len() == 1 {
            let one: Box<dyn Query> = match lone_cjk(&toks[0].1) {
                Some(c) => Box::new(cjk_char_query(field, c)),
                None => Box::new(TermQuery::new(
                    Term::from_field_text(field, &toks[0].1),
                    IndexRecordOption::WithFreqs,
                )),
            };
            out.push((Occur::Should, Box::new(BoostQuery::new(one, boost))));
        } else if let Some(patterns) = edge_patterns(toks) {
            let q = RegexPhraseQuery::new_with_offset(field, patterns);
            out.push(boosted(q, boost));
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

fn raw_clauses(f: &Fields, toks: &[Tok]) -> Vec<(Occur, Box<dyn Query>)> {
    token_clauses(raw_fields(f), toks)
}

/// The terms of a sequence of tokens as regexes, offset from the first,
/// when its first or last token is a lone CJK character. The page's CJK
/// text may go on past that edge (`iPhone用` in `iPhone用のケース`, indexed
/// `iphone`, `用の`), so the first token matches a term ending with its
/// character and the last one a term starting with it. A lone character
/// between other tokens is a lone token on the page too, so the rest are
/// literals. `None` when neither edge is a lone CJK character.
fn edge_patterns(toks: &[Tok]) -> Option<Vec<(usize, String)>> {
    let (first, last) = (toks.first()?, toks.len() - 1);
    if lone_cjk(&first.1).is_none() && lone_cjk(&toks[last].1).is_none() {
        return None;
    }
    let patterns = toks.iter().enumerate().map(|(i, (p, t))| {
        let pattern = match lone_cjk(t) {
            Some(c) if i == 0 => format!(".?{c}"),
            Some(c) if i == last => format!("{c}.?"),
            _ => literal(t),
        };
        (p - first.0, pattern)
    });
    Some(patterns.collect())
}

/// `t` as a regex matching itself. Tokens are letters and digits, but a
/// symbol is escaped all the same.
fn literal(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for c in t.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Pages `relaxed` matches that `exact` doesn't: what the folded pass adds
/// after the exact tier.
fn beyond(relaxed: Box<dyn Query>, exact: &dyn Query) -> Box<dyn Query> {
    // A bare phrase scorer as the exclusion trips Tantivy's debug assertion
    // in `PhraseScorer::seek_danger` (a target below its doc, which the
    // `seek_danger` contract allows); the constant scorer seeks safely.
    let exclude = ConstScoreQuery::new(exact.box_clone(), 0.0);
    Box::new(BooleanQuery::new(vec![
        (Occur::Must, relaxed),
        (Occur::MustNot, Box::new(exclude)),
    ]))
}

/// Terms of `field` that hold `c`: itself, or a bigram with it first or
/// second. A CJK character is no regex syntax, so it needs no escaping.
fn cjk_char_query(field: Field, c: char) -> RegexQuery {
    RegexQuery::from_pattern(&format!(".?{c}.?"), field)
        .expect("a CJK character between wildcards is a valid regex")
}

/// The similar-tier alternative for a word of several tokens (its `parts`,
/// as [`WordList::parts_of`] gives them): a page that has every part,
/// anywhere in its name or body, fuzzed parts at edit distance 1 and the
/// rest exactly. So `ERR_DISK_QOUTA` finds a page with "err", "disk" and
/// "quota", not one that only says "desk". A prefix part may also be a fuzzy
/// prefix of a name.
fn parts_clause<'a>(f: &Fields, parts: impl Iterator<Item = &'a Part>) -> Box<dyn Query> {
    let mut must = Vec::new();
    for part in parts {
        let mut either = Vec::new();
        if part.fuzzy {
            either.push(boosted(fuzzy(f.name_raw, &part.text), NAME_BOOST));
            either.push(boosted(fuzzy(f.body_raw, &part.text), 1.0));
        } else {
            either.extend(raw_clauses(f, &[(0, part.text.clone())]));
        }
        if part.prefix {
            either.push(fuzzy_prefix(f.name_raw, &part.text));
        }
        must.push((
            Occur::Must,
            Box::new(BooleanQuery::new(either)) as Box<dyn Query>,
        ));
    }
    Box::new(BooleanQuery::new(must))
}

/// One clause per word: any of its alternatives in `tier`
/// ([`WordList::alternatives`], which says when each applies), in any
/// language's fields:
/// - its raw tokens: a term query (one token) or a phrase query (several:
///   `F-31`, `ERR_TLS_412`, `attic-net`; the stemmed fields have no
///   positions) on the raw name (boosted) and body;
/// - its stem per language: term queries in name (boosted) and body, fuzzy
///   ones too, and a fuzzy prefix of names;
/// - its presence: a score-0 match on every page of a language where it is
///   a stopword;
/// - its parts (similar tier, several tokens): see [`parts_clause`].
///
/// Its folded tokens are the folded pass's, not part of this clause.
fn word_clauses(f: &Fields, list: &WordList, tier: Tier) -> Vec<Box<dyn Query>> {
    let mut out = Vec::with_capacity(list.words.len());
    for i in 0..list.words.len() {
        let mut should = Vec::new();
        for alt in list.alternatives(i, tier) {
            match alt {
                Alt::Raw {
                    toks,
                    queried: true,
                    ..
                } => should.extend(raw_clauses(f, toks)),
                Alt::Stem {
                    lang,
                    term,
                    fuzzy: fuzzed,
                    name_prefix,
                    ..
                } => {
                    let l = lang.idx();
                    for (field, boost) in [(f.name_stem[l], NAME_BOOST), (f.body_stem[l], 1.0)] {
                        let t = Term::from_field_text(field, term);
                        should.push(boosted(
                            TermQuery::new(t, IndexRecordOption::WithFreqs),
                            boost,
                        ));
                        if fuzzed {
                            should.push(boosted(fuzzy(field, term), boost));
                        }
                    }
                    if name_prefix {
                        should.push(fuzzy_prefix(f.name_stem[l], term));
                    }
                }
                Alt::Present(lang) => {
                    let all_lang = TermQuery::new(
                        Term::from_field_text(f.lang, lang.code()),
                        IndexRecordOption::Basic,
                    );
                    should.push((
                        Occur::Should,
                        Box::new(ConstScoreQuery::new(Box::new(all_lang), 0.0)),
                    ));
                }
                Alt::Parts => should.push((Occur::Should, parts_clause(f, list.parts_of(i)))),
                Alt::Raw { queried: false, .. } | Alt::Folded { .. } => {}
            }
        }
        out.push(Box::new(BooleanQuery::new(should)) as Box<dyn Query>);
    }
    out
}

/// Whether the folded pass matches word `i`: its [`Alt::Folded`] is queried.
fn folds(list: &WordList, i: usize) -> bool {
    list.alternatives(i, Tier::Exact)
        .iter()
        .any(|alt| matches!(alt, Alt::Folded { queried: true, .. }))
}

/// `query` in `mode`, or the error `limits` give for it. The mode is checked
/// first, so a Natural query is refused whatever its text.
pub fn validate(mode: QueryMode, query: &str) -> Result<ValidQuery, SearchError> {
    let valid: fn(String) -> ValidQuery = match mode {
        QueryMode::Words => ValidQuery::Words,
        QueryMode::Phrase => ValidQuery::Phrase,
        QueryMode::Natural => {
            return Err(SearchError::Invalid(
                "Natural language search isn't supported".into(),
            ))
        }
    };
    validate_text(query).map(valid)
}

fn path_terms(f: &Fields, names: &[String]) -> TermSetQuery {
    TermSetQuery::new(
        names
            .iter()
            .map(|n| Term::from_field_text(f.path, &format!("{n}.md"))),
    )
}

/// `core` restricted by `filter`.
pub(super) fn filtered(f: &Fields, core: Box<dyn Query>, filter: &PageFilter) -> Box<dyn Query> {
    if filter.is_unrestricted() {
        return core;
    }
    let kind = match filter.scope {
        SearchScope::Pages => Some(KIND_CONTENT),
        SearchScope::Meta => Some(KIND_META),
        SearchScope::All => None,
    };
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

fn empty_plan(words: QueryWords) -> Plan {
    Plan {
        exact: Box::new(EmptyQuery),
        folded: None,
        similar: None,
        words,
    }
}

/// The Words plan for `query` (validated): every word required, falling back
/// to similar pages. A query of punctuation only matches nothing.
fn words_plan(
    index: &Index,
    f: &Fields,
    query: &str,
    filter: &PageFilter,
) -> Result<Plan, SearchError> {
    let list = WordList::new(index, query)?;
    if list.words.is_empty() {
        return Ok(empty_plan(QueryWords::Words(list)));
    }
    let exact_words = word_clauses(f, &list, Tier::Exact);
    let folded_words: Vec<bool> = (0..list.words.len()).map(|i| folds(&list, i)).collect();
    let either: Vec<(Occur, Box<dyn Query>)> = list
        .words
        .iter()
        .zip(&exact_words)
        .zip(&folded_words)
        .map(|((word, exact), &folded)| {
            let mut alternatives = vec![(Occur::Should, exact.box_clone())];
            if folded {
                alternatives.extend(token_clauses(fold_fields(f), &word.folded));
            }
            (
                Occur::Must,
                Box::new(BooleanQuery::new(alternatives)) as Box<dyn Query>,
            )
        })
        .collect();
    let exact: Box<dyn Query> = Box::new(BooleanQuery::new(
        exact_words.into_iter().map(|q| (Occur::Must, q)).collect(),
    ));
    // An all-CJK query: the folded pass would run its (regex) clauses
    // again, twice, to find nothing new.
    let folded = folded_words.contains(&true).then(|| {
        filtered(
            f,
            beyond(Box::new(BooleanQuery::new(either)), &*exact),
            filter,
        )
    });
    let similar: Box<dyn Query> = Box::new(BooleanQuery::new(
        word_clauses(f, &list, Tier::Similar)
            .into_iter()
            .map(|q| (Occur::Should, q))
            .collect(),
    ));
    Ok(Plan {
        exact: filtered(f, exact, filter),
        folded,
        similar: Some(filtered(f, similar, filter)),
        words: QueryWords::Words(list),
    })
}

/// The Phrase plan for `query` (validated): its tokens adjacent and in
/// order, in the page name or body, case-insensitively, then with accents
/// folded. No similar tier.
fn phrase_plan(index: &Index, f: &Fields, query: &str, filter: &PageFilter) -> Plan {
    let words = phrase_words(index, query);
    let QueryWords::Phrase { raw, folded } = &words else {
        unreachable!("phrase_words gives a phrase");
    };
    if raw.is_empty() {
        return empty_plan(words);
    }
    let core: Box<dyn Query> = Box::new(BooleanQuery::new(raw_clauses(f, raw)));
    let folded = may_fold(folded).then(|| {
        let relaxed = Box::new(BooleanQuery::new(token_clauses(fold_fields(f), folded)));
        filtered(f, beyond(relaxed, &*core), filter)
    });
    Plan {
        exact: filtered(f, core, filter),
        folded,
        similar: None,
        words,
    }
}

/// The plan for a validated query.
pub fn plan(
    index: &Index,
    f: &Fields,
    query: &ValidQuery,
    filter: &PageFilter,
) -> Result<Plan, SearchError> {
    match query {
        ValidQuery::Words(text) => words_plan(index, f, text, filter),
        ValidQuery::Phrase(text) => Ok(phrase_plan(index, f, text, filter)),
    }
}

/// One matching page: its path, and the language it was indexed in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub path: String,
    pub lang: Lang,
}

/// What a query found: the top hits, how many pages match, and the tier
/// that answered (`Exact` when nothing matched).
#[derive(Debug)]
pub struct Outcome {
    pub hits: Vec<Hit>,
    pub total: usize,
    pub tier: Tier,
}

fn failed(context: &str, e: impl std::fmt::Display) -> SearchError {
    tracing::warn!("full-text search failed ({context}): {e}");
    SearchError::Failed(FAILED_MESSAGE.into())
}

/// The top `limit` hits of `query` (`run_query` clamps `limit`), read from
/// the one document each hit loads, and how many pages match.
fn collect(
    searcher: &Searcher,
    f: &Fields,
    query: &dyn Query,
    limit: usize,
) -> Result<(Vec<Hit>, usize), SearchError> {
    let collector = (TopDocs::with_limit(limit.max(1)).order_by_score(), Count);
    let (top, total) = searcher
        .search(query, &collector)
        .map_err(|e| failed("search", e))?;
    let mut hits = Vec::with_capacity(top.len());
    for (_, addr) in top.into_iter().take(limit) {
        let doc = searcher
            .doc::<TantivyDocument>(addr)
            .map_err(|e| failed("read hit", e))?;
        let Some(path) = doc.get_first(f.path).and_then(|v| v.as_str()) else {
            continue;
        };
        // Every document stores its language; English is also what
        // detection falls back to.
        let lang = doc
            .get_first(f.lang)
            .and_then(|v| v.as_str())
            .and_then(Lang::from_code)
            .unwrap_or(Lang::En);
        hits.push(Hit {
            path: path.to_string(),
            lang,
        });
    }
    Ok((hits, total))
}

/// Runs the exact tier with the folded pass after it, then, if neither
/// matched a page, the similar tier. Index errors are `SearchError::Failed`.
pub fn run(
    searcher: &Searcher,
    f: &Fields,
    plan: &Plan,
    limit: usize,
) -> Result<Outcome, SearchError> {
    let (mut hits, mut total) = collect(searcher, f, &*plan.exact, limit)?;
    if let Some(folded) = &plan.folded {
        let (more, n) = collect(searcher, f, &**folded, limit - hits.len())?;
        hits.extend(more);
        total += n;
    }
    let exact = |hits, total| Outcome {
        hits,
        total,
        tier: Tier::Exact,
    };
    if total > 0 {
        return Ok(exact(hits, total));
    }
    let Some(similar) = &plan.similar else {
        return Ok(exact(hits, total));
    };
    Ok(match collect(searcher, f, &**similar, limit)? {
        (_, 0) => exact(Vec::new(), 0),
        (hits, total) => Outcome {
            hits,
            total,
            tier: Tier::Similar,
        },
    })
}

/// The paths of every indexed page `filter` admits.
pub fn admitted(
    searcher: &Searcher,
    f: &Fields,
    filter: &PageFilter,
) -> Result<HashSet<String>, SearchError> {
    let query = filtered(f, Box::new(AllQuery), filter);
    let docs = searcher
        .search(&*query, &DocSetCollector)
        .map_err(|e| failed("admitted", e))?;
    let mut out = HashSet::with_capacity(docs.len());
    for addr in docs {
        let doc = searcher
            .doc::<TantivyDocument>(addr)
            .map_err(|e| failed("read admitted", e))?;
        if let Some(path) = doc.get_first(f.path).and_then(|v| v.as_str()) {
            out.insert(path.to_string());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
