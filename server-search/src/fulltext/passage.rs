//! Passages for full-text results: the best lines of a page with UTF-16
//! highlights, computed from the page text with the index's own analyzers so
//! a highlight marks what made the page match. The [`Matcher`] borrows the
//! plan's analysed words and highlights the alternatives
//! ([`WordList::alternatives`]) the plan's clauses are built from, so it
//! applies the query's rules, not a copy.
//!
//! - Words: a page token whose stem, in the page's language (as the index
//!   stores it), equals a query word's stem. A multi-token word (`F-31`,
//!   `attic-net`) matches as the adjacent sequence of its raw tokens. A
//!   stopword of the page's language matches its literal occurrences only
//!   when no other query word is a non-stopword there ("the" alone,
//!   "worden" in a Dutch page), as the query then matched it literally.
//! - Phrase: the adjacent sequence of the phrase's raw tokens, as one span.
//! - Accents: in the exact tier, also page tokens equal to a query word (or
//!   phrase) with accents folded, under the same stopword rule. Folded
//!   spellings only, no word forms, as the query's folded pass.
//! - A lone CJK character first or last in a multi-token word or phrase
//!   (`iPhone用`) matches inside the page's bigram there, highlighted to
//!   that character, as the query matches it.
//! - Similar tier: additionally edit distance 1 (transposition cost 1) on
//!   tokens of `FUZZY_MIN_CHARS`+ characters without digits, on the parts of
//!   joined words the query fuzzes, and in the page name a fuzzy prefix of
//!   the last word (or of its prefix part), as the query does.
//!
//! The `Match` conventions: `pos` is the UTF-16
//! offset of the line's first highlight in the page text, `line` is 1-based,
//! the excerpt is the line (trailing whitespace and `\r` trimmed) windowed to
//! `EXCERPT_CHARS` starting up to `LEAD_CHARS` before the first highlight,
//! `tags:` lines are used only when no other line matches.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use silverbullet_server_common::page::outline;
use tantivy::tokenizer::TokenStream;
use tantivy::Index;

use super::analysis::{stem_tokenizer_name, tokens, Lang};
use super::query::Tier;
use super::schema::{FOLD_TOKENIZER, RAW_TOKENIZER};
use super::script::{is_cjk, may_fold};
use super::words::{lone_cjk, Alt, QueryWords, Tok, Word, WordKind, WordList};
use crate::types::Match;

/// At most this many passages per result page.
pub const PASSAGES_PER_PAGE: usize = 3;
/// Excerpts are at most this many characters.
pub const EXCERPT_CHARS: usize = 240;
/// Context kept before the first highlight of a long line, in characters.
const LEAD_CHARS: usize = 80;

/// What a page is matched against for highlighting: the plan's words.
pub enum Matcher<'a> {
    /// Phrase mode: the phrase's raw tokens, and the same folded,
    /// highlighted as one span.
    Phrase {
        index: &'a Index,
        toks: &'a [Tok],
        folded: &'a [Tok],
    },
    /// Words mode, in the tier that answered.
    Words {
        index: &'a Index,
        list: &'a WordList,
        tier: Tier,
    },
}

/// Whether `a` and `b` are at most one edit apart (insertion, deletion,
/// substitution or transposition of adjacent characters). Allocation-free.
fn within_one(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    // Each char is 1-4 bytes: far-apart byte lengths can't be one edit apart.
    let (short, long) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if long.len() > 4 * (short.len() + 1) {
        return false;
    }
    let (ns, nl) = (short.chars().count(), long.chars().count());
    let (short, long, ns, nl) = if ns <= nl {
        (short, long, ns, nl)
    } else {
        (long, short, nl, ns)
    };
    if nl - ns > 1 {
        return false;
    }
    let mismatch = short
        .char_indices()
        .zip(long.char_indices())
        .find(|((_, x), (_, y))| x != y);
    let Some(((si, cs), (li, cl))) = mismatch else {
        return true;
    };
    let rest_s = &short[si + cs.len_utf8()..];
    let rest_l = &long[li + cl.len_utf8()..];
    if ns == nl {
        rest_s == rest_l
            || (rest_s.starts_with(cl)
                && rest_l.starts_with(cs)
                && rest_s[cl.len_utf8()..] == rest_l[cs.len_utf8()..])
    } else {
        short[si..] == *rest_l
    }
}

/// Whether some prefix of `token` is at most one edit from `q`.
fn prefix_within_one(token: &str, q: &str) -> bool {
    let n = q.chars().count();
    let mut ends = token
        .char_indices()
        .map(|(i, _)| i)
        .chain(std::iter::once(token.len()))
        .skip(n.saturating_sub(1))
        .take(if n == 0 { 2 } else { 3 });
    ends.any(|end| within_one(&token[..end], q))
}

