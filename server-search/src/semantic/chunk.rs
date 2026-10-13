//! Heading-aware chunking of page text for embedding (ported from Desktop).

use sha2::{Digest, Sha256};

/// Maximum characters per chunk.
const MAX_CHUNK_CHARS: usize = 1200;
/// Maximum characters kept of a heading.
const MAX_HEADING_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct ChunkText {
    /// UTF-16 offset of the chunk start in the page.
    pub pos: u32,
    /// 1-based line of the chunk start.
    pub line: u32,
    pub heading: Option<String>,
    pub text: String,
    pub hash: [u8; 32],
}

/// Splits on ATX headings (outside fenced code blocks), at most 1200 chars per
/// chunk; hash = sha256(heading + "\n" + text). A leading `---` frontmatter
/// block stays in the first chunk's text but is ignored for heading and fence
/// detection.
pub fn chunk(page_text: &str) -> Vec<ChunkText> {
    let mut out = Vec::new();
    let mut cursor = Cursor::default();
    let mut heading: Option<String> = None;
    let mut section_start = 0;
    let mut offset = 0;
    let mut fence: Option<(char, usize)> = None;
    let mut front_end = frontmatter_end(page_text);
    for line in page_text.split_inclusive('\n') {
        let line_end = offset + line.len();
        if line_end <= front_end {
            offset = line_end;
            continue;
        }
        front_end = 0;
        let indent = line.bytes().take_while(|b| *b == b' ').count();
        if indent <= 3 {
            let trimmed = &line[indent..];
            if let Some((marker, len)) = fence {
                let run = trimmed.chars().take_while(|c| *c == marker).count();
                if run >= len && trimmed[run..].trim().is_empty() {
                    fence = None;
                }
            } else if let Some(opener) = fence_opener(trimmed) {
                fence = Some(opener);
            } else if let Some(title) = atx_heading(trimmed) {
                if offset > section_start {
                    append(
                        page_text,
                        section_start,
                        offset,
                        &heading,
                        &mut cursor,
                        &mut out,
                    );
                    section_start = offset;
                }
                heading = (!title.is_empty()).then_some(title);
            }
        }
        offset = line_end;
    }
    append(
        page_text,
        section_start,
        page_text.len(),
        &heading,
        &mut cursor,
        &mut out,
    );
    out
}

/// Byte offset just past a leading `---` frontmatter block (closed by `---` or
/// `...`), or 0 when there is none or it is unclosed.
fn frontmatter_end(text: &str) -> usize {
    let mut lines = text.split_inclusive('\n');
    if lines.next().map(str::trim_end) != Some("---") {
        return 0;
    }
    let mut offset = text.split_inclusive('\n').next().map_or(0, str::len);
    for line in lines {
        offset += line.len();
        if matches!(line.trim_end(), "---" | "...") {
            return offset;
        }
    }
    0
}

/// A code fence opener (``` or ~~~, at least 3); a backtick fence's info
/// string may not contain backticks.
fn fence_opener(trimmed: &str) -> Option<(char, usize)> {
    ['`', '~'].into_iter().find_map(|m| {
        let run = trimmed.chars().take_while(|c| *c == m).count();
        (run >= 3 && (m == '~' || !trimmed[run..].contains('`'))).then_some((m, run))
    })
}

/// Heading text of an ATX heading line (indentation already removed).
fn atx_heading(trimmed: &str) -> Option<String> {
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&hashes)
        || !trimmed
            .as_bytes()
            .get(hashes)
            .is_none_or(|b| b.is_ascii_whitespace())
    {
        return None;
    }
    let mut title = trimmed[hashes..].trim();
    let stripped = title.trim_end_matches('#');
    if stripped.is_empty() || stripped.ends_with(char::is_whitespace) {
        title = stripped.trim_end();
    }
    Some(title.chars().take(MAX_HEADING_CHARS).collect())
}

/// Monotonic (byte, UTF-16, line) position so chunk offsets cost O(page) overall.
#[derive(Default)]
struct Cursor {
    byte: usize,
    utf16: usize,
    newlines: usize,
}

impl Cursor {
    fn advance_to(&mut self, page: &str, byte: usize) -> (u32, u32) {
        let skipped = &page[self.byte..byte];
        self.utf16 += skipped.encode_utf16().count();
        self.newlines += skipped.bytes().filter(|b| *b == b'\n').count();
        self.byte = byte;
        (self.utf16 as u32, self.newlines as u32 + 1)
    }
}

