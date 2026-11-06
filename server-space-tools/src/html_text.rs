//! Rendered pages hold widgets as HTML blocks; an agent needs their text, not
//! their markup, so each block becomes one line per block element.

/// Elements that start a new line of text.
const BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "thead",
    "tr",
    "ul",
];
/// Elements whose content is never visible text.
const HIDDEN_TAGS: &[&str] = &["script", "style", "template"];

fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The visible text of `html`: one line per block element, cells of a row
/// separated by " | ", whitespace collapsed.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut hidden: Option<String> = None;
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        if hidden.is_none() {
            out.push_str(&rest[..start]);
        }
        let Some(len) = rest[start..].find('>') else {
            rest = &rest[start..];
            break;
        };
        let tag = &rest[start + 1..start + len];
        rest = &rest[start + len + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        if let Some(open) = &hidden {
            if closing && *open == name {
                hidden = None;
            }
            continue;
        }
        if !closing && HIDDEN_TAGS.contains(&name.as_str()) {
            hidden = Some(name);
        } else if BLOCK_TAGS.contains(&name.as_str()) {
            out.push('\n');
        } else if !closing && (name == "td" || name == "th") {
            out.push_str(" | ");
        }
    }
    if hidden.is_none() {
        out.push_str(rest);
    }
    decode_entities(&out)
        .lines()
        .map(|line| {
            let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
            line.trim_start_matches(" | ")
                .trim_start_matches("| ")
                .to_owned()
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Whether every tag in `html` is table structure, as in a query result:
/// its text then says all it shows.
fn only_table_markup(html: &str) -> bool {
    const TABLE_TAGS: &[&str] = &["table", "thead", "tbody", "tfoot", "tr", "th", "td"];
    html.split('<').skip(1).all(|tag| {
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect();
        TABLE_TAGS.contains(&name.to_ascii_lowercase().as_str())
    })
}

/// `rendered` with every line that is an HTML block replaced by its text,
/// and whether any of those showed more than its text (a widget, not just a
/// query table).
pub fn compact_rendered(rendered: &str) -> (String, bool) {
    let mut lossy = false;
    let lines: Vec<String> = rendered
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if trimmed.starts_with('<') && trimmed.contains('>') {
                lossy |= !only_table_markup(trimmed);
                html_to_text(trimmed)
            } else {
                line.to_owned()
            }
        })
        .collect();
    (lines.join("\n"), lossy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_markup_becomes_lines_of_text() {
        let html = "<div class=\"pd-header\"><div class=\"pd-title\"><span class=\"p\">Paddock</span></div>\
            <div><span>15 of 23 rounds</span> &amp; <a>more</a></div></div>";
        assert_eq!(html_to_text(html), "Paddock\n15 of 23 rounds & more");
    }

    #[test]
    fn table_rows_keep_their_cells_and_hidden_content_goes() {
        let html = "<style>.x{color:red}</style><table><tr><th>Team</th><th>Wins</th></tr>\
            <tr><td>Blue</td><td>3</td></tr></table><script>alert(1)</script>";
        assert_eq!(html_to_text(html), "Team | Wins\nBlue | 3");
    }

    #[test]
    fn only_html_lines_are_compacted() {
        let (text, any) = compact_rendered("# Title\n\n<div><span>Hi</span></div>\n| a | b |");
        assert!(any);
        assert_eq!(text, "# Title\n\nHi\n| a | b |");
        let (text, any) = compact_rendered("plain");
        assert!(!any);
        assert_eq!(text, "plain");
    }

    #[test]
    fn a_query_table_is_text_and_is_not_flagged() {
        let (text, lossy) = compact_rendered(
            "<table><thead><tr><th>table</th></tr></thead><tbody>\
             <tr><td data-table-cell-type=\"string\">[[A]]</td></tr></tbody></table>",
        );
        assert!(!lossy);
        assert_eq!(text, "table\n[[A]]");
        let (_, lossy) = compact_rendered("<table><tr><td><button>Go</button></td></tr></table>");
        assert!(lossy);
    }
}
