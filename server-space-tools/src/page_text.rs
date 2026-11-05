//! Page text helpers: outlines, numbered line ranges and closest matches.

const LEVENSHTEIN_CHARS: usize = 200;

/// Whether `text` has a `space-lua` or `space-style` block, which the runtime
/// only applies once it reloads.
pub fn has_scripts(text: &str) -> bool {
    text.lines().any(|line| {
        let rest = line.trim_start().trim_start_matches('`');
        line.trim_start().starts_with("```")
            && (rest.starts_with("space-lua") || rest.starts_with("space-style"))
    })
}

/// Whether writing `new` over `old` (`None` when there was no page) to
/// `path` needs a script reload: removing a script needs one as much as
/// adding one.
pub fn needs_reload(path: &str, old: Option<&str>, new: &str) -> bool {
    path.ends_with(".md") && (old.is_some_and(has_scripts) || has_scripts(new))
}

pub fn numbered(line_no: usize, line: &str) -> String {
    format!("{line_no:>5}\t{line}")
}

/// The 1-based, inclusive line range `offset` and `limit` select in `total`
/// lines of `what` ("page", "file", ...); `end < start` when it is empty.
pub fn line_range(
    total: usize,
    offset: Option<usize>,
    limit: Option<usize>,
    what: &str,
) -> Result<(usize, usize), String> {
    let start = offset.unwrap_or(1);
    if start > total.max(1) {
        return Err(format!(
            "offset {start} is beyond the end of the {what} ({total} lines)"
        ));
    }
    let end = limit.map_or(total, |limit| (start - 1).saturating_add(limit).min(total));
    Ok((start, end))
}

/// Lines `start..=end` of `lines`, joined by newlines.
pub struct Slice {
    pub text: String,
    /// The first line left out because the slice reached its byte cap.
    pub next_line: Option<usize>,
}

/// Lines `start..=end` of `lines` ([`numbered`] when `number`), up to
/// `max_bytes`. A first line longer than the cap is cut to it.
pub fn slice_lines(
    lines: &[&str],
    (start, end): (usize, usize),
    number: bool,
    max_bytes: usize,
) -> Slice {
    let mut text = String::new();
    let mut next_line = None;
    for (i, line) in lines.iter().enumerate().take(end).skip(start - 1) {
        let line_no = i + 1;
        let piece = if number {
            numbered(line_no, line)
        } else {
            (*line).to_owned()
        };
        let sep = usize::from(!text.is_empty());
        if text.len() + sep + piece.len() > max_bytes {
            if text.is_empty() {
                text.push_str(truncate_to_boundary(&piece, max_bytes));
                next_line = Some(line_no + 1);
            } else {
                next_line = Some(line_no);
            }
            break;
        }
        if sep == 1 {
            text.push('\n');
        }
        text.push_str(&piece);
    }
    Slice { text, next_line }
}

/// Lines worth navigating by in a page, with their 1-based numbers: headings,
/// the start of each fenced block with its language, and Lua function
/// definitions.
pub fn outline_entries(lines: &[&str]) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut fence: Option<String> = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if let Some(open) = &fence {
            if trimmed.starts_with(open.as_str())
                && trimmed.trim_start_matches('`').trim().is_empty()
            {
                fence = None;
                continue;
            }
            let code = trimmed.trim_start_matches("local ");
            let is_function = code.starts_with("function ")
                || code
                    .split_once('=')
                    .is_some_and(|(_, rhs)| rhs.trim_start().starts_with("function"));
            if is_function {
                out.push((i + 1, line.trim_end().to_owned()));
            }
            continue;
        }
        if trimmed.starts_with("```") {
            let ticks: String = trimmed.chars().take_while(|c| *c == '`').collect();
            fence = Some(ticks);
            out.push((i + 1, line.trim_end().to_owned()));
        } else if trimmed.starts_with('#') && trimmed.trim_start_matches('#').starts_with(' ') {
            out.push((i + 1, line.trim_end().to_owned()));
        }
    }
    out
}

/// [`outline_entries`], numbered, with a closing line on how to read a part.
pub fn outline(lines: &[&str]) -> String {
    let entries = outline_entries(lines);
    if entries.is_empty() {
        return format!(
            "No headings, code blocks or functions in {} lines.",
            lines.len()
        );
    }
    let mut out: Vec<String> = entries
        .iter()
        .map(|(line_no, line)| numbered(*line_no, line))
        .collect();
    out.push(format!(
        "\n{} lines in all; read a part with offset and limit.",
        lines.len()
    ));
    out.join("\n")
}

pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().take(LEVENSHTEIN_CHARS).collect();
    let b: Vec<char> = b.chars().take(LEVENSHTEIN_CHARS).collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (diagonal + usize::from(ca != cb))
                .min(above + 1)
                .min(row[j] + 1);
            diagonal = above;
        }
    }
    row[b.len()]
}

pub fn truncate_to_boundary(text: &str, max: usize) -> &str {
    let mut end = max.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// A write refused because `page` is no longer at revision `expected`;
/// `current` is the revision it is at, if it still exists. `reread` tells
/// the caller how to recover on its surface.
pub fn conflict_message(page: &str, expected: &str, current: Option<&str>, reread: &str) -> String {
    let detail = match current {
        Some(current) => format!("the current revision is {current}"),
        None => "the page no longer exists or the revision is not valid".to_owned(),
    };
    format!("page \"{page}\" changed since revision {expected}; {detail}. {reread}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTLINE_FIXTURE: &str = "Intro\n# Widgets\n```space-lua\nfoo = {}\nfunction foo.bar()\n  local x = 1\nend\nlocal baz = function() end\n```\n## Styles\n#tag line\n```lua\nx = 1\n```";

    #[test]
    fn outline_lists_headings_blocks_and_functions() {
        let lines: Vec<&str> = OUTLINE_FIXTURE.lines().collect();
        assert_eq!(
            outline(&lines),
            "    2\t# Widgets\n    3\t```space-lua\n    5\tfunction foo.bar()\n    8\tlocal baz = function() end\n   10\t## Styles\n   12\t```lua\n\n14 lines in all; read a part with offset and limit."
        );
    }

    #[test]
    fn outline_entries_match_outline() {
        let lines: Vec<&str> = OUTLINE_FIXTURE.lines().collect();
        let expected: Vec<(usize, String)> = [
            (2, "# Widgets"),
            (3, "```space-lua"),
            (5, "function foo.bar()"),
            (8, "local baz = function() end"),
            (10, "## Styles"),
            (12, "```lua"),
        ]
        .into_iter()
        .map(|(n, line)| (n, line.to_owned()))
        .collect();
        assert_eq!(outline_entries(&lines), expected);
    }

    #[test]
    fn scripts_are_space_lua_and_space_style_fences() {
        assert!(has_scripts("x\n```space-lua\nfoo()\n```"));
        assert!(has_scripts("  ````space-style\n```"));
        assert!(!has_scripts("```lua\nfoo()\n```"));
        assert!(!has_scripts("Text mentioning space-lua blocks."));
    }

    #[test]
    fn reload_follows_scripts_in_old_or_new_pages() {
        let lua = "```space-lua\nx = 1\n```\n";
        assert!(needs_reload("Tools.md", None, lua));
        assert!(needs_reload("Tools.md", Some(lua), "plain"));
        assert!(!needs_reload("Tools.md", Some("plain"), "plain"));
        assert!(!needs_reload("tools.lua", None, lua));
    }

    #[test]
    fn line_range_selects_and_rejects_offsets_past_the_end() {
        assert_eq!(line_range(3, Some(2), Some(usize::MAX), "file"), Ok((2, 3)));
        assert_eq!(line_range(0, None, None, "page"), Ok((1, 0)));
        assert_eq!(
            line_range(2, Some(5), None, "file"),
            Err("offset 5 is beyond the end of the file (2 lines)".to_owned())
        );
    }

    #[test]
    fn slices_stop_at_the_byte_cap() {
        let lines = ["a", "b", "c"];
        let all = slice_lines(&lines, (2, 3), true, usize::MAX);
        assert_eq!(all.text, "    2\tb\n    3\tc");
        assert_eq!(all.next_line, None);
        let capped = slice_lines(&lines, (1, 3), false, 3);
        assert_eq!(capped.text, "a\nb");
        assert_eq!(capped.next_line, Some(3));
        let cut = slice_lines(&["abcdef"], (1, 1), false, 4);
        assert_eq!((cut.text.as_str(), cut.next_line), ("abcd", Some(2)));
    }

    #[test]
    fn levenshtein_distances() {
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("same", "same"), 0);
    }

    #[test]
    fn conflict_message_names_both_revisions() {
        let reread = "Please re-read the page and retry.";
        assert_eq!(
            conflict_message("Notes", "r1", Some("r2"), reread),
            "page \"Notes\" changed since revision r1; the current revision is r2. Please re-read the page and retry."
        );
        assert_eq!(
            conflict_message("Notes", "r1", None, reread),
            "page \"Notes\" changed since revision r1; the page no longer exists or the revision is not valid. Please re-read the page and retry."
        );
    }

    #[test]
    fn truncate_keeps_whole_characters() {
        assert_eq!(truncate_to_boundary("Café", 4), "Caf");
        assert_eq!(truncate_to_boundary("abc", 10), "abc");
    }
}
