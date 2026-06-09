//! Best-effort server-side markdown rendering. This exists *only* so that a
//! public, read-only wiki (read-only space with no authentication) serves
//! crawlable HTML to search engines — it is not a full SilverBullet markdown
//! implementation.

use pulldown_cmark::{html, Options, Parser};
use regex::Regex;

/// Rewrite `[[wiki links]]` into standard markdown `[wiki links](wiki links)`
/// so the markdown renderer turns them into anchors. Crude on purpose — the
/// link target is the link text verbatim.
pub fn convert_wiki_links(input: &str) -> String {
    // `[[...]]` with no `]` inside the brackets.
    let re = Regex::new(r"\[\[([^\]]+)\]\]").expect("static regex");
    re.replace_all(input, "[${1}](${1})").into_owned()
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

    #[test]
    fn converts_single_wiki_link() {
        assert_eq!(convert_wiki_links("see [[Home]]"), "see [Home](Home)");
    }

    #[test]
    fn converts_multiple_wiki_links() {
        assert_eq!(convert_wiki_links("[[a]] and [[b]]"), "[a](a) and [b](b)");
    }

    #[test]
    fn leaves_plain_text_untouched() {
        assert_eq!(convert_wiki_links("no links here"), "no links here");
    }

    #[test]
    fn renders_heading_and_paragraph() {
        let html = render_markdown("# Title\n\nHello **world**");
        assert!(html.contains("<h1"), "expected h1, got: {html}");
        assert!(html.contains("<strong>world</strong>"), "got: {html}");
    }

    #[test]
    fn renders_converted_wiki_link_as_anchor() {
        let html = render_markdown(&convert_wiki_links("[[Home]]"));
        assert!(html.contains(r#"href="Home""#), "got: {html}");
        assert!(html.contains(">Home</a>"), "got: {html}");
    }

    #[test]
    fn empty_input_is_empty_output() {
        assert_eq!(render_markdown(""), "");
    }
}
