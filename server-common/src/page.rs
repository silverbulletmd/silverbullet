use pulldown_cmark::{Event, Parser, Tag};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageKind {
    Content,
    Meta,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PageMetadata {
    pub tags: Vec<String>,
    pub description: Option<String>,
}

impl PageMetadata {
    /// Meta when tagged `meta`, `meta/…` or `template`, as the client's
    /// `isMetaPage` classifies pages.
    pub fn kind(&self) -> PageKind {
        if self
            .tags
            .iter()
            .any(|tag| tag == "meta" || tag.starts_with("meta/") || tag == "template")
        {
            PageKind::Meta
        } else {
            PageKind::Content
        }
    }

    fn add_tag(&mut self, tag: &str) {
        let tag = tag.strip_prefix('#').unwrap_or(tag);
        if !tag.is_empty() && !self.tags.iter().any(|existing| existing == tag) {
            self.tags.push(tag.to_owned());
        }
    }
}

#[derive(Debug)]
pub struct ParsedPage<'a> {
    pub metadata: PageMetadata,
    pub body: &'a str,
}

pub fn parse_page(text: &str) -> ParsedPage<'_> {
    let mut metadata = PageMetadata::default();
    let (yaml, body) = split_frontmatter(text);
    if let Some(yaml) = yaml {
        if let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(yaml) {
            metadata.description = value
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_owned);
            if let Some(tags) = value.get("tags") {
                match tags {
                    serde_yaml::Value::String(tags) => {
                        for tag in tags.split(|c: char| c == ',' || c.is_whitespace()) {
                            metadata.add_tag(tag);
                        }
                    }
                    serde_yaml::Value::Sequence(tags) => {
                        for tag in tags {
                            if let Some(tag) = tag.as_str() {
                                metadata.add_tag(tag);
                            } else if let serde_yaml::Value::Number(tag) = tag {
                                metadata.add_tag(&tag.to_string());
                            } else if let serde_yaml::Value::Bool(tag) = tag {
                                metadata.add_tag(&tag.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    let mut depth = 0;
    for (event, range) in Parser::new(body).into_offset_iter() {
        match event {
            Event::Start(tag) => {
                if depth == 0 && tag == Tag::Paragraph {
                    if let Some(tags) = paragraph_tags(&body[range]) {
                        for tag in tags {
                            metadata.add_tag(tag);
                        }
                    }
                }
                depth += 1;
            }
            Event::End(_) => depth -= 1,
            _ => {}
        }
    }
    ParsedPage { metadata, body }
}

fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let Some(first) = text.lines().next() else {
        return (None, text);
    };
    if first != "---" {
        return (None, text);
    }
    let start = text.find('\n').map_or(text.len(), |pos| pos + 1);
    let mut offset = start;
    for line in text[start..].split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return (Some(&text[start..offset]), &text[offset + line.len()..]);
        }
        offset += line.len();
    }
    (None, text)
}

/// One ATX heading of a page's body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Heading {
    /// Byte offset of the start of the heading's line.
    pub start: usize,
    /// The heading's text, trimmed, without closing `#`s; empty for a bare `#`.
    pub text: String,
}

/// A page's ATX headings, by the rules every
/// server-side reader of a page shares: frontmatter as [`parse_page`] splits
/// it (a first line `---` closed by a later line `---`) holds no headings,
/// nor does fenced code (three or more backticks or tildes, indented at most
/// three spaces; a backtick fence's info string holds no backtick).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outline {
    /// In page order.
    pub headings: Vec<Heading>,
}

impl Outline {
    /// The text of the nearest heading on a line before the line that starts
    /// at byte `line_start`; `None` when there is none or it is a bare `#`,
    /// which ends the previous heading's section.
    pub fn heading_above(&self, line_start: usize) -> Option<&str> {
        let before = self.headings.partition_point(|h| h.start < line_start);
        let heading = self.headings[..before].last()?;
        (!heading.text.is_empty()).then_some(heading.text.as_str())
    }
}

/// The outline of page `text`.
pub fn outline(text: &str) -> Outline {
    let (_, body) = split_frontmatter(text);
    let body_start = text.len() - body.len();
    let mut headings = Vec::new();
    let mut open: Option<(char, usize)> = None;
    let mut start = body_start;
    for raw in body.split_inclusive('\n') {
        let line_start = start;
        start += raw.len();
        let line = raw.strip_suffix('\n').unwrap_or(raw).trim_end_matches('\r');
        if let Some((c, n)) = fence(line) {
            open = match open {
                None => Some((c, n)),
                Some((oc, on)) if oc == c && n >= on && line.trim().trim_matches(c).is_empty() => {
                    None
                }
                still_open => still_open,
            };
            continue;
        }
        if open.is_some() {
            continue;
        }
        if let Some(heading) = atx_heading(line) {
            headings.push(Heading {
                start: line_start,
                text: heading.to_string(),
            });
        }
    }
    Outline { headings }
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

fn paragraph_tags(mut text: &str) -> Option<Vec<&str>> {
    // The client stops inspecting a tag paragraph when its next text node
    // starts with a newline followed by prose; inline markup still disqualifies it.
    let mut events = Parser::new(text).into_offset_iter().peekable();
    while let Some((event, range)) = events.next() {
        if event == Event::SoftBreak {
            if text[range.end..].starts_with([' ', '\t']) {
                text = &text[..range.start];
                break;
            }
            if let Some((Event::Text(_), _)) = events.peek() {
                let source = &text[range.end..];
                let silverbullet_inline = ((source.starts_with("[[") || source.starts_with("![["))
                    && source.contains("]]"))
                    || (source.starts_with('@')
                        && source
                            .chars()
                            .nth(1)
                            .is_some_and(|c| c.is_alphanumeric() || c == '_'))
                    || (source.starts_with('$')
                        && source
                            .chars()
                            .nth(1)
                            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '{'))
                    || source.starts_with("http://")
                    || source.starts_with("https://")
                    || (source.starts_with('[') && source.contains(':') && source.contains(']'))
                    || (source.starts_with("==") && source[2..].contains("=="));
                if !source.starts_with(['#', '\\']) && !silverbullet_inline {
                    text = &text[..range.start];
                    break;
                }
            }
        }
    }
    let mut tags = Vec::new();
    while !text.trim_start().is_empty() {
        text = text.trim_start().strip_prefix('#')?;
        let (tag, rest) = if let Some(angled) = text.strip_prefix('<') {
            let end = angled.find('>')?;
            let tag = &angled[..end];
            if tag.is_empty() || tag.contains('\n') {
                return None;
            }
            (tag, &angled[end + 1..])
        } else {
            let end = text
                .find(|c: char| c.is_whitespace() || "!@#$%^&*(),.?\":{}|<>\\".contains(c))
                .unwrap_or(text.len());
            let tag = &text[..end];
            let first = tag.chars().find(|c| !c.is_ascii_digit())?;
            if "';/–—".contains(first) || tag.ends_with('-') {
                return None;
            }
            (tag, &text[end..])
        };
        tags.push(tag);
        text = rest;
    }
    (!tags.is_empty()).then_some(tags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_and_body() {
        let page = parse_page(
            "---\r\ntags: '#meta/api, glossary'\r\ndescription: 'A & B'\r\n---\r\n# Notes\r\n",
        );
        assert_eq!(page.metadata.tags, ["meta/api", "glossary"]);
        assert_eq!(page.metadata.description.as_deref(), Some("A & B"));
        assert_eq!(page.metadata.kind(), PageKind::Meta);
        assert_eq!(page.body, "# Notes\r\n");
        assert_eq!(
            parse_page("---\ntags: [meta, '#meta', api/syscall]\n---\n")
                .metadata
                .tags,
            ["meta", "api/syscall"]
        );
    }

    #[test]
    fn only_standalone_top_level_tags_classify_pages() {
        for text in [
            "#meta",
            "#meta\nPlain prose",
            "#meta\r\nPlain prose",
            "#meta/api;",
            "#<meta/api> #glossary",
            "Heading\n\n#meta/config\n\nBody",
            "---\ntags: [broken\n---\n#meta",
            "#template",
            "---\ntags: template\n---\nBody",
            "---\ntags: [glossary, template]\n---\n",
        ] {
            assert_eq!(parse_page(text).metadata.kind(), PageKind::Meta, "{text}");
        }
        for text in [
            "Text #meta",
            "#meta\n[[Other]]",
            "#meta\n![[Other]]",
            "#meta\n@someone",
            "#meta\n`example`",
            "#meta\n#glossary prose",
            "```markdown\n#meta\n```",
            "    #meta",
            "> #meta",
            "- #meta",
            "`#meta`",
            "\\#meta",
            "#metaphor",
            "#meta-",
            "#meta/api prose",
            "# meta",
            "#templates",
            "#template/page",
            "Text #template",
        ] {
            assert_eq!(
                parse_page(text).metadata.kind(),
                PageKind::Content,
                "{text}"
            );
        }
        assert_eq!(
            parse_page("#glossary\n  #meta/api").metadata.tags,
            ["glossary"]
        );
        assert_eq!(
            parse_page("#glossary\n#meta/api").metadata.tags,
            ["glossary", "meta/api"]
        );
    }

    fn texts(text: &str) -> Vec<String> {
        outline(text).headings.into_iter().map(|h| h.text).collect()
    }

    #[test]
    fn outline_skips_frontmatter_as_the_classifier_splits_it() {
        let text = "---\ntags: x\n# not a heading\n---\n# Real\nbody";
        let o = outline(text);
        assert_eq!(
            o.headings,
            [Heading {
                start: text.find("# Real").unwrap(),
                text: "Real".into()
            }]
        );
        assert_eq!(texts("---\r\n# x\r\n---\r\n# Real\r\n"), ["Real"]);
        // Unclosed: no frontmatter, so the heading inside counts.
        assert_eq!(texts("---\nnot closed\n\n# Real\n\nx"), ["Real"]);
    }

    #[test]
    fn outline_frontmatter_is_closed_by_dashes_only_without_trailing_spaces() {
        // `...` closes YAML documents but not SilverBullet frontmatter.
        assert_eq!(
            texts("---\n# inside\n...\nHello\n\n# H\n\nbody"),
            ["inside", "H"]
        );
        // `---` with trailing spaces neither opens nor closes it.
        assert_eq!(texts("--- \n# inside\n---\n# H"), ["inside", "H"]);
        assert_eq!(texts("---\n# inside\n---  \n# H"), ["inside", "H"]);
        assert_eq!(texts("--- \n# inside\n---\n"), ["inside"]);
    }

    #[test]
    fn outline_reads_atx_headings_only() {
        assert_eq!(texts("#\tTitle"), ["Title"]);
        assert_eq!(texts("## Title ##"), ["Title"]);
        assert_eq!(texts("# C#"), ["C#"]);
        assert_eq!(texts("#"), [""]);
        assert_eq!(texts("   # ok\n    # code"), ["ok"]);
        assert_eq!(
            texts("#tag\n####### seven\nTitle\n====="),
            Vec::<String>::new()
        );
    }

    #[test]
    fn outline_ignores_headings_in_fenced_code() {
        assert_eq!(texts("```sh\n# no\n```\n# yes"), ["yes"]);
        assert_eq!(texts("~~~~\n# no\n~~~\n# still code\n~~~~\n# yes"), ["yes"]);
        assert_eq!(
            texts("```npm i```\n# Setup"),
            ["Setup"],
            "an inline code span"
        );
        // A tilde info string may hold tildes, so this opens a fence.
        assert_eq!(texts("~~~x~~~\n# Later"), Vec::<String>::new());
        assert_eq!(
            texts("```\n# no\n``` x\n# still code"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn heading_above_is_the_nearest_earlier_non_empty_heading() {
        let text = "intro\n# Top\nline\n## Sub\nmore\n#\nafter";
        let o = outline(text);
        let at = |needle: &str| o.heading_above(text.find(needle).unwrap());
        assert_eq!(at("intro"), None);
        assert_eq!(at("# Top"), None, "a heading line isn't under itself");
        assert_eq!(at("line"), Some("Top"));
        assert_eq!(at("more"), Some("Sub"));
        assert_eq!(at("after"), None, "a bare `#` ends the section");
    }
}
