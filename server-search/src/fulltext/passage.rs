//! Passages for full-text results: the best lines of a page with UTF-16
//! highlights, computed from the page text with the index's own analyzers so
//! a highlight marks what made the page match.
//!
//! - Words: a page token whose stem, in the page's language (`detect_lang` of
//!   the text, as the index stores it), equals a query word's stem. A
//!   multi-token word (`F-31`, `attic-net`) matches as the adjacent sequence
//!   of its raw tokens. A stopword of the page's language matches its literal
//!   occurrences only when no other query word is a non-stopword there ("the"
//!   alone, "worden" in a Dutch page), as the query then matched it literally.
//! - Phrase: the adjacent sequence of the phrase's raw tokens, as one span.
//! - Similar tier (`fuzzy`): additionally edit distance 1 (transposition
//!   cost 1) on tokens of `FUZZY_MIN_CHARS`+ characters without digits, and
//!   in the page name a fuzzy prefix of the last word, as the query does.
//!
//! The `Match` conventions: `pos` is the UTF-16
//! offset of the line's first highlight in the page text, `line` is 1-based,
//! the excerpt is the line (trailing whitespace and `\r` trimmed) windowed to
//! `EXCERPT_CHARS` starting up to `LEAD_CHARS` before the first highlight,
//! `tags:` lines are used only when no other line matches.

use std::collections::{HashMap, HashSet};
use std::ops::Range;

use tantivy::tokenizer::TokenStream;
use tantivy::Index;

use super::analysis::stem_tokenizer_name;
use super::query::{FUZZY_MIN_CHARS, MAX_FUZZY_PARTS};
use super::{detect_lang, tokens, Lang, RAW_TOKENIZER};
use crate::types::Match;

/// At most this many passages per result page.
pub const PASSAGES_PER_PAGE: usize = 3;
/// Excerpts are at most this many characters.
pub const EXCERPT_CHARS: usize = 240;
/// Context kept before the first highlight of a long line, in characters.
const LEAD_CHARS: usize = 80;

/// One query word, analysed.
enum Word {
    /// Several raw tokens, matched adjacent and in order.
    Seq(Vec<String>),
    /// Its raw token, and its stem per language (`Lang::ALL` order); `None`
    /// where a stopword.
    Stems {
        raw: Option<String>,
        stems: Vec<Option<String>>,
    },
}

/// The query's words analysed for highlighting.
pub struct Matcher {
    index: Index,
    phrase: bool,
    fuzzy: bool,
    /// Phrase mode: the phrase's raw tokens.
    phrase_toks: Vec<String>,
    /// Words mode: one entry per query word.
    words: Vec<Word>,
    /// Components of multi-token words fuzzed in the Similar tier, with the
    /// word they belong to; distinct and capped like the query's.
    fuzzy_parts: Vec<(usize, String)>,
}

fn texts(index: &Index, tokenizer: &str, text: &str) -> Vec<String> {
    tokens(index, tokenizer, text)
        .into_iter()
        .map(|(_, t)| t)
        .collect()
}

fn lang_index(lang: Lang) -> usize {
    Lang::ALL.iter().position(|l| *l == lang).unwrap_or(0)
}