fn append(
    text: &str,
    mut start: usize,
    end: usize,
    heading: &Option<String>,
    cursor: &mut Cursor,
    out: &mut Vec<ChunkText>,
) {
    let mut first = true;
    while start < end {
        if !first {
            // Continuation chunks begin at content, not at the separator.
            let rest = &text[start..end];
            start += rest.len() - rest.trim_start().len();
            if start >= end {
                break;
            }
        }
        first = false;
        let finish = split_point(&text[start..end]) + start;
        let body = text[start..finish].trim_end();
        if !body.trim().is_empty() {
            let (pos, line) = cursor.advance_to(text, start);
            out.push(make(pos, line, heading, body));
        }
        start = finish;
    }
}

/// Byte length of the next chunk of `s`: all of it when it fits, otherwise cut
/// at the last paragraph, line or whitespace boundary in the window (falling
/// back to a hard cut at a char boundary).
fn split_point(s: &str) -> usize {
    let Some((limit, _)) = s.char_indices().nth(MAX_CHUNK_CHARS) else {
        return s.len();
    };
    let window = &s[..limit];
    // Only accept boundaries past the first quarter so chunks don't become tiny.
    let min = window
        .char_indices()
        .nth(MAX_CHUNK_CHARS / 4)
        .map_or(0, |(i, _)| i);
    let paragraph = [window.rfind("\n\n"), window.rfind("\n\r\n")]
        .into_iter()
        .flatten()
        .map(|i| {
            i + if window[i..].starts_with("\n\r") {
                3
            } else {
                2
            }
        })
        .max();
    paragraph
        .filter(|i| *i > min)
        .or_else(|| window.rfind('\n').map(|i| i + 1).filter(|i| *i > min))
        .or_else(|| {
            window
                .char_indices()
                .rev()
                .find(|(_, c)| c.is_whitespace())
                .map(|(i, c)| i + c.len_utf8())
                .filter(|i| *i > min)
        })
        .unwrap_or(limit)
}