/// Tokens other than CJK grouped by text: each distinct token once, with
/// its ranges. Its readers (stopwords matched literally, fuzzy parts and
/// prefixes of 4+ characters) never match a CJK token, of which a page can
/// have hundreds of thousands of distinct bigrams.
fn vocabulary(toks: &[(Range<usize>, String)]) -> HashMap<&str, Vec<Range<usize>>> {
    let mut out: HashMap<&str, Vec<Range<usize>>> = HashMap::new();
    for (range, t) in toks {
        if !starts_cjk(t) {
            out.entry(t.as_str()).or_default().push(range.clone());
        }
    }
    out
}

/// Ranges of `c` inside the page's raw tokens (CJK text is indexed as
/// two-character tokens), each once. Scanned rather than grouped by text,
/// as for other exact CJK words.
fn lone_cjk_hits(raw: &[(Range<usize>, String)], c: char) -> Vec<Range<usize>> {
    let mut starts = HashSet::new();
    let mut out = Vec::new();
    for (range, t) in raw {
        for (off, _) in t.match_indices(c) {
            let start = range.start + off;
            if starts.insert(start) {
                out.push(start..start + c.len_utf8());
            }
        }
    }
    out
}

/// A matched byte range of the text and the query word it belongs to.
#[derive(Debug, Clone)]
struct Hit {
    range: Range<usize>,
    term: usize,
}

/// Ranges of `toks` where `seq` occurs as adjacent tokens. A lone CJK
/// character first or last in a longer `seq` matches a page token ending or
/// starting with it, as the query does (`iPhone用` in `iPhone用のケース`), and
/// the range ends at that character.
fn seq_hits<S: AsRef<str>>(toks: &[(Range<usize>, S)], seq: &[Tok]) -> Vec<Range<usize>> {
    if seq.is_empty() || toks.len() < seq.len() {
        return Vec::new();
    }
    let last = seq.len() - 1;
    let edge = |i: usize| if last > 0 { lone_cjk(&seq[i].1) } else { None };
    let (head, tail) = (edge(0), edge(last));
    let inner = usize::from(head.is_some())..last + usize::from(tail.is_none());
    toks.windows(seq.len())
        .filter_map(|w| {
            let start = match head {
                Some(c) => {
                    let (range, t) = &w[0];
                    t.as_ref().ends_with(c).then(|| range.end - c.len_utf8())?
                }
                None => w[0].0.start,
            };
            let end = match tail {
                Some(c) => {
                    let (range, t) = &w[last];
                    t.as_ref()
                        .starts_with(c)
                        .then(|| range.start + c.len_utf8())?
                }
                None => w[last].0.end,
            };
            w[inner.clone()]
                .iter()
                .zip(&seq[inner.clone()])
                .all(|((_, t), (_, s))| t.as_ref() == s)
                .then_some(start..end)
        })
        .collect()
}

/// The raw tokens of `text` stemmed in `lang`, grouped by stem. Each token
/// is stemmed from its own slice of `text`, as the index stems it: the raw
/// analyzer turns ة into ه, which the stem analyzer leaves to the stemmer.
/// Stopwords drop out.
fn stem_vocabulary(
    index: &Index,
    lang: Lang,
    text: &str,
    raw: &[(Range<usize>, String)],
) -> HashMap<String, Vec<Range<usize>>> {
    let mut out: HashMap<String, Vec<Range<usize>>> = HashMap::new();
    let Some(mut analyzer) = index.tokenizers().get(&stem_tokenizer_name(lang)) else {
        return out;
    };
    let mut slices: HashMap<&str, Vec<Range<usize>>> = HashMap::new();
    for (range, t) in raw {
        // CJK words are matched by scanning the raw tokens (stemmers and
        // stopword lists leave them alone), and a page of them has hundreds
        // of thousands of distinct bigrams.
        if starts_cjk(t) {
            continue;
        }
        slices
            .entry(&text[range.clone()])
            .or_default()
            .push(range.clone());
    }
    for (slice, ranges) in slices {
        let mut stream = analyzer.token_stream(slice);
        if let Some(tok) = stream.next() {
            out.entry(tok.text.clone()).or_default().extend(ranges);
        }
    }
    out
}

fn starts_cjk(t: &str) -> bool {
    t.chars().next().is_some_and(is_cjk)
}

