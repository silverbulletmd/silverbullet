//! Best-effort server-side markdown rendering. This exists *only* so that a
//! public, read-only wiki (read-only space with no authentication) serves
//! crawlable HTML to search engines — it is not a full SilverBullet markdown
//! implementation.

use pulldown_cmark::{html, Options, Parser};
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
    // `[[...]]` with no `]` inside the brackets.
    let re = Regex::new(r"\[\[([^\]]+)\]\]").expect("static regex");
    re.replace_all(input, |caps: &regex::Captures| {
        rewrite_link(&caps[1], current_path, links)
    })
    .into_owned()
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
    let (ref_path, details) = split_ref(target)?;
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
    Some(format!(
        "{}/{}{}",
        links.url_prefix,
        encode_ref(path),
        details
    ))
}

/// Render markdown to an HTML fragment. Enables the common GitHub-ish
/// extensions (tables, strikethrough, footnotes, task lists). Empty input
/// yields empty output.
pub fn render_markdown(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    let parser = Parser::new_ext(text, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn links(paths: &[&str]) -> SpaceLinks {
        SpaceLinks::new(paths.iter().copied(), "")
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
    fn empty_input_is_empty_output() {
        assert_eq!(render_markdown(""), "");
    }
}