fn make(pos: u32, line: u32, heading: &Option<String>, body: &str) -> ChunkText {
    let mut hasher = Sha256::new();
    hasher.update(heading.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"\n");
    hasher.update(body.as_bytes());
    ChunkText {
        pos,
        line,
        heading: heading.clone(),
        text: body.to_owned(),
        hash: hasher.finalize().into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_positions_and_headings() {
        let text = "# 🌲 Forest\n\nWalking among trees.\n\n## 水\n\nA quiet river.";
        let c = chunk(text);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].heading.as_deref(), Some("🌲 Forest"));
        assert_eq!(c[1].heading.as_deref(), Some("水"));
        assert_eq!(c[1].pos, 35);
        assert_eq!(c[1].line, 5);
        assert_eq!(c[1].text, "## 水\n\nA quiet river.");
    }

    #[test]
    fn crlf_positions() {
        let text = "# A\r\n\r\nx 😀 y\r\n\r\n## B\r\n\r\nz";
        let c = chunk(text);
        assert_eq!(c.len(), 2);
        let expected = text[..text.find("## B").unwrap()].encode_utf16().count() as u32;
        assert_eq!(c[1].pos, expected);
        assert_eq!(c[1].pos, 17);
        assert_eq!(c[1].line, 5);
        assert_eq!(c[1].heading.as_deref(), Some("B"));
        assert_eq!(c[0].text, "# A\r\n\r\nx 😀 y");
    }

    #[test]
    fn same_text_same_hashes_and_edit_changes_one() {
        let a = "# One\n\nalpha\n\n# Two\n\nbeta\n\n# Three\n\ngamma";
        let b = a.replace("beta", "BETA");
        let (ca, ca2, cb) = (chunk(a), chunk(a), chunk(&b));
        assert_eq!(ca, ca2);
        assert_eq!(ca.len(), 3);
        assert_eq!(ca[0].hash, cb[0].hash);
        assert_ne!(ca[1].hash, cb[1].hash);
        assert_eq!(ca[2].hash, cb[2].hash);
    }

    #[test]
    fn hash_covers_heading_and_text() {
        let c = &chunk("# H\n\nbody")[0];
        let mut h = Sha256::new();
        h.update(b"H\n# H\n\nbody");
        let expected: [u8; 32] = h.finalize().into();
        assert_eq!(c.hash, expected);
    }

    #[test]
    fn preamble_has_no_heading_and_empty_is_empty() {
        let c = chunk("intro\n\n# Title\n\nbody");
        assert_eq!(c[0].heading, None);
        assert_eq!(c[0].line, 1);
        assert_eq!(c[1].heading.as_deref(), Some("Title"));
        assert!(chunk("").is_empty());
        assert!(chunk("  \n\n").is_empty());
    }

    #[test]
    fn frontmatter_is_text_but_not_headings() {
        let c = chunk("---\n# comment\n---\nbody\n\n# Real\n\nx");
        assert_eq!(c.len(), 2);
        assert!(c[0].text.starts_with("---\n# comment\n---"));
        assert_eq!(c[0].heading, None);
        assert_eq!(c[1].heading.as_deref(), Some("Real"));
        let c = chunk("---\ntags: x\n...\nHello\n\n# H\n\nbody");
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].heading, None);
    }

    #[test]
    fn unclosed_frontmatter_does_not_swallow_headings() {
        let c = chunk("---\nnot closed\n\n# Real\n\nx");
        assert_eq!(c.len(), 2);
        assert_eq!(c[1].heading.as_deref(), Some("Real"));
    }

    #[test]
    fn tab_heading_closing_hashes_and_bare_hash() {
        assert_eq!(chunk("#\tTitle\n\nx")[0].heading.as_deref(), Some("Title"));
        assert_eq!(
            chunk("## Title ##\n\nx")[0].heading.as_deref(),
            Some("Title")
        );
        assert_eq!(chunk("# C#\n\nx")[0].heading.as_deref(), Some("C#"));
        let c = chunk("# A\n\nx\n\n#\n\ny");
        assert_eq!(c[1].heading, None);
    }

    #[test]
    fn indentation_limit_and_inline_backticks() {
        assert_eq!(chunk("    # code\n\nx").len(), 1);
        assert_eq!(chunk("    # code\n\nx")[0].heading, None);
        assert_eq!(chunk("   # ok\n\nx")[0].heading.as_deref(), Some("ok"));
        let c = chunk("```x``` inline\n\n# Real\n\nx");
        assert_eq!(c[1].heading.as_deref(), Some("Real"));
    }

    #[test]
    fn continuation_pos_after_emoji_and_crlf() {
        let para = "wörd ".repeat(100);
        let text = format!("😀\r\n\r\n{para}\r\n\r\n{para}\r\n\r\n{para}");
        let c = chunk(&text);
        assert!(c.len() >= 2);
        for ch in &c {
            let units: Vec<u16> = text.encode_utf16().skip(ch.pos as usize).collect();
            assert!(String::from_utf16(&units).unwrap().starts_with(&ch.text));
            let byte = text.len() - String::from_utf16(&units).unwrap().len();
            let line = text[..byte].matches('\n').count() as u32 + 1;
            assert_eq!(ch.line, line);
        }
        // CRLF paragraph boundaries are used
        assert!(c.iter().all(|ch| ch.text.ends_with("wörd")));
    }

    #[test]
    fn headings_in_fences_are_ignored() {
        let text = "# Real\n\n```sh\n# comment\n```\n\n~~~\n## not\n~~~\n\n## Next\n\nx";
        let c = chunk(text);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].heading.as_deref(), Some("Real"));
        assert!(c[0].text.contains("# comment"));
        assert_eq!(c[1].heading.as_deref(), Some("Next"));
    }

    #[test]
    fn hashtag_is_not_a_heading() {
        assert_eq!(chunk("#tag text\n\nmore").len(), 1);
        assert_eq!(chunk("#tag text")[0].heading, None);
    }

    #[test]
    fn long_section_splits_cleanly() {
        let para = "word ".repeat(100); // 500 chars
        let text = format!("# T\n\n{para}\n\n{para}\n\n{para}\n\n{para}");
        let c = chunk(&text);
        assert!(c.len() >= 2);
        for ch in &c {
            assert!(ch.text.chars().count() <= MAX_CHUNK_CHARS);
            assert_eq!(ch.heading.as_deref(), Some("T"));
        }
        assert!(c.iter().all(|ch| ch.text.ends_with("word")));
        for ch in &c {
            let units: Vec<u16> = text.encode_utf16().skip(ch.pos as usize).collect();
            let rest = String::from_utf16(&units).unwrap();
            assert!(rest.starts_with(&ch.text));
        }
    }

    #[test]
    fn hard_split_never_breaks_chars() {
        let text = "😀".repeat(3000);
        let c = chunk(&text);
        assert_eq!(c.len(), 3);
        assert!(c
            .iter()
            .all(|ch| ch.text.chars().count() <= MAX_CHUNK_CHARS));
        assert_eq!(c[1].pos, 2400);
        assert_eq!(
            c.iter().map(|ch| ch.text.chars().count()).sum::<usize>(),
            3000
        );
    }

    #[test]
    fn text_without_whitespace_and_multibyte_lines() {
        let text = format!("{}\n{}", "水".repeat(1000), "é".repeat(1000));
        let c = chunk(&text);
        assert!(c
            .iter()
            .all(|ch| ch.text.chars().count() <= MAX_CHUNK_CHARS));
        assert_eq!(c[1].line, 2);
    }
}