/// Each distinct raw token that folding accents changes, folded
/// (`żółw` → `zolw`). Only tokens with a character folding may change are
/// analysed ([`may_fold`]): ASCII, CJK (a page of it has hundreds of
/// thousands of distinct bigrams), Arabic, Cyrillic and Greek tokens fold to
/// themselves.
fn fold_vocabulary<'t>(
    index: &Index,
    raw: &'t [(Range<usize>, String)],
) -> HashMap<&'t str, String> {
    let mut out = HashMap::new();
    let Some(mut analyzer) = index.tokenizers().get(FOLD_TOKENIZER) else {
        return out;
    };
    let mut unchanged = HashSet::new();
    for (_, t) in raw {
        let t = t.as_str();
        if !t.chars().any(may_fold) || out.contains_key(t) || unchanged.contains(t) {
            continue;
        }
        let mut stream = analyzer.token_stream(t);
        match stream.next() {
            Some(tok) if tok.text != t => {
                out.insert(t, tok.text.clone());
            }
            _ => {
                unchanged.insert(t);
            }
        }
    }
    out
}

/// The page's raw tokens, folded, in order (for sequences).
fn folded_tokens<'t>(
    raw: &'t [(Range<usize>, String)],
    fold: &'t HashMap<&str, String>,
) -> Vec<(Range<usize>, &'t str)> {
    raw.iter()
        .map(|(r, t)| {
            (
                r.clone(),
                fold.get(t.as_str()).map_or(t.as_str(), String::as_str),
            )
        })
        .collect()
}

/// Ranges of the folded phrase `folded` in `raw` that `seen` lacks.
fn folded_phrase_hits(
    index: &Index,
    raw: &[(Range<usize>, String)],
    toks: &[Tok],
    folded: &[Tok],
    seen: &[Range<usize>],
) -> Vec<Range<usize>> {
    if folded.iter().all(|(_, t)| starts_cjk(t)) {
        return Vec::new();
    }
    let fold = fold_vocabulary(index, raw);
    // Unchanged page tokens against an unchanged phrase: the exact hits.
    if fold.is_empty() && folded == toks {
        return Vec::new();
    }
    let seen: HashSet<(usize, usize)> = seen.iter().map(|r| (r.start, r.end)).collect();
    seq_hits(&folded_tokens(raw, &fold), folded)
        .into_iter()
        .filter(|r| !seen.contains(&(r.start, r.end)))
        .collect()
}

/// Words-mode hits with accents folded of the `wanted` words (their
/// [`Alt::Folded`] marked for the page's language), appended to `out` where
/// an exact rule hasn't already marked that range for that word.
fn folded_hits(
    index: &Index,
    wanted: &[(usize, &Word)],
    raw: &[(Range<usize>, String)],
    out: &mut Vec<Hit>,
) {
    let fold = fold_vocabulary(index, raw);
    let mut changed: HashMap<&str, Vec<Range<usize>>> = HashMap::new();
    for (range, t) in raw.iter().filter(|_| !fold.is_empty()) {
        if t.is_ascii() {
            continue;
        }
        if let Some(f) = fold.get(t.as_str()) {
            changed.entry(f.as_str()).or_default().push(range.clone());
        }
    }
    let seen: HashSet<(usize, usize, usize)> = out
        .iter()
        .map(|h| (h.range.start, h.range.end, h.term))
        .collect();
    let mut page: Option<Vec<(Range<usize>, &str)>> = None;
    for &(i, word) in wanted {
        let ranges = match (&word.kind, word.folded.as_slice()) {
            (WordKind::Single { raw: (_, r), .. }, [(_, t)]) => {
                let mut ranges = changed.get(t.as_str()).cloned().unwrap_or_default();
                // An accented query word: its folded form as the page has it
                // unaccented.
                if t != r {
                    ranges.extend(raw.iter().filter(|(_, p)| p == t).map(|(rg, _)| rg.clone()));
                }
                ranges
            }
            (WordKind::Seq(seq), folded) => {
                if fold.is_empty() && seq.as_slice() == folded {
                    continue;
                }
                let page = page.get_or_insert_with(|| folded_tokens(raw, &fold));
                seq_hits(page, folded)
            }
            _ => continue,
        };
        for range in ranges {
            if !seen.contains(&(range.start, range.end, i)) {
                out.push(Hit { range, term: i });
            }
        }
    }
}

