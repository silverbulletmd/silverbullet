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
    pub fn kind(&self) -> PageKind {
        if self
            .tags
            .iter()
            .any(|tag| tag == "meta" || tag.starts_with("meta/"))
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
}
