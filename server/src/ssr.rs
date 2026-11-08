//! Best-effort server-side markdown rendering. This exists *only* so that a
//! public, read-only wiki (read-only space with no authentication) serves
//! crawlable HTML to search engines — it is not a full SilverBullet markdown
//! implementation.

use std::ops::Range;

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use pulldown_cmark::{html, Event, Options, Parser, Tag};
use regex::Regex;

use crate::link_resolve::{encode_ref, normalize_path, resolve_path, split_ref, BasenameIndex};

/// The space's files plus the URL prefix the server is mounted under, together
/// enough to turn a wiki link target into an href.
pub struct SpaceLinks {
    index: BasenameIndex,
    url_prefix: String,
}

impl SpaceLinks {
    pub fn new<I, S>(paths: I, url_prefix: &str) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            index: BasenameIndex::from_paths(paths),
            url_prefix: url_prefix.to_string(),
        }
    }
}

/// Rewrite `[[wiki links]]` into standard markdown links so the markdown
/// renderer turns them into anchors. Targets are resolved against the space the
/// same way the client resolves them (see `link_resolve`); a target that does
/// not resolve — or a missing `links` — keeps the author's text as the href.
/// The link text is always what the author wrote.
pub fn convert_wiki_links(input: &str, current_path: &str, links: Option<&SpaceLinks>) -> String {
    let mut protected = markdown_literal_ranges(input);
    protected.extend(lua_expression_ranges(input, &protected));
    let re = Regex::new(r"\[\[([^\]]+)\]\]").expect("static regex");
    re.replace_all(input, |caps: &regex::Captures| {
        let found = caps.get(0).expect("whole match");
        if escaped(input.as_bytes(), found.start())
            || protected
                .iter()
                .any(|range| range.start < found.end() && found.start() < range.end)
        {
            found.as_str().to_string()
        } else {
            rewrite_link(&caps[1], current_path, links)
        }
    })
    .into_owned()
}

fn markdown_literal_ranges(input: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut literal_tags: Vec<(String, usize)> = Vec::new();
    let literal_tag = Regex::new(r"(?i)^<(/?)(code|pre)(?:\s|/?>)").expect("static regex");
    for (event, range) in Parser::new_ext(input, markdown_options()).into_offset_iter() {
        match event {
            Event::Code(_)
            | Event::Html(_)
            | Event::Start(Tag::CodeBlock(_) | Tag::Link { .. } | Tag::Image { .. }) => {
                ranges.push(range)
            }
            Event::InlineHtml(html) => {
                if let Some(tag) = literal_tag.captures(&html) {
                    if &tag[1] == "/" {
                        if let Some(index) = literal_tags
                            .iter()
                            .rposition(|(name, _)| name.eq_ignore_ascii_case(&tag[2]))
                        {
                            ranges.push(literal_tags[index].1..range.end);
                            literal_tags.truncate(index);
                        }
                    } else if !html.trim_end().ends_with("/>") {
                        literal_tags.push((tag[2].to_owned(), range.start));
                    }
                }
                ranges.push(range);
            }
            _ => {}
        }
    }
    ranges.extend(
        literal_tags
            .into_iter()
            .map(|(_, start)| start..input.len()),
    );
    ranges
}

fn escaped(bytes: &[u8], at: usize) -> bool {
    bytes[..at]
        .iter()
        .rev()
        .take_while(|&&byte| byte == b'\\')
        .count()
        % 2
        == 1
}

// CommonMark does not know Lua expressions. Skip their quoted strings and
// comments while balancing braces so a query's [[...]] is never a wiki link.
fn lua_expression_ranges(input: &str, protected: &[Range<usize>]) -> Vec<Range<usize>> {
    let bytes = input.as_bytes();
    let mut ranges = Vec::new();
    let mut at = 0;
    while at + 1 < bytes.len() {
        if bytes[at..].starts_with(b"${")
            && !escaped(bytes, at)
            && !protected.iter().any(|range| range.contains(&at))
        {
            let end = lua_expression_end(bytes, at + 2);
            ranges.push(at..end);
            at = end;
        } else {
            at += 1;
        }
    }
    ranges
}