fn fuzzy_ok(t: &str) -> bool {
    t.chars().count() >= FUZZY_MIN_CHARS && !t.chars().any(char::is_numeric)
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

/// Tokens grouped by text: each distinct token once, with its ranges.
fn vocabulary(toks: &[(Range<usize>, String)]) -> HashMap<&str, Vec<Range<usize>>> {
    let mut out: HashMap<&str, Vec<Range<usize>>> = HashMap::new();
    for (range, t) in toks {
        out.entry(t.as_str()).or_default().push(range.clone());
    }
    out
}

/// A matched byte range of the text and the query word it belongs to.
#[derive(Debug, Clone)]
struct Hit {
    range: Range<usize>,
    term: usize,
}

/// Ranges of `toks` where `seq` occurs as adjacent tokens.
fn seq_hits(toks: &[(Range<usize>, String)], seq: &[String]) -> Vec<Range<usize>> {
    if seq.is_empty() || toks.len() < seq.len() {
        return Vec::new();
    }
    toks.windows(seq.len())
        .filter(|w| w.iter().zip(seq).all(|((_, t), s)| t == s))
        .map(|w| w[0].0.start..w[w.len() - 1].0.end)
        .collect()
}

impl Matcher {
    /// `words` as `Plan::words` gives them; `phrase` for Phrase mode, `fuzzy`
    /// when the Similar tier answered.
    pub fn new(index: &Index, words: &[String], phrase: bool, fuzzy: bool) -> Self {
        let mut m = Matcher {
            index: index.clone(),
            phrase,
            fuzzy,
            phrase_toks: Vec::new(),
            words: Vec::new(),
            fuzzy_parts: Vec::new(),
        };
        if phrase {
            m.phrase_toks = texts(index, RAW_TOKENIZER, &words.join(" "));
            return m;
        }
        let mut seen = HashSet::new();
        for (i, w) in words.iter().enumerate() {
            let raw = texts(index, RAW_TOKENIZER, w);
            if raw.len() > 1 {
                for t in raw.iter().filter(|t| fuzzy_ok(t)) {
                    if seen.len() >= MAX_FUZZY_PARTS {
                        break;
                    }
                    if seen.insert(t.clone()) {
                        m.fuzzy_parts.push((i, t.clone()));
                    }
                }
                m.words.push(Word::Seq(raw));
            } else {
                let stems = Lang::ALL
                    .iter()
                    .map(|l| texts(index, &stem_tokenizer_name(*l), w).into_iter().next())
                    .collect();
                m.words.push(Word::Stems {
                    raw: raw.into_iter().next(),
                    stems,
                });
            }
        }
        m
    }

    /// `vocab` (raw tokens) stemmed in `lang`, each distinct token once: the
    /// stem analyzer works token by token, so this equals stemming the text.
    /// Stopwords drop out.
    fn stem_vocabulary(
        &self,
        lang: Lang,
        vocab: &HashMap<&str, Vec<Range<usize>>>,
    ) -> HashMap<String, Vec<Range<usize>>> {
        let mut out: HashMap<String, Vec<Range<usize>>> = HashMap::new();
        let Some(mut analyzer) = self.index.tokenizers().get(&stem_tokenizer_name(lang)) else {
            return out;
        };
        for (t, ranges) in vocab {
            let mut stream = analyzer.token_stream(t);
            if let Some(tok) = stream.next() {
                out.entry(tok.text.clone())
                    .or_default()
                    .extend(ranges.iter().cloned());
            }
        }
        out
    }

    /// Every match in `text`, in a page of language `lang`; `name` when
    /// `text` is the page name (fuzzy prefixes apply there).
    fn hits(&self, text: &str, lang: Lang, name: bool) -> Vec<Hit> {
        let mut out = Vec::new();
        let push = |out: &mut Vec<Hit>, ranges: &[Range<usize>], term: usize| {
            out.extend(ranges.iter().map(|r| Hit {
                range: r.clone(),
                term,
            }));
        };
        if self.phrase {
            let raw = tokens(&self.index, RAW_TOKENIZER, text);
            for range in seq_hits(&raw, &self.phrase_toks) {
                out.push(Hit { range, term: 0 });
            }
            return out;
        }
        let li = lang_index(lang);
        let last = self.words.len().saturating_sub(1);
        let wants_raw = self.words.iter().any(|w| matches!(w, Word::Seq(_)));
        let wants_stems = self.words.iter().any(|w| matches!(w, Word::Stems { .. }));
        // Some word is not a stopword in this language: stopwords then only
        // count as present, unhighlighted.
        let content = self.words.iter().any(|w| match w {
            Word::Seq(_) => true,
            Word::Stems { stems, .. } => stems[li].is_some(),
        });
        let raw = tokens(&self.index, RAW_TOKENIZER, text);
        let vocab = vocabulary(&raw);
        let stems = if wants_stems {
            self.stem_vocabulary(lang, &vocab)
        } else {
            HashMap::new()
        };
        for (i, word) in self.words.iter().enumerate() {
            match word {
                Word::Stems { raw: r, stems: qs } => {
                    let Some(q) = &qs[li] else {
                        if let Some(ranges) = r.as_deref().filter(|_| !content).and_then(|r| vocab.get(r)) {
                            push(&mut out, ranges, i);
                        }
                        continue;
                    };
                    if !(self.fuzzy && fuzzy_ok(q)) {
                        if let Some(ranges) = stems.get(q) {
                            push(&mut out, ranges, i);
                        }
                        continue;
                    }
                    let prefix = name && i == last;
                    for (s, ranges) in &stems {
                        if within_one(s, q) || (prefix && prefix_within_one(s, q)) {
                            push(&mut out, ranges, i);
                        }
                    }
                }
                Word::Seq(seq) => {
                    for range in seq_hits(&raw, seq) {
                        out.push(Hit { range, term: i });
                    }
                }
            }
        }
        if self.fuzzy && wants_raw {
            for (i, part) in &self.fuzzy_parts {
                for (s, ranges) in &vocab {
                    if within_one(s, part) {
                        push(&mut out, ranges, *i);
                    }
                }
            }
            // The name prefix goes to the last word's last part.
            if let Some(Word::Seq(seq)) = self.words.last().filter(|_| name) {
                if let Some(t) = seq.last().filter(|t| fuzzy_ok(t)) {
                    for (s, ranges) in &vocab {
                        if prefix_within_one(s, t) {
                            push(&mut out, ranges, last);
                        }
                    }
                }
            }
        }
        out.sort_by_key(|h| (h.range.start, h.range.end));
        out
    }
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

/// The text of an ATX heading line (`# Title`, up to three leading spaces,
/// optional closing `#`s), `Some("")` for an empty heading.
fn atx_heading(line: &str) -> Option<&str> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let level = rest.len() - rest.trim_start_matches('#').len();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = &rest[level..];
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let rest = rest.trim();
    let closed = rest.trim_end_matches('#');
    Some(if closed.is_empty() || closed.ends_with([' ', '\t']) {
        closed.trim_end()
    } else {
        rest
    })
}

/// A code fence opener or closer: its character and length.
fn fence(line: &str) -> Option<(char, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let c = rest.chars().next().filter(|c| *c == '`' || *c == '~')?;
    let after = rest.trim_start_matches(c);
    let n = rest.len() - after.len();
    // A backtick fence's info string can't hold a backtick: "```x```" is
    // an inline code span.
    (n >= 3 && !(c == '`' && after.contains('`'))).then_some((c, n))
}

/// The nearest ATX heading above each of `wanted` (line indexes), by
/// scanning lines only up to the last of them. Frontmatter (a `---` block
/// opening the page) and fenced code hold no headings.
fn headings_above(text: &str, lines: &[Range<usize>], wanted: &[usize]) -> Vec<Option<String>> {
    let line = |i: usize| text[lines[i].clone()].trim_end_matches('\r');
    let upto = wanted.iter().copied().max().map_or(0, |m| m + 1);
    let mut first_body = 0;
    if !lines.is_empty() && line(0).trim_end() == "---" {
        if let Some(end) = (1..lines.len()).find(|&i| line(i).trim_end() == "---") {
            first_body = end + 1;
        }
    }
    let mut above: Vec<Option<usize>> = vec![None; wanted.len()];
    let mut current: Option<usize> = None;
    let mut open: Option<(char, usize)> = None;
    for i in first_body.min(upto)..upto {
        for (k, w) in wanted.iter().enumerate() {
            if *w == i {
                above[k] = current;
            }
        }
        let l = line(i);
        if let Some((c, n)) = fence(l) {
            match open {
                None => open = Some((c, n)),
                Some((oc, on)) if oc == c && n >= on && l.trim().trim_matches(c).is_empty() => {
                    open = None
                }
                _ => {}
            }
            continue;
        }
        if open.is_some() {
            continue;
        }
        if let Some(h) = atx_heading(l) {
            current = (!h.is_empty()).then_some(i);
        }
    }
    above
        .into_iter()
        .map(|h| h.and_then(|i| atx_heading(line(i))).map(String::from))
        .collect()
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
/// `lang` is the page's language as indexed (the document's `lang`); `None`
/// detects it from `text`, which must then be the text that was indexed.
pub fn passages(page: &str, text: &str, lang: Option<Lang>, m: &Matcher) -> Vec<Match> {
    let lang = lang.unwrap_or_else(|| detect_lang(text));
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
    let chosen: Vec<usize> = ranked.iter().map(|(i, _, _)| *i).collect();
    let headings = headings_above(text, &lines, &chosen);
    ranked
        .into_iter()
        .zip(headings)
        .map(|((i, _, _), heading)| {
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
mod tests {
    use super::*;
    use crate::fulltext::{register_tokenizers, schema};

    fn index() -> Index {
        let (schema, _) = schema();
        let index = Index::create_in_ram(schema);
        register_tokenizers(&index);
        index
    }

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(|w| w.to_string()).collect()
    }

    fn run(text: &str, query: &[&str], phrase: bool, fuzzy: bool) -> Vec<Match> {
        let index = index();
        let m = Matcher::new(&index, &words(query), phrase, fuzzy);
        passages("Notes/Trips", text, None, &m)
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
        let text =
            "---\nstatus: rollback\n---\n# Plan\n```sh\n# not a heading\n```\nrollback steps";
        let out = run(text, &["rollback"], false, false);
        assert_eq!(out.len(), 2);
        let fm = out.iter().find(|m| m.line == 2).unwrap();
        assert_eq!(fm.heading, None);
        let body = out.iter().find(|m| m.line == 8).unwrap();
        assert_eq!(body.heading.as_deref(), Some("Plan"));
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
        let m = Matcher::new(&index, &words(&["gardens"]), false, false);
        let out = passages("Garden Plans", "nothing to see", None, &m);
        assert_eq!(out.len(), 1);
        assert_eq!((out[0].pos, out[0].line), (0, 1));
        assert_eq!(out[0].excerpt, "Garden Plans");
        assert_eq!(marked(&out[0]), ["Garden"]);
        let fuzzy = Matcher::new(&index, &words(&["plan", "gard"]), false, true);
        let out = passages("Garden Plans", "", None, &fuzzy);
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
        let m = Matcher::new(&index, &words(&["greenhouse"]), false, false);
        let out = passages(&name, "nothing to see", None, &m);
        assert_eq!(out[0].excerpt, name);
        assert_eq!(marked(&out[0]), ["Greenhouse"]);
    }

    #[test]
    fn the_callers_language_is_used() {
        let index = index();
        // "tomaten" stems like "tomaat" only under the Dutch stemmer.
        let m = Matcher::new(&index, &words(&["tomaat"]), false, false);
        let text = "tomaten";
        let nl = passages("P", text, Some(Lang::Nl), &m);
        assert_eq!(marked(&nl[0]), ["tomaten"]);
        let en = passages("P", text, Some(Lang::En), &m);
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

    /// 50 pages of ~1 MiB in the Similar tier with 16 words. Debug builds
    /// are too slow to be meaningful; run with
    /// `cargo test --release -p silverbullet-server-search fulltext::passage -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn large_pages_in_the_similar_tier_are_fast() {
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
        let m = Matcher::new(&index, &query, false, true);
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
        let started = std::time::Instant::now();
        let mut found = 0;
        for (i, page) in pages.iter().enumerate() {
            found += passages(&format!("Page {i}"), page, Some(Lang::En), &m).len();
        }
        let elapsed = started.elapsed();
        eprintln!("50 x 1 MiB pages: {elapsed:?}, {found} passages");
        assert_eq!(found, 150);
        assert!(elapsed < std::time::Duration::from_secs(3), "{elapsed:?}");
    }
}