impl<'a> Matcher<'a> {
    /// The matcher for a plan's `words`; `tier` is the tier that answered
    /// (Phrase mode has only one).
    pub fn new(index: &'a Index, words: &'a QueryWords, tier: Tier) -> Matcher<'a> {
        match words {
            QueryWords::Phrase { raw, folded } => Matcher::Phrase {
                index,
                toks: raw,
                folded,
            },
            QueryWords::Words(list) => Matcher::Words { index, list, tier },
        }
    }

    /// Every match in `text`, in a page of language `lang`; `name` when
    /// `text` is the page name (fuzzy prefixes apply there).
    fn hits(&self, text: &str, lang: Lang, name: bool) -> Vec<Hit> {
        match *self {
            Matcher::Phrase {
                index,
                toks,
                folded,
            } => {
                let raw = tokens(index, RAW_TOKENIZER, text);
                let lone = match toks {
                    [(_, t)] => lone_cjk(t),
                    _ => None,
                };
                let mut ranges = match lone {
                    Some(c) => lone_cjk_hits(&raw, c),
                    None => seq_hits(&raw, toks),
                };
                if lone.is_none() {
                    let more = folded_phrase_hits(index, &raw, toks, folded, &ranges);
                    ranges.extend(more);
                }
                ranges
                    .into_iter()
                    .map(|range| Hit { range, term: 0 })
                    .collect()
            }
            Matcher::Words { index, list, tier } => word_hits(index, list, tier, text, lang, name),
        }
    }
}