fn lua_expression_end(bytes: &[u8], mut at: usize) -> usize {
    let mut depth = 1;
    while at < bytes.len() {
        match bytes[at] {
            b'\'' | b'"' => {
                let quote = bytes[at];
                at += 1;
                while at < bytes.len() {
                    if bytes[at] == b'\\' {
                        at = (at + 2).min(bytes.len());
                    } else if bytes[at] == quote {
                        at += 1;
                        break;
                    } else {
                        at += 1;
                    }
                }
            }
            b'-' if bytes[at..].starts_with(b"--") => {
                at += 2;
                if let Some(end) = lua_long_string_end(bytes, at) {
                    at = end;
                } else {
                    while at < bytes.len() && bytes[at] != b'\n' {
                        at += 1;
                    }
                }
            }
            b'[' => {
                at = lua_long_string_end(bytes, at).unwrap_or(at + 1);
            }
            b'{' => {
                depth += 1;
                at += 1;
            }
            b'}' => {
                depth -= 1;
                at += 1;
                if depth == 0 {
                    return at;
                }
            }
            _ => at += 1,
        }
    }
    bytes.len()
}

fn lua_long_string_end(bytes: &[u8], at: usize) -> Option<usize> {
    if bytes.get(at) != Some(&b'[') {
        return None;
    }
    let mut open_end = at + 1;
    while bytes.get(open_end) == Some(&b'=') {
        open_end += 1;
    }
    if bytes.get(open_end) != Some(&b'[') {
        return None;
    }
    let equals = open_end - at - 1;
    let mut cursor = open_end + 1;
    while cursor < bytes.len() {
        if bytes[cursor] == b']' {
            let close = cursor + equals + 1;
            if bytes.get(close) == Some(&b']')
                && bytes[cursor + 1..close].iter().all(|&byte| byte == b'=')
            {
                return Some(close + 1);
            }
        }
        cursor += 1;
    }
    Some(bytes.len())
}

fn rewrite_link(inner: &str, current_path: &str, links: Option<&SpaceLinks>) -> String {
    let (target, text) = match inner.split_once('|') {
        Some((target, alias)) => (target, alias),
        None => (inner, inner),
    };
    let href = resolve_href(target, current_path, links).unwrap_or_else(|| target.to_string());
    // Angle brackets keep destinations containing spaces parseable as links.
    format!("[{text}](<{href}>)")
}

fn resolve_href(target: &str, current_path: &str, links: Option<&SpaceLinks>) -> Option<String> {
    let links = links?;
    let (ref_path, details) = split_ref(target.strip_prefix('^').unwrap_or(target))?;
    let path = normalize_path(ref_path);
    let resolved = resolve_path(&path, current_path, &links.index);
    if !resolved.exists {
        return None;
    }
    let path = if resolved.path.is_empty() {
        current_path
    } else {
        &resolved.path
    };
    const PATH: &AsciiSet = &NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'~')
        .remove(b'/');
    const FRAGMENT: &AsciiSet = &NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'~');
    let fragment = details
        .strip_prefix('#')
        .map(|header| format!("#{}", utf8_percent_encode(header.trim(), FRAGMENT)))
        .unwrap_or_default();
    Some(format!(
        "{}/{}{}",
        links.url_prefix,
        utf8_percent_encode(encode_ref(path), PATH),
        fragment
    ))
}

fn markdown_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
}

/// Render a page while retaining its original heading references. Wiki links
/// inside headings are converted after their public anchor IDs are collected.
pub fn render_page_markdown(input: &str, current_path: &str, links: Option<&SpaceLinks>) -> String {
    render_with_heading_ids(
        &literal_lua_expressions(&convert_wiki_links(input, current_path, links)),
        heading_ids(input),
    )
}

fn literal_lua_expressions(input: &str) -> String {
    let ranges = lua_expression_ranges(input, &markdown_literal_ranges(input));
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;
    for range in ranges {
        output.push_str(&input[cursor..range.start]);
        // Entities become text without CommonMark reinterpreting Lua strings as
        // links, HTML or block syntax. Encode newlines to keep a single block.
        for character in input[range.clone()].chars() {
            if character.is_ascii_punctuation() || matches!(character, '\n' | '\r') {
                output.push_str(&format!("&#{};", character as u32));
            } else {
                output.push(character);
            }
        }
        cursor = range.end;
    }
    output.push_str(&input[cursor..]);
    output
}

