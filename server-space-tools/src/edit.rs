//! Exact-text edits, as MCP `edit` and `sb fs edit` apply them: every edit is
//! located in the original text, edits must not overlap, and either all of
//! them apply or none does.

use std::borrow::Cow;
use std::ops::Range;

use similar::TextDiff;

use crate::page_text::{levenshtein, numbered};

const MAX_EDIT_BYTES: usize = 8 * 1024 * 1024;
const CONTEXT_LINES: usize = 3;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub old: String,
    pub new: String,
}

#[derive(Debug, Clone, Copy)]
pub struct EditOpts {
    /// Replace every match of an edit's old text instead of requiring one.
    pub all: bool,
    /// What the surface calls an edit's old text in messages.
    pub old_text: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EditOutcome {
    pub content: String,
    pub replacements: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditErrorKind {
    /// An edit's old text is not in the text.
    Mismatch,
    /// An edit's old text matches more than once, without `all`.
    Ambiguous,
    /// Matches of one edit, or of two edits, overlap.
    Overlap,
    /// No edits, empty old text, or NUL in the text or an edit.
    Invalid,
    /// The text before or after the edits exceeds 8 MiB.
    TooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditError {
    pub kind: EditErrorKind,
    pub message: String,
}

impl EditError {
    fn new(kind: EditErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// The stable code `sb fs edit` reports.
    pub fn code(&self) -> &'static str {
        match self.kind {
            EditErrorKind::Mismatch => "edit_mismatch",
            EditErrorKind::Ambiguous => "edit_ambiguous",
            EditErrorKind::Overlap => "edit_overlap",
            EditErrorKind::Invalid => "invalid_edit",
            EditErrorKind::TooLarge => "edit_too_large",
        }
    }
}

struct Replacement<'a> {
    edit_index: usize,
    range: Range<usize>,
    new: &'a str,
}

/// Applies `edits` to `original`. In text with CRLF line endings, the line
/// breaks of each edit's old and new text are CRLF too, so edits written
/// with `\n` match and the text keeps its endings.
pub fn apply(original: &str, edits: &[Edit], opts: EditOpts) -> Result<EditOutcome, EditError> {
    validate_input(original, edits)?;
    let edits: Cow<[Edit]> = if original.contains("\r\n") {
        Cow::Owned(
            edits
                .iter()
                .map(|e| Edit {
                    old: crlf(&e.old),
                    new: crlf(&e.new),
                })
                .collect(),
        )
    } else {
        Cow::Borrowed(edits)
    };

    let mut replacements = Vec::new();
    for (edit_index, edit) in edits.iter().enumerate() {
        let matches = find_matches(original, &edit.old);
        if matches.is_empty() {
            return Err(EditError::new(
                EditErrorKind::Mismatch,
                not_found_message(edit_index + 1, original, &edit.old, opts.old_text),
            ));
        }
        if matches.windows(2).any(|pair| pair[0].end > pair[1].start) {
            return Err(EditError::new(
                EditErrorKind::Overlap,
                format!(
                    "edit {} has overlapping matches. Nothing was changed.",
                    edit_index + 1
                ),
            ));
        }
        if !opts.all && matches.len() != 1 {
            return Err(EditError::new(
                EditErrorKind::Ambiguous,
                format!(
                    "edit {}: {} matches {} times; add surrounding context so it matches exactly once. Nothing was changed.",
                    edit_index + 1,
                    opts.old_text,
                    matches.len()
                ),
            ));
        }

        let selected = if opts.all { matches.len() } else { 1 };
        replacements.extend(matches.into_iter().take(selected).map(|range| Replacement {
            edit_index,
            range,
            new: &edit.new,
        }));
    }

    replacements.sort_by_key(|replacement| replacement.range.start);
    for pair in replacements.windows(2) {
        if pair[0].range.end > pair[1].range.start {
            let first = pair[0].edit_index + 1;
            let second = pair[1].edit_index + 1;
            let message = if first == second {
                format!("edit {first} has overlapping matches. Nothing was changed.")
            } else {
                format!("edits {first} and {second} overlap. Nothing was changed.")
            };
            return Err(EditError::new(EditErrorKind::Overlap, message));
        }
    }

    let output_len = replacements
        .iter()
        .try_fold(original.len(), |size, replacement| {
            size.checked_sub(replacement.range.len())?
                .checked_add(replacement.new.len())
        });
    if output_len.is_none_or(|size| size > MAX_EDIT_BYTES) {
        return Err(too_large_error("resulting content"));
    }

    let mut content = String::with_capacity(output_len.expect("validated output length"));
    let mut copied_through = 0;
    for replacement in &replacements {
        content.push_str(&original[copied_through..replacement.range.start]);
        content.push_str(replacement.new);
        copied_through = replacement.range.end;
    }
    content.push_str(&original[copied_through..]);

    Ok(EditOutcome {
        content,
        replacements: replacements.len(),
    })
}

/// The unified diff from `old` to `new`, with three lines of context.
pub fn unified_diff(old: &str, new: &str, old_header: &str, new_header: &str) -> String {
    TextDiff::from_lines(old, new)
        .unified_diff()
        .context_radius(CONTEXT_LINES)
        .header(old_header, new_header)
        .to_string()
}

fn crlf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', "\r\n")
}

fn validate_input(original: &str, edits: &[Edit]) -> Result<(), EditError> {
    if original.len() > MAX_EDIT_BYTES {
        return Err(too_large_error("input content"));
    }
    if edits.is_empty() {
        return Err(EditError::new(
            EditErrorKind::Invalid,
            "At least one edit is required.",
        ));
    }
    if original.contains('\0') {
        return Err(nul_error("input content"));
    }
    for (index, edit) in edits.iter().enumerate() {
        if edit.old.is_empty() {
            return Err(EditError::new(
                EditErrorKind::Invalid,
                format!("Edit {} has empty old text.", index + 1),
            ));
        }
        if edit.old.contains('\0') || edit.new.contains('\0') {
            return Err(nul_error(&format!("edit {}", index + 1)));
        }
    }
    Ok(())
}

fn find_matches(content: &str, needle: &str) -> Vec<Range<usize>> {
    let mut matches = Vec::new();
    let bytes = content.as_bytes();
    let needle_bytes = needle.as_bytes();
    if needle_bytes.len() > bytes.len() {
        return matches;
    }

    let mut prefix = vec![0; needle_bytes.len()];
    let mut matched = 0;
    for index in 1..needle_bytes.len() {
        while matched > 0 && needle_bytes[index] != needle_bytes[matched] {
            matched = prefix[matched - 1];
        }
        if needle_bytes[index] == needle_bytes[matched] {
            matched += 1;
            prefix[index] = matched;
        }
    }

    matched = 0;
    for (index, byte) in bytes.iter().enumerate() {
        while matched > 0 && *byte != needle_bytes[matched] {
            matched = prefix[matched - 1];
        }
        if *byte == needle_bytes[matched] {
            matched += 1;
        }
        if matched == needle_bytes.len() {
            let end = index + 1;
            let start = end - needle_bytes.len();
            if content.is_char_boundary(start) && content.is_char_boundary(end) {
                matches.push(start..end);
            }
            matched = prefix[matched - 1];
        }
    }
    matches
}

/// Edit `n`'s old text is not in `text`: where the closest line is, with context.
fn not_found_message(n: usize, text: &str, old: &str, old_text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return format!("edit {n}: {old_text} not found (the page is empty). Nothing was changed.");
    }
    let old_lines = old.lines().count().max(1);
    let first = old.lines().next().unwrap_or_default().trim();
    let best = lines
        .iter()
        .enumerate()
        .min_by_key(|(_, line)| levenshtein(line.trim(), first))
        .map_or(0, |(i, _)| i);
    let last = (best + old_lines).min(lines.len());
    let from = best.saturating_sub(CONTEXT_LINES);
    let to = (last + CONTEXT_LINES).min(lines.len());
    let context: Vec<String> = (from..to).map(|i| numbered(i + 1, lines[i])).collect();
    format!(
        "edit {n}: {old_text} not found. Closest match at lines {}-{}:\n{}\nNothing was changed.",
        best + 1,
        last,
        context.join("\n")
    )
}

