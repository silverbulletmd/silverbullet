use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use crate::QueryMode;

#[derive(Debug, Clone)]
pub struct LineHit {
    pub line: u32,
    /// Byte offset of the line's start within the file.
    pub line_offset: u64,
    pub text: String,
    /// Byte ranges into `text`.
    pub submatches: Vec<(usize, usize)>,
}

impl LineHit {
    /// Byte offset of the first submatch from the start of the file.
    pub fn match_offset(&self) -> usize {
        self.line_offset as usize + self.submatches.first().map_or(0, |m| m.0)
    }
}

#[derive(Debug, Clone)]
pub struct PageHits {
    pub page: String,
    /// Path relative to the space root, as ripgrep printed it without `./`.
    pub path: String,
    pub lines: Vec<LineHit>,
    /// Query terms found in the content.
    pub content_terms: BTreeSet<String>,
    pub occurrences: usize,
}

/// The listing path and page name of a path rg printed, or `None` for non-pages.
pub fn page_path(printed: &str) -> Option<(&str, &str)> {
    let path = printed.strip_prefix("./").unwrap_or(printed);
    Some((path, path.strip_suffix(".md")?))
}

pub fn utf16_len(bytes: &[u8]) -> u32 {
    String::from_utf8_lossy(bytes).encode_utf16().count() as u32
}

/// UTF-16 offset of `line`'s first submatch, given the file's leading bytes.
pub fn pos(prefix: &[u8], line: &LineHit) -> u32 {
    utf16_len(&prefix[..line.match_offset().min(prefix.len())])
}

/// The `terms` contained in `text`, ignoring case.
fn terms_in(text: &str, terms: &[String]) -> Vec<String> {
    let lower = text.to_lowercase();
    terms
        .iter()
        .filter(|t| !t.is_empty() && lower.contains(&t.to_lowercase()))
        .cloned()
        .collect()
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
enum RgMsg {
    Match(RgMatch),
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct RgMatch {
    path: RgData,
    lines: RgData,
    line_number: Option<u32>,
    absolute_offset: u64,
    #[serde(default)]
    submatches: Vec<RgSubmatch>,
}

/// rg sends non-UTF-8 data as `bytes` instead of `text`.
#[derive(Deserialize)]
struct RgData {
    text: Option<String>,
}

#[derive(Deserialize)]
struct RgSubmatch {
    start: usize,
    end: usize,
}

pub fn parse_json_lines(stdout: &[u8], terms: &[String]) -> Vec<PageHits> {
    let mut pages: BTreeMap<String, PageHits> = BTreeMap::new();
    for raw in stdout.split(|b| *b == b'\n') {
        let Ok(RgMsg::Match(m)) = serde_json::from_slice::<RgMsg>(raw) else {
            continue;
        };
        let Some((path, page)) = m.path.text.as_deref().and_then(page_path) else {
            continue;
        };
        // Non-UTF-8 lines can't produce a usable excerpt.
        let Some(text) = m.lines.text else {
            continue;
        };
        let entry = pages.entry(page.to_string()).or_insert_with(|| PageHits {
            page: page.to_string(),
            path: path.to_string(),
            lines: Vec::new(),
            content_terms: BTreeSet::new(),
            occurrences: 0,
        });
        let submatches: Vec<(usize, usize)> =
            m.submatches.iter().map(|s| (s.start, s.end)).collect();
        entry.occurrences += submatches.len();
        entry.content_terms.extend(terms_in(&text, terms));
        entry.lines.push(LineHit {
            line: m.line_number.unwrap_or(1),
            line_offset: m.absolute_offset,
            text,
            submatches,
        });
    }
    pages.into_values().collect()
}

pub fn qualify_and_rank(hits: Vec<PageHits>, terms: &[String], mode: QueryMode) -> Vec<PageHits> {
    let mut scored: Vec<(usize, PageHits)> = hits
        .into_iter()
        .filter_map(|h| {
            let title: BTreeSet<String> = terms_in(&h.page, terms).into_iter().collect();
            let covered = h.content_terms.union(&title).count();
            if mode == QueryMode::Words && covered < terms.len() {
                return None;
            }
            let score = covered * 100 + title.len() * 50 + h.occurrences.min(20);
            Some((score, h))
        })
        .collect();
    scored.sort_by(|(a, ha), (b, hb)| b.cmp(a).then_with(|| ha.page.cmp(&hb.page)));
    scored.into_iter().map(|(_, h)| h).collect()
}

fn line_terms(line: &LineHit, terms: &[String]) -> usize {
    terms_in(&line.text, terms)
        .len()
        .max(usize::from(!line.submatches.is_empty()))
}

pub fn best_lines<'a>(hits: &'a PageHits, terms: &[String], max: usize) -> Vec<&'a LineHit> {
    let usable: Vec<&LineHit> = hits
        .lines
        .iter()
        .filter(|l| !l.text.trim().is_empty())
        .collect();
    let mut lines: Vec<&LineHit> = usable
        .iter()
        .copied()
        .filter(|l| !l.text.trim_start().starts_with("tags:"))
        .collect();
    if lines.is_empty() {
        lines = usable;
    }
    lines.sort_by(|a, b| {
        line_terms(b, terms)
            .cmp(&line_terms(a, terms))
            .then(a.line.cmp(&b.line))
    });
    lines.truncate(max);
    lines
}