fn heading_ids(input: &str) -> Vec<Option<String>> {
    let expressions = lua_expression_ranges(input, &markdown_literal_ranges(input));
    Parser::new_ext(input, markdown_options())
        .into_offset_iter()
        .filter_map(|(event, range)| {
            if let Event::Start(Tag::Heading { id, .. }) = event {
                if expressions
                    .iter()
                    .any(|expression| expression.contains(&range.start))
                {
                    return None;
                }
                let source = input[range].trim();
                // Client heading references retain inline Markdown punctuation.
                Some(id.map(|id| id.into_string()).or_else(|| {
                    source
                        .strip_prefix('#')
                        .map(|rest| rest.trim_start_matches('#').trim().to_owned())
                }))
            } else {
                None
            }
        })
        .collect()
}

fn render_with_heading_ids(text: &str, ids: Vec<Option<String>>) -> String {
    let mut ids = ids.into_iter();
    let events = Parser::new_ext(text, markdown_options()).map(|mut event| {
        if let Event::Start(Tag::Heading { id, .. }) = &mut event {
            if let Some(Some(original)) = ids.next() {
                *id = Some(original.into());
            }
        }
        match event {
            Event::Html(text) | Event::InlineHtml(text) => Event::Text(text),
            Event::Start(
                Tag::Link {
                    ref mut dest_url, ..
                }
                | Tag::Image {
                    ref mut dest_url, ..
                },
            ) => {
                if !safe_url(dest_url) {
                    *dest_url = "#".into();
                }
                event
            }
            _ => event,
        }
    });
    let mut out = String::new();
    html::push_html(&mut out, events);
    out
}