fn nul_error(subject: &str) -> EditError {
    EditError::new(
        EditErrorKind::Invalid,
        format!("NUL is not allowed in {subject}."),
    )
}

fn too_large_error(subject: &str) -> EditError {
    EditError::new(
        EditErrorKind::TooLarge,
        format!("The {subject} exceeds the 8 MiB edit limit."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE: EditOpts = EditOpts {
        all: false,
        old_text: "old text",
    };
    const ALL: EditOpts = EditOpts {
        all: true,
        old_text: "old text",
    };

    fn edit(old: &str, new: &str) -> Edit {
        Edit {
            old: old.to_string(),
            new: new.to_string(),
        }
    }

    #[test]
    fn replaces_one_exact_match_without_touching_other_bytes() {
        let original = "\u{feff}Title\r\nStatus: 草稿\r\nTail\r\n";

        let result = apply(original, &[edit("Status: 草稿", "Status: ready ✅")], ONE)
            .expect("unique replacement should succeed");

        assert_eq!(
            result.content.as_bytes(),
            "\u{feff}Title\r\nStatus: ready ✅\r\nTail\r\n".as_bytes()
        );
        assert_eq!(result.replacements, 1);
    }

    #[test]
    fn rejects_a_missing_match() {
        let error = apply("Status: draft\n", &[edit("Status: ready", "Done")], ONE)
            .expect_err("missing replacement should fail");

        assert_eq!(error.code(), "edit_mismatch");
        assert!(error.message.starts_with("edit 1: old text not found."));
    }

    #[test]
    fn missing_old_text_shows_closest_match_lines() {
        let error = apply(
            "# Title\nStatus: drafted\nTail\n",
            &[edit("Status: draft!", "Status: ready")],
            ONE,
        )
        .expect_err("missing replacement should fail");

        assert_eq!(error.code(), "edit_mismatch");
        assert!(
            error.message.contains("Closest match at lines 2-2:"),
            "{}",
            error.message
        );
        assert!(
            error.message.contains("    2\tStatus: drafted"),
            "{}",
            error.message
        );
        assert!(
            error.message.ends_with("Nothing was changed."),
            "{}",
            error.message
        );
    }

    #[test]
    fn messages_name_old_text_as_the_surface_does() {
        let opts = EditOpts {
            all: false,
            old_text: "oldText",
        };
        let error = apply("", &[edit("a", "b")], opts).unwrap_err();
        assert_eq!(
            error.message,
            "edit 1: oldText not found (the page is empty). Nothing was changed."
        );
        let error = apply("a a", &[edit("a", "b")], opts).unwrap_err();
        assert!(error.message.starts_with("edit 1: oldText matches 2 times"));
    }

    #[test]
    fn ambiguous_old_text_says_add_context() {
        let error = apply("draft / draft", &[edit("draft", "ready")], ONE)
            .expect_err("ambiguous replacement should fail");

        assert_eq!(
            error.message,
            "edit 1: old text matches 2 times; add surrounding context so it matches exactly once. Nothing was changed."
        );
    }

    #[test]
    fn reports_no_match_when_old_text_is_longer_than_the_file() {
        let error = apply("short", &[edit("longer text", "new")], ONE)
            .expect_err("old text longer than the file should not match");

        assert_eq!(error.code(), "edit_mismatch");
        assert!(error.message.contains("old text not found"));
    }

    #[test]
    fn rejects_an_ambiguous_match() {
        let error = apply("draft / draft", &[edit("draft", "ready")], ONE)
            .expect_err("ambiguous replacement should fail");

        assert_eq!(error.code(), "edit_ambiguous");
        assert!(error.message.contains("edit 1"));
        assert!(error.message.contains("matches 2 times"));
    }

    #[test]
    fn all_replaces_every_nonoverlapping_match() {
        let result = apply("draft / draft", &[edit("draft", "ready")], ALL)
            .expect("all nonoverlapping replacements should succeed");

        assert_eq!(result.content, "ready / ready");
        assert_eq!(result.replacements, 2);
    }

    #[test]
    fn rejects_overlapping_occurrences_in_all_mode() {
        let error =
            apply("aaa", &[edit("aa", "b")], ALL).expect_err("overlapping occurrences should fail");

        assert_eq!(error.code(), "edit_overlap");
        assert!(error.message.contains("edit 1"));
    }

    #[test]
    fn reports_overlapping_occurrences_before_ambiguity() {
        let error = apply("aaa", &[edit("aa", "b")], ONE)
            .expect_err("overlapping occurrences should fail in unique mode");

        assert_eq!(error.code(), "edit_overlap");
        assert!(error.message.contains("edit 1"));
    }

    #[test]
    fn rejects_overlapping_batch_ranges() {
        let error = apply(
            "the quick brown fox",
            &[
                edit("quick brown", "slow red"),
                edit("brown fox", "red cat"),
            ],
            ONE,
        )
        .expect_err("overlapping edits should fail");

        assert_eq!(error.code(), "edit_overlap");
        assert!(error.message.contains("edits 1 and 2"));
    }

    #[test]
    fn evaluates_every_target_against_the_original() {
        let error = apply(
            "Status: draft",
            &[
                edit("Status: draft", "Status: ready"),
                edit("Status: ready", "Status: done"),
            ],
            ONE,
        )
        .expect_err("a replacement must not create a later target");

        assert_eq!(error.code(), "edit_mismatch");
        assert!(error.message.contains("edit 2"));
    }

    #[test]
    fn lf_edits_match_and_keep_crlf_endings() {
        let result = apply(
            "one\r\ntwo\r\nthree\r\n",
            &[edit("one\ntwo", "1\n2\n2b")],
            ONE,
        )
        .expect("an LF edit should match CRLF text");
        assert_eq!(result.content, "1\r\n2\r\n2b\r\nthree\r\n");
        let result =
            apply("a\r\nb\r\n", &[edit("a\r\nb", "c")], ONE).expect("a CRLF edit should match too");
        assert_eq!(result.content, "c\r\n");
    }

    #[test]
    fn matches_are_exact_and_whole_characters() {
        let result = apply("Café café", &[edit("café", "tea")], ONE)
            .expect("only the lower-case word matches");
        assert_eq!(result.content, "Café tea");
        let result = apply("Café", &[edit("é", "e")], ONE).map(|r| r.content);
        assert_eq!(result, Ok("Cafe".to_owned()));
    }

    #[test]
    fn preserves_no_op_content_and_counts_the_match() {
        let result = apply("same\r\n", &[edit("same", "same")], ONE)
            .expect("a no-op replacement should succeed");

        assert_eq!(result.content.as_bytes(), b"same\r\n");
        assert_eq!(result.replacements, 1);
    }

    #[test]
    fn allows_an_empty_replacement() {
        let result = apply("keep remove keep", &[edit(" remove", "")], ONE)
            .expect("empty replacement should delete the match");

        assert_eq!(result.content, "keep keep");
        assert_eq!(result.replacements, 1);
    }

    #[test]
    fn rejects_empty_old_text() {
        let error = apply("text", &[edit("", "new")], ONE).expect_err("empty old text should fail");

        assert_eq!(error.code(), "invalid_edit");
    }

    #[test]
    fn rejects_nul_in_original_or_edits() {
        for (original, replacement) in [
            ("text\0tail", edit("text", "new")),
            ("text", edit("te\0xt", "new")),
            ("text", edit("text", "ne\0w")),
        ] {
            let error = apply(original, &[replacement], ONE).expect_err("NUL content should fail");
            assert_eq!(error.code(), "invalid_edit");
        }
    }

    #[test]
    fn rejects_input_larger_than_eight_mib() {
        let original = "x".repeat(8 * 1024 * 1024 + 1);

        let error =
            apply(&original, &[edit("x", "y")], ALL).expect_err("oversized input should fail");

        assert_eq!(error.code(), "edit_too_large");
    }

    #[test]
    fn rejects_output_larger_than_eight_mib() {
        let replacement = "x".repeat(8 * 1024 * 1024 + 1);

        let error =
            apply("x", &[edit("x", &replacement)], ONE).expect_err("oversized output should fail");

        assert_eq!(error.code(), "edit_too_large");
    }

    #[test]
    fn renders_an_inspectable_unified_diff() {
        let path = "Projects/Launch.md";
        assert_eq!(
            unified_diff("Status: draft\n", "Status: ready\n", path, path),
            "--- Projects/Launch.md\n+++ Projects/Launch.md\n@@ -1 +1 @@\n-Status: draft\n+Status: ready\n"
        );
    }
}