/// [`Matcher::hits`] in Words mode: the alternatives of each word in
/// `tier` that are marked for `lang`.
fn word_hits(
    index: &Index,
    list: &WordList,
    tier: Tier,
    text: &str,
    lang: Lang,
    name: bool,
) -> Vec<Hit> {
    let li = lang.idx();
    let raw = tokens(index, RAW_TOKENIZER, text);
    // Built when first read: the distinct tokens (for stopwords matched
    // literally, fuzzy parts and name prefixes) and the stems. Neither holds
    // CJK tokens: a CJK word is compared with the raw tokens as they stand
    // (stemmers leave it alone, it is too short to fuzz), and grouping a
    // page of bigrams by text (hundreds of thousands of them) would
    // dominate the time.
    let mut vocab: Option<HashMap<&str, Vec<Range<usize>>>> = None;
    let mut stems: Option<HashMap<String, Vec<Range<usize>>>> = None;
    let mut out = Vec::new();
    let push = |out: &mut Vec<Hit>, ranges: &[Range<usize>], term: usize| {
        out.extend(ranges.iter().map(|r| Hit {
            range: r.clone(),
            term,
        }));
    };
    let mut folded = Vec::new();
    for (i, word) in list.words.iter().enumerate() {
        for alt in list.alternatives(i, tier) {
            match alt {
                Alt::Raw { toks, marked, .. } if marked[li] => match toks {
                    [(_, t)] => match lone_cjk(t) {
                        Some(c) => push(&mut out, &lone_cjk_hits(&raw, c), i),
                        None => {
                            let vocab = vocab.get_or_insert_with(|| vocabulary(&raw));
                            if let Some(ranges) = vocab.get(t.as_str()) {
                                push(&mut out, ranges, i);
                            }
                        }
                    },
                    seq => {
                        for range in seq_hits(&raw, seq) {
                            out.push(Hit { range, term: i });
                        }
                    }
                },
                Alt::Stem {
                    lang: l,
                    term,
                    fuzzy,
                    name_prefix,
                    marked: true,
                    scanned,
                } if l == lang => {
                    if scanned {
                        for (range, t) in &raw {
                            if t == term {
                                out.push(Hit {
                                    range: range.clone(),
                                    term: i,
                                });
                            }
                        }
                        continue;
                    }
                    let stems =
                        stems.get_or_insert_with(|| stem_vocabulary(index, lang, text, &raw));
                    if !fuzzy {
                        if let Some(ranges) = stems.get(term) {
                            push(&mut out, ranges, i);
                        }
                        continue;
                    }
                    let prefix = name && name_prefix;
                    for (s, ranges) in stems.iter() {
                        if within_one(s, term) || (prefix && prefix_within_one(s, term)) {
                            push(&mut out, ranges, i);
                        }
                    }
                }
                Alt::Folded { marked, .. } if marked[li] => folded.push((i, word)),
                Alt::Parts => {
                    let vocab = vocab.get_or_insert_with(|| vocabulary(&raw));
                    for part in list.parts_of(i) {
                        if part.fuzzy {
                            for (s, ranges) in vocab.iter() {
                                if within_one(s, &part.text) {
                                    push(&mut out, ranges, part.word);
                                }
                            }
                        }
                        if part.prefix && name {
                            for (s, ranges) in vocab.iter() {
                                if prefix_within_one(s, &part.text) {
                                    push(&mut out, ranges, part.word);
                                }
                            }
                        }
                    }
                }
                Alt::Raw { .. } | Alt::Stem { .. } | Alt::Present(_) | Alt::Folded { .. } => {}
            }
        }
    }
    if !folded.is_empty() {
        folded_hits(index, &folded, &raw, &mut out);
    }
    out.sort_by_key(|h| (h.range.start, h.range.end));
    out
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// Byte ranges of the lines of `text`, without their `\n`.
fn line_ranges(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    for (i, b) in text.bytes().enumerate() {
        if b == b'\n' {
            out.push(start..i);
            start = i + 1;
        }
    }
    out.push(start..text.len());
    out
}

/// Excerpt of `line` (a line's text, trimmed) around `hits` (byte ranges
/// relative to `line`, sorted), and the highlights as UTF-16 offsets into it.
/// With `lead`, the window starts up to `LEAD_CHARS` before the first hit,
/// otherwise at the start of `line`.
fn excerpt(line: &str, hits: &[Range<usize>], lead: bool) -> (String, Vec<[u32; 2]>) {
    let first = hits.first().map_or(0, |r| r.start).min(line.len());
    let start = if lead {
        line[..first]
            .char_indices()
            .rev()
            .nth(LEAD_CHARS - 1)
            .map_or(0, |(i, _)| i)
    } else {
        0
    };
    let text: String = line[start..].chars().take(EXCERPT_CHARS).collect();
    let end = start + text.len();
    let mut highlights: Vec<[u32; 2]> = Vec::new();
    for r in hits {
        let (a, b) = (r.start.max(start), r.end.min(end));
        if a >= b {
            continue;
        }
        let span = [utf16_len(&line[start..a]), utf16_len(&line[start..b])];
        match highlights.last_mut() {
            Some(prev) if span[0] <= prev[1] => prev[1] = prev[1].max(span[1]),
            _ => highlights.push(span),
        }
    }
    (text, highlights)
}

/// Up to `PASSAGES_PER_PAGE` matches for one page, best line first (most
/// distinct query words, then occurrences, then earlier); a page that matched
/// only by name (or has no matching text) yields one Match at pos 0, line 1,
/// with the name as excerpt.
///
/// `lang` is the page's language as indexed (the document's `lang`).
pub fn passages(page: &str, text: &str, lang: Lang, m: &Matcher) -> Vec<Match> {
    let hits = m.hits(text, lang, false);
    if hits.is_empty() {
        let name: String = page.chars().take(EXCERPT_CHARS).collect();
        let ranges: Vec<Range<usize>> = m
            .hits(&name, lang, true)
            .into_iter()
            .map(|h| h.range)
            .collect();
        let (excerpt, highlights) = excerpt(&name, &ranges, false);
        return vec![Match {
            page: page.to_string(),
            pos: 0,
            line: 1,
            heading: None,
            excerpt,
            highlights,
        }];
    }
    let lines = line_ranges(text);
    let mut by_line: HashMap<usize, Vec<Hit>> = HashMap::new();
    for h in hits {
        let i = lines.partition_point(|l| l.start <= h.range.start) - 1;
        by_line.entry(i).or_default().push(h);
    }
    let line_text = |i: usize| text[lines[i].clone()].trim_end();
    let mut ranked: Vec<(usize, usize, usize)> = by_line
        .iter()
        .map(|(&i, hs)| {
            let distinct = hs.iter().map(|h| h.term).collect::<HashSet<_>>().len();
            (i, distinct, hs.len())
        })
        .collect();
    if ranked
        .iter()
        .any(|(i, _, _)| !line_text(*i).trim_start().starts_with("tags:"))
    {
        ranked.retain(|(i, _, _)| !line_text(*i).trim_start().starts_with("tags:"));
    }
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)).then(a.0.cmp(&b.0)));
    ranked.truncate(PASSAGES_PER_PAGE);
    // Frontmatter and fenced code hold no headings (see `page::outline`).
    let outline = outline(text);
    ranked
        .into_iter()
        .map(|(i, _, _)| {
            let heading = outline.heading_above(lines[i].start).map(String::from);
            let base = lines[i].start;
            let hs = &by_line[&i];
            let line = line_text(i);
            let ranges: Vec<Range<usize>> = hs
                .iter()
                .map(|h| h.range.start - base..(h.range.end - base).min(line.len()))
                .collect();
            let (excerpt, highlights) = excerpt(line, &ranges, true);
            Match {
                page: page.to_string(),
                pos: utf16_len(&text[..hs[0].range.start]),
                line: i as u32 + 1,
                heading,
                excerpt,
                highlights,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests;