fn safe_url(url: &str) -> bool {
    let url = url.trim();
    if url.chars().any(char::is_control) {
        return false;
    }
    let prefix = url.split(['/', '?', '#', '\\']).next().unwrap_or("");
    match prefix.split_once(':') {
        Some((scheme, _)) => matches!(
            scheme.to_ascii_lowercase().as_str(),
            "http" | "https" | "mailto" | "tel"
        ),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn links(paths: &[&str]) -> SpaceLinks {
        SpaceLinks::new(paths.iter().copied(), "")
    }

    fn render_markdown(text: &str) -> String {
        render_with_heading_ids(text, heading_ids(text))
    }

    #[test]
    fn stored_html_and_unsafe_links_cannot_execute_in_ssr() {
        let html = render_page_markdown(
            "# Heading\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29) [encoded](java&#x73;cript:alert%281%29) ![image](data:text/html,payload) [[Home]]",
            "Notes.md", None,
        );
        assert!(!html.contains("<script"), "{html}");
        assert!(!html.contains("<img src=\"x\""), "{html}");
        assert!(!html.contains("href=\"javascript:"), "{html}");
        assert!(!html.contains("src=\"data:"), "{html}");
        assert!(html.contains("&lt;script&gt;"), "{html}");
        assert!(html.contains("id=\"Heading\""), "{html}");
        assert!(html.contains("href=\"Home\""), "{html}");
        for url in [
            "javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "java\nscript:alert(1)",
            "data:text/html,x",
            "vbscript:x",
        ] {
            assert!(!safe_url(url), "{url}");
        }
        for url in [
            "https://example.test",
            "/Page",
            "#Heading",
            "./Page",
            "mailto:person@example.test",
        ] {
            assert!(safe_url(url), "{url}");
        }
    }

    #[test]
    fn converts_single_wiki_link() {
        assert_eq!(
            convert_wiki_links("see [[Home]]", "Page.md", None),
            "see [Home](<Home>)"
        );
    }

    #[test]
    fn converts_multiple_wiki_links() {
        assert_eq!(
            convert_wiki_links("[[a]] and [[b]]", "Page.md", None),
            "[a](<a>) and [b](<b>)"
        );
    }

    #[test]
    fn leaves_plain_text_untouched() {
        assert_eq!(
            convert_wiki_links("no links here", "Page.md", None),
            "no links here"
        );
    }

    #[test]
    fn resolves_bare_name_to_its_full_path() {
        let links = links(&["sub/folder/Notes.md", "Page.md"]);
        assert_eq!(
            convert_wiki_links("[[Notes]]", "Page.md", Some(&links)),
            "[Notes](</sub/folder/Notes>)"
        );
    }

    #[test]
    fn unresolved_link_stays_literal() {
        let links = links(&["Page.md"]);
        assert_eq!(
            convert_wiki_links("[[Missing]]", "Page.md", Some(&links)),
            "[Missing](<Missing>)"
        );
    }

    #[test]
    fn preserves_alias_and_detail_suffix() {
        let links = links(&["sub/Notes.md", "Page.md"]);
        assert_eq!(
            convert_wiki_links("[[Notes#Intro|read this]]", "Page.md", Some(&links)),
            "[read this](</sub/Notes#Intro>)"
        );
    }

    #[test]
    fn honors_the_url_prefix() {
        let links = SpaceLinks::new(["sub/Notes.md"], "/wiki");
        assert_eq!(
            convert_wiki_links("[[Notes]]", "Page.md", Some(&links)),
            "[Notes](</wiki/sub/Notes>)"
        );
    }

    #[test]
    fn self_link_targets_the_current_page() {
        let links = links(&["docs/Page.md"]);
        assert_eq!(
            convert_wiki_links("[[#Intro]]", "docs/Page.md", Some(&links)),
            "[#Intro](</docs/Page#Intro>)"
        );
    }

    #[test]
    fn documents_keep_their_extension() {
        let links = links(&["assets/diagram.png", "Page.md"]);
        assert_eq!(
            convert_wiki_links("[[diagram.png]]", "Page.md", Some(&links)),
            "[diagram.png](</assets/diagram.png>)"
        );
    }

    #[test]
    fn renders_heading_and_paragraph() {
        let html = render_markdown("# Title\n\nHello **world**");
        assert!(html.contains("<h1"), "expected h1, got: {html}");
        assert!(html.contains("<strong>world</strong>"), "got: {html}");
    }

    #[test]
    fn renders_converted_wiki_link_as_anchor() {
        let html = render_markdown(&convert_wiki_links("[[Home]]", "Page.md", None));
        assert!(html.contains(r#"href="Home""#), "got: {html}");
        assert!(html.contains(">Home</a>"), "got: {html}");
    }

    #[test]
    fn renders_resolved_link_with_spaces_as_anchor() {
        let links = links(&["sub/My Page.md", "Page.md"]);
        let html = render_markdown(&convert_wiki_links("[[My Page]]", "Page.md", Some(&links)));
        assert!(html.contains(r#"href="/sub/My%20Page""#), "got: {html}");
    }

    #[test]
    fn code_and_lua_are_not_rewritten_as_wiki_links() {
        let source = "`[[Code]]`\n\n```lua\nquery[[from index.pages()]]\n```\n\n    [[Indented]]\n\n${query[[from index.pages()]]}\n\n${{text = '} [[String]]', nested = {1}, query = query[=[from p]=]}} [[Real]]";
        let converted = convert_wiki_links(source, "Page.md", None);
        assert!(converted.contains("`[[Code]]`"), "{converted}");
        assert!(
            converted.contains("query[[from index.pages()]]"),
            "{converted}"
        );
        assert!(converted.contains("    [[Indented]]"), "{converted}");
        assert!(converted.contains("[[String]]"), "{converted}");
        let html = render_markdown(&converted);
        assert_eq!(html.matches("<a ").count(), 1, "{html}");
        assert!(html.contains("href=\"Real\""), "{html}");
    }

    #[test]
    fn preserves_existing_markdown_link_destinations_and_escaped_wiki_syntax() {
        let source = r"[manual](https://example.test/a%23b?q=x#fragment) ![label](image.png) `[[Code]]` \[[Escaped]] [label [[Literal]]](relative.md) [[Real]]";
        let converted = convert_wiki_links(source, "Page.md", None);
        assert!(
            converted.contains("[label [[Literal]]](relative.md)"),
            "{converted}"
        );
        assert!(converted.contains(r"\[[Escaped]]"), "{converted}");
        assert!(converted.contains("https://example.test/a%23b?q=x#fragment"));
    }

    #[test]
    fn lua_comments_and_long_strings_do_not_end_the_expression_early() {
        let source = "`${ unfinished` ${\n -- } [[comment]]\n query[==[ } [[query text]] ]==] --[=[ } [[long comment]] ]=]\n} [[Real]]";
        let html = render_markdown(&convert_wiki_links(source, "Page.md", None));
        assert_eq!(html.matches("<a ").count(), 1, "{html}");
        assert!(html.contains("href=\"Real\""), "{html}");
        let unfinished = "${query[[from p]] [[still source]]";
        assert_eq!(convert_wiki_links(unfinished, "Page.md", None), unfinished);
    }

    #[test]
    fn html_attributes_and_image_labels_keep_literal_brackets() {
        let source = r#"<span title="[[literal]]">text</span> ![[[image label]]](relative.png) [[https://example.test/path?x=1#part|external]]"#;
        let converted = convert_wiki_links(source, "Page.md", None);
        assert!(converted.contains(r#"title="[[literal]]""#), "{converted}");
        assert!(
            converted.contains("![[[image label]]](relative.png)"),
            "{converted}"
        );
        let html = render_markdown(&converted);
        assert!(
            html.contains("href=\"https://example.test/path?x=1#part\""),
            "{html}"
        );
    }

    #[test]
    fn public_urls_resolve_meta_and_position_references() {
        let links = links(&["Library/Std/Config.md", "CHANGELOG.md", "Page.md"]);
        let html = render_markdown(&convert_wiki_links(
            "[[^Library/Std/Config|settings]] [[CHANGELOG@123]] [[CHANGELOG@L12C42]] [[$bookmark]]",
            "Page.md",
            Some(&links),
        ));
        assert!(html.contains("href=\"/Library/Std/Config\""), "{html}");
        assert_eq!(html.matches("href=\"/CHANGELOG\"").count(), 2, "{html}");
        assert!(html.contains("href=\"/Page\""), "{html}");
    }

    #[test]
    fn encodes_literal_path_characters_once_and_keeps_header_separate() {
        let links = links(&["Café%23plan?.md", "Page.md"]);
        let html = render_markdown(&convert_wiki_links(
            "[[Café%23plan?#A & B|read]]",
            "Page.md",
            Some(&links),
        ));
        assert!(
            html.contains("href=\"/Caf%C3%A9%2523plan%3F#A%20%26%20B\""),
            "{html}"
        );
    }

    #[test]
    fn headings_have_targets_for_public_heading_links() {
        let html = render_markdown("# A & B\n\n## Explicit {#custom}\n");
        assert!(html.contains("id=\"A &amp; B\""), "{html}");
        assert!(html.contains("id=\"custom\""), "{html}");
    }

    #[test]
    fn formatted_headings_match_raw_client_heading_references() {
        let links = links(&["Page.md", "Other.md"]);
        let html = render_page_markdown(
            "# **Bold**\n\n[[Page# **Bold** ]]\n\n# [[Other]]\n",
            "Page.md",
            Some(&links),
        );
        assert!(html.contains("id=\"**Bold**\""), "{html}");
        assert!(html.contains("href=\"/Page#%2A%2ABold%2A%2A\""), "{html}");
        assert!(html.contains("id=\"[[Other]]\""), "{html}");
        assert!(html.contains("<a href=\"/Other\">Other</a>"), "{html}");
        assert!(!html.contains("<a href=\"/Other\"><a"), "{html}");
    }

    #[test]
    fn raw_html_code_preserves_wiki_examples_but_span_text_still_links() {
        let html = render_markdown(&convert_wiki_links(
            "<code>[[Home]]</code> and <span>[[Home]]</span>\n\n<pre>[[Home]]</pre>",
            "Page.md",
            None,
        ));
        assert!(html.contains("&lt;code&gt;[[Home]]&lt;/code&gt;"), "{html}");
        assert!(html.contains("&lt;pre&gt;[[Home]]&lt;/pre&gt;"), "{html}");
        assert_eq!(html.matches("<a ").count(), 1, "{html}");
    }

    #[test]
    fn glossary_lua_expression_does_not_create_markdown_links() {
        let source = include_str!("../../docs/Glossary.md");
        let html = render_page_markdown(source, "Glossary.md", None);
        assert!(!html.contains("<a "), "{html}");
        assert!(html.contains("template.new[==["), "{html}");
        assert!(html.contains("[[${name}]]: ${description}"), "{html}");
    }

    #[test]
    fn lua_markup_stays_literal_without_consuming_later_heading_ids() {
        let source =
            "${[=[\n# Hidden\n<a href='bad'>bad</a> [bad](bad)\n]=]}\n\n# Visible\n\n[[Home]]";
        let html = render_page_markdown(source, "Page.md", None);
        assert_eq!(html.matches("<a ").count(), 1, "{html}");
        assert!(html.contains("&lt;a href="), "{html}");
        assert!(html.contains("id=\"Visible\""), "{html}");
        assert!(!html.contains("id=\"Hidden\""), "{html}");
    }

    #[test]
    fn empty_input_is_empty_output() {
        assert_eq!(render_markdown(""), "");
    }
}
