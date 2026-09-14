use std::ops::Range;

use similar::TextDiff;

const MAX_EDIT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    pub old: String,
    pub new: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EditResult {
    pub content: String,
    pub replacements: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EditError {
    pub code: &'static str,
    pub message: String,
    pub exit_code: u8,
}

struct Replacement<'a> {
    edit_index: usize,
    range: Range<usize>,
    new: &'a str,
}

pub fn apply(original: &str, edits: &[Edit], all: bool) -> Result<EditResult, EditError> {
    validate_input(original, edits)?;

    let mut replacements = Vec::new();
    for (edit_index, edit) in edits.iter().enumerate() {
        let matches = find_matches(original, &edit.old);
        if matches.is_empty() {
            return Err(match_error("edit_mismatch", edit_index, "found 0 matches"));
        }
        if matches.windows(2).any(|pair| pair[0].end > pair[1].start) {
            return Err(EditError {
                code: "edit_overlap",
                message: format!("edit {} has overlapping matches", edit_index + 1),
                exit_code: 6,
            });
        }
        if !all && matches.len() != 1 {
            return Err(match_error(
                "edit_ambiguous",
                edit_index,
                &format!("found {} matches", matches.len()),
            ));
        }

        let selected = if all { matches.len() } else { 1 };
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
                format!("edit {first} has overlapping matches")
            } else {
                format!("edits {first} and {second} overlap")
            };
            return Err(EditError {
                code: "edit_overlap",
                message,
                exit_code: 6,
            });
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

    Ok(EditResult {
        content,
        replacements: replacements.len(),
    })
}

pub fn diff(path: &str, old: &str, new: &str) -> String {
    TextDiff::from_lines(old, new)
        .unified_diff()
        .header(path, path)
        .to_string()
}