const EXCERPT_CHARS: usize = 240;
const LEAD_BYTES: usize = 80;

pub struct Passage {
    pub excerpt: String,
    /// `[start, end)` UTF-16 offsets into `excerpt`.
    pub highlights: Vec<[u32; 2]>,
}

pub fn passage(line: &LineHit) -> Passage {
    let text = line.text.trim_end();
    let first = line.submatches.first().map_or(0, |m| m.0).min(text.len());
    let start = text
        .char_indices()
        .map(|(i, _)| i)
        .take_while(|i| *i <= first.saturating_sub(LEAD_BYTES))
        .last()
        .unwrap_or(0);
    let excerpt: String = text[start..].chars().take(EXCERPT_CHARS).collect();
    let end = start + excerpt.len();
    let highlights = line
        .submatches
        .iter()
        .filter_map(|&(a, b)| {
            if a >= end
                || b <= start
                || !text.is_char_boundary(a)
                || !text.is_char_boundary(b.min(end))
            {
                return None;
            }
            Some([
                text[start..a.max(start)].encode_utf16().count() as u32,
                text[start..b.min(end)].encode_utf16().count() as u32,
            ])
        })
        .collect();
    Passage {
        excerpt,
        highlights,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rg_match(
        path: &str,
        line: u32,
        offset: u64,
        text: &str,
        subs: &[(&str, usize, usize)],
    ) -> String {
        let submatches: Vec<serde_json::Value> = subs
            .iter()
            .map(|(t, s, e)| serde_json::json!({"match": {"text": t}, "start": s, "end": e}))
            .collect();
        serde_json::json!({
            "type": "match",
            "data": {
                "path": {"text": path},
                "lines": {"text": text},
                "line_number": line,
                "absolute_offset": offset,
                "submatches": submatches
            }
        })
        .to_string()
    }

    fn terms(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| t.to_string()).collect()
    }

    #[test]
    fn page_names_strip_dot_slash_and_extension() {
        assert_eq!(
            page_path("./Notes/Garden Plan.md"),
            Some(("Notes/Garden Plan.md", "Notes/Garden Plan"))
        );
        assert_eq!(page_path("Inbox.md"), Some(("Inbox.md", "Inbox")));
        assert_eq!(page_path("./image.png"), None);
    }

    #[test]
    fn words_mode_requires_every_term_in_content_or_title() {
        let out = [
            rg_match(
                "./Basil.md",
                3,
                40,
                "Water the basil daily\n",
                &[("basil", 10, 15)],
            ),
            rg_match(
                "./Herbs.md",
                1,
                0,
                "basil and mint\n",
                &[("basil", 0, 5), ("mint", 10, 14)],
            ),
            rg_match(
                "./Mint Notes.md",
                2,
                9,
                "tea with basil\n",
                &[("basil", 9, 14)],
            ),
        ]
        .join("\n");
        let t = terms(&["basil", "mint"]);
        let ranked = qualify_and_rank(parse_json_lines(out.as_bytes(), &t), &t, QueryMode::Words);
        let names: Vec<_> = ranked.iter().map(|h| h.page.as_str()).collect();
        assert_eq!(names, ["Mint Notes", "Herbs"]);
    }

    #[test]
    fn ties_break_alphabetically() {
        let out = [
            rg_match("./b.md", 1, 0, "fern\n", &[("fern", 0, 4)]),
            rg_match("./a.md", 1, 0, "fern\n", &[("fern", 0, 4)]),
        ]
        .join("\n");
        let ranked = qualify_and_rank(
            parse_json_lines(out.as_bytes(), &[]),
            &[],
            QueryMode::Phrase,
        );
        assert_eq!(ranked[0].page, "a");
    }

    #[test]
    fn best_lines_prefer_more_terms_and_skip_tag_lines() {
        let out = [
            rg_match(
                "./P.md",
                2,
                4,
                "tags: basil mint\n",
                &[("basil", 6, 11), ("mint", 12, 16)],
            ),
            rg_match("./P.md", 5, 50, "basil only\n", &[("basil", 0, 5)]),
            rg_match(
                "./P.md",
                9,
                90,
                "basil with mint\n",
                &[("basil", 0, 5), ("mint", 11, 15)],
            ),
        ]
        .join("\n");
        let t = terms(&["basil", "mint"]);
        let hits = parse_json_lines(out.as_bytes(), &t);
        let lines: Vec<u32> = best_lines(&hits[0], &t, 3).iter().map(|l| l.line).collect();
        assert_eq!(lines, [9, 5]);
    }

    #[test]
    fn passages_use_utf16_highlights_around_non_ascii_text() {
        let text = "Café 🙂 naïve basil here\n";
        let start = text.find("basil").unwrap();
        let line = LineHit {
            line: 1,
            line_offset: 0,
            text: text.to_string(),
            submatches: vec![(start, start + 5)],
        };
        let Passage {
            excerpt,
            highlights,
        } = passage(&line);
        assert_eq!(line.match_offset(), start);
        let [a, b] = highlights[0];
        let utf16: Vec<u16> = excerpt.encode_utf16().collect();
        assert_eq!(
            String::from_utf16(&utf16[a as usize..b as usize]).unwrap(),
            "basil"
        );
    }

    #[test]
    fn long_lines_are_windowed_before_the_match() {
        let text = format!("{}needle{}\n", "x".repeat(1000), "y".repeat(1000));
        let line = LineHit {
            line: 1,
            line_offset: 0,
            text,
            submatches: vec![(1000, 1006)],
        };
        let Passage {
            excerpt,
            highlights,
        } = passage(&line);
        assert!(excerpt.chars().count() <= 240);
        let utf16: Vec<u16> = excerpt.encode_utf16().collect();
        let [a, b] = highlights[0];
        assert_eq!(
            String::from_utf16(&utf16[a as usize..b as usize]).unwrap(),
            "needle"
        );
    }

    #[test]
    fn non_match_and_malformed_lines_are_ignored() {
        let out = format!(
            "{}\nnot json\n{}\n",
            serde_json::json!({"type": "begin", "data": {"path": {"text": "./a.md"}}}),
            rg_match("./a.md", 1, 0, "fern\n", &[("fern", 0, 4)])
        );
        assert_eq!(parse_json_lines(out.as_bytes(), &[]).len(), 1);
    }

    #[test]
    fn matches_without_an_offset_are_skipped() {
        let mut no_offset: serde_json::Value =
            serde_json::from_str(&rg_match("./a.md", 1, 0, "fern\n", &[("fern", 0, 4)])).unwrap();
        no_offset["data"]
            .as_object_mut()
            .unwrap()
            .remove("absolute_offset");
        let out = [
            no_offset.to_string(),
            rg_match("./b.md", 2, 7, "fern\n", &[("fern", 0, 4)]),
        ]
        .join("\n");
        let hits = parse_json_lines(out.as_bytes(), &[]);
        let pages: Vec<_> = hits.iter().map(|h| h.page.as_str()).collect();
        assert_eq!(pages, ["b"]);
        assert_eq!(hits[0].lines[0].line_offset, 7);
    }

    #[test]
    fn begin_end_and_summary_messages_are_ignored() {
        let out = [
            serde_json::json!({"type": "begin", "data": {"path": {"text": "./a.md"}}}).to_string(),
            rg_match("./a.md", 1, 0, "fern\n", &[("fern", 0, 4)]),
            serde_json::json!({"type": "end", "data": {"path": {"text": "./a.md"}, "binary_offset": null, "stats": {}}}).to_string(),
            serde_json::json!({"type": "summary", "data": {"elapsed_total": {"secs": 0}, "stats": {}}}).to_string(),
        ]
        .join("\n");
        let hits = parse_json_lines(out.as_bytes(), &[]);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].lines.len(), 1);
    }

    #[test]
    fn match_offset_and_pos_measure_to_the_first_submatch() {
        let line = LineHit {
            line: 2,
            line_offset: 3,
            text: "é basil\n".into(),
            submatches: vec![(3, 8)],
        };
        assert_eq!(line.match_offset(), 6);
        let prefix = "ab\né ".as_bytes();
        assert_eq!(pos(prefix, &line), 5);
        assert_eq!(
            pos(&prefix[..4], &line),
            4,
            "a short prefix is measured whole"
        );
    }

    #[test]
    fn terms_in_matches_case_insensitively() {
        assert_eq!(
            terms_in("Basil and MINT", &terms(&["mint", "basil", "sage"])),
            ["mint", "basil"]
        );
    }

    #[test]
    fn utf16_len_counts_surrogate_pairs() {
        assert_eq!(utf16_len("a🙂".as_bytes()), 3);
    }

    #[test]
    fn overlapping_terms_are_attributed_by_line_text() {
        let out = rg_match("./a.md", 1, 0, "two cars\n", &[("car", 4, 7)]);
        let t = terms(&["car", "cars"]);
        let ranked = qualify_and_rank(parse_json_lines(out.as_bytes(), &t), &t, QueryMode::Words);
        assert_eq!(ranked.len(), 1);
    }

    #[test]
    fn terms_on_different_lines_qualify() {
        let out = [
            rg_match("./a.md", 1, 0, "basil\n", &[("basil", 0, 5)]),
            rg_match("./a.md", 4, 9, "mint\n", &[("mint", 0, 4)]),
        ]
        .join("\n");
        let t = terms(&["basil", "mint"]);
        let ranked = qualify_and_rank(parse_json_lines(out.as_bytes(), &t), &t, QueryMode::Words);
        assert_eq!(ranked.len(), 1);
    }

    #[test]
    fn lines_without_text_are_skipped() {
        let no_text = serde_json::json!({"type": "match", "data": {
            "path": {"text": "./a.md"}, "lines": {"bytes": "Zm9v"},
            "line_number": 1, "absolute_offset": 0,
            "submatches": [{"match": {"text": "foo"}, "start": 0, "end": 3}]}})
        .to_string();
        let out = [
            no_text,
            rg_match("./a.md", 2, 5, "foo bar\n", &[("foo", 0, 3)]),
        ]
        .join("\n");
        let hits = parse_json_lines(out.as_bytes(), &[]);
        assert_eq!(hits[0].lines.len(), 1);
        assert_eq!(hits[0].occurrences, 1);
        let only = rg_match("./b.md", 1, 0, "x\n", &[]);
        let bytes_only = only.replace("\"text\":\"x\\n\"", "\"bytes\":\"eAo=\"");
        assert!(parse_json_lines(bytes_only.as_bytes(), &[]).is_empty());
    }

    #[test]
    fn best_lines_fall_back_to_tag_lines() {
        let out = rg_match("./P.md", 2, 4, "tags: basil\n", &[("basil", 6, 11)]);
        let t = terms(&["basil"]);
        let hits = parse_json_lines(out.as_bytes(), &t);
        assert_eq!(best_lines(&hits[0], &t, 3).len(), 1);
    }
}