fn validate_input(original: &str, edits: &[Edit]) -> Result<(), EditError> {
    if original.len() > MAX_EDIT_BYTES {
        return Err(too_large_error("input content"));
    }
    if edits.is_empty() {
        return Err(EditError {
            code: "invalid_edit",
            message: "At least one edit is required.".to_string(),
            exit_code: 2,
        });
    }
    if original.contains('\0') {
        return Err(nul_error("input content"));
    }
    for (index, edit) in edits.iter().enumerate() {
        if edit.old.is_empty() {
            return Err(EditError {
                code: "invalid_edit",
                message: format!("Edit {} has empty old text.", index + 1),
                exit_code: 2,
            });
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

fn match_error(code: &'static str, edit_index: usize, detail: &str) -> EditError {
    EditError {
        code,
        message: format!(
            "Exact replacement edit {} {detail} in the original content.",
            edit_index + 1
        ),
        exit_code: 6,
    }
}

fn nul_error(subject: &str) -> EditError {
    EditError {
        code: "invalid_edit",
        message: format!("NUL is not allowed in {subject}."),
        exit_code: 2,
    }
}

fn too_large_error(subject: &str) -> EditError {
    EditError {
        code: "edit_too_large",
        message: format!("The {subject} exceeds the 8 MiB edit limit."),
        exit_code: 2,
    }
}

#[cfg(test)]
mod tests {
    use super::{apply, diff, Edit};

    fn edit(old: &str, new: &str) -> Edit {
        Edit {
            old: old.to_string(),
            new: new.to_string(),
        }
    }

    #[test]
    fn replaces_one_exact_match_without_touching_other_bytes() {
        let original = "\u{feff}Title\r\nStatus: 草稿\r\nTail\r\n";

        let result = apply(original, &[edit("Status: 草稿", "Status: ready ✅")], false)
            .expect("unique replacement should succeed");

        assert_eq!(
            result.content.as_bytes(),
            "\u{feff}Title\r\nStatus: ready ✅\r\nTail\r\n".as_bytes()
        );
        assert_eq!(result.replacements, 1);
    }

    #[test]
    fn rejects_a_missing_match() {
        let error = apply("Status: draft\n", &[edit("Status: ready", "Done")], false)
            .expect_err("missing replacement should fail");

        assert_eq!(error.code, "edit_mismatch");
        assert_eq!(error.exit_code, 6);
        assert!(error.message.contains("edit 1"));
        assert!(error.message.contains("0 matches"));
    }

    #[test]
    fn reports_no_match_when_old_text_is_longer_than_the_file() {
        let error = apply("short", &[edit("longer text", "new")], false)
            .expect_err("old text longer than the file should not match");

        assert_eq!(error.code, "edit_mismatch");
        assert!(error.message.contains("0 matches"));
    }

    #[test]
    fn rejects_an_ambiguous_match() {
        let error = apply("draft / draft", &[edit("draft", "ready")], false)
            .expect_err("ambiguous replacement should fail");

        assert_eq!(error.code, "edit_ambiguous");
        assert_eq!(error.exit_code, 6);
        assert!(error.message.contains("edit 1"));
        assert!(error.message.contains("2 matches"));
    }

    #[test]
    fn all_replaces_every_nonoverlapping_match() {
        let result = apply("draft / draft", &[edit("draft", "ready")], true)
            .expect("all nonoverlapping replacements should succeed");

        assert_eq!(result.content, "ready / ready");
        assert_eq!(result.replacements, 2);
    }

    #[test]
    fn rejects_overlapping_occurrences_in_all_mode() {
        let error = apply("aaa", &[edit("aa", "b")], true)
            .expect_err("overlapping occurrences should fail");

        assert_eq!(error.code, "edit_overlap");
        assert_eq!(error.exit_code, 6);
        assert!(error.message.contains("edit 1"));
    }

    #[test]
    fn reports_overlapping_occurrences_before_ambiguity() {
        let error = apply("aaa", &[edit("aa", "b")], false)
            .expect_err("overlapping occurrences should fail in unique mode");

        assert_eq!(error.code, "edit_overlap");
        assert_eq!(error.exit_code, 6);
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
            false,
        )
        .expect_err("overlapping edits should fail");

        assert_eq!(error.code, "edit_overlap");
        assert_eq!(error.exit_code, 6);
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
            false,
        )
        .expect_err("a replacement must not create a later target");

        assert_eq!(error.code, "edit_mismatch");
        assert!(error.message.contains("edit 2"));
    }

    #[test]
    fn preserves_no_op_content_and_counts_the_match() {
        let result = apply("same\r\n", &[edit("same", "same")], false)
            .expect("a no-op replacement should succeed");

        assert_eq!(result.content.as_bytes(), b"same\r\n");
        assert_eq!(result.replacements, 1);
    }

    #[test]
    fn allows_an_empty_replacement() {
        let result = apply("keep remove keep", &[edit(" remove", "")], false)
            .expect("empty replacement should delete the match");

        assert_eq!(result.content, "keep keep");
        assert_eq!(result.replacements, 1);
    }

    #[test]
    fn rejects_empty_old_text() {
        let error =
            apply("text", &[edit("", "new")], false).expect_err("empty old text should fail");

        assert_eq!(error.code, "invalid_edit");
        assert_eq!(error.exit_code, 2);
    }

    #[test]
    fn rejects_nul_in_original_or_edits() {
        for (original, replacement) in [
            ("text\0tail", edit("text", "new")),
            ("text", edit("te\0xt", "new")),
            ("text", edit("text", "ne\0w")),
        ] {
            let error =
                apply(original, &[replacement], false).expect_err("NUL content should fail");
            assert_eq!(error.code, "invalid_edit");
            assert_eq!(error.exit_code, 2);
        }
    }

    #[test]
    fn rejects_input_larger_than_eight_mib() {
        let original = "x".repeat(8 * 1024 * 1024 + 1);

        let error =
            apply(&original, &[edit("x", "y")], true).expect_err("oversized input should fail");

        assert_eq!(error.code, "edit_too_large");
        assert_eq!(error.exit_code, 2);
    }

    #[test]
    fn rejects_output_larger_than_eight_mib() {
        let replacement = "x".repeat(8 * 1024 * 1024 + 1);

        let error = apply("x", &[edit("x", &replacement)], false)
            .expect_err("oversized output should fail");

        assert_eq!(error.code, "edit_too_large");
        assert_eq!(error.exit_code, 2);
    }

    #[test]
    fn renders_an_inspectable_unified_diff() {
        assert_eq!(
            diff("Projects/Launch.md", "Status: draft\n", "Status: ready\n"),
            "--- Projects/Launch.md\n+++ Projects/Launch.md\n@@ -1 +1 @@\n-Status: draft\n+Status: ready\n"
        );
    }
}
