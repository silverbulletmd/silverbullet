use std::collections::BTreeMap;

use globset::{GlobBuilder, GlobMatcher};
use serde_json::{json, Value};
use silverbullet_server_common::FileMeta;

use crate::fs_api::FsError;

pub(crate) fn patterns(globs: &[String]) -> Result<Vec<(bool, GlobMatcher)>, FsError> {
    globs
        .iter()
        .map(|pattern| {
            let (exclude, pattern) = match pattern.strip_prefix('!') {
                Some(p) => (true, p),
                None => (false, pattern.as_str()),
            };
            if pattern.is_empty() {
                return Err(FsError::new(
                    "invalid_arguments",
                    "A glob must not be empty",
                    2,
                ));
            }
            let pattern = if pattern.contains('/') {
                pattern.to_string()
            } else {
                format!("**/{pattern}")
            };
            let glob = GlobBuilder::new(&pattern)
                .literal_separator(true)
                .backslash_escape(true)
                .build()
                .map_err(|e| FsError::new("invalid_arguments", format!("Invalid glob: {e}"), 2))?;
            Ok((exclude, glob.compile_matcher()))
        })
        .collect()
}

pub(crate) fn listing(
    files: &[FileMeta],
    path: &str,
    recursive: bool,
    globs: &[String],
    limit: Option<usize>,
) -> Result<Value, FsError> {
    let matchers = patterns(globs)?;
    let root = path == ".";
    let prefix = if root {
        String::new()
    } else {
        format!("{path}/")
    };
    if !root
        && !files
            .iter()
            .any(|f| f.name == path || f.name.starts_with(&prefix))
    {
        let mut error = FsError::new("not_found", "File or directory not found", 3);
        error.path = Some(path.into());
        return Err(error);
    }
    let has_includes = matchers.iter().any(|(exclude, _)| !exclude);
    let mut entries = BTreeMap::new();
    for file in files {
        if file.name != path && !file.name.starts_with(&prefix) {
            continue;
        }
        let included = !has_includes
            || matchers
                .iter()
                .any(|(exclude, m)| !exclude && m.is_match(&file.name));
        if !included
            || matchers
                .iter()
                .any(|(exclude, m)| *exclude && m.is_match(&file.name))
        {
            continue;
        }
        let relative = file.name.strip_prefix(&prefix).unwrap_or(&file.name);
        if !recursive && file.name != path {
            if let Some((directory, _)) = relative.split_once('/') {
                let directory = format!("{prefix}{directory}/");
                entries.insert(
                    directory.clone(),
                    json!({"path": directory, "type": "directory"}),
                );
                continue;
            }
        }
        entries.insert(file.name.clone(), json!({
            "path": file.name, "type": "file", "size": file.size, "created": file.created,
            "lastModified": file.last_modified, "contentType": file.content_type, "perm": file.perm,
        }));
    }
    let truncated = limit.is_some_and(|limit| entries.len() > limit);
    let entries: Vec<_> = entries
        .into_values()
        .take(limit.unwrap_or(usize::MAX))
        .collect();
    Ok(json!({"entries": entries, "truncated": truncated}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str) -> silverbullet_server_common::FileMeta {
        silverbullet_server_common::FileMeta {
            name: name.into(),
            size: 10,
            created: 0,
            last_modified: 0,
            content_type: "text/markdown".into(),
            perm: "rw".into(),
        }
    }

    #[test]
    fn lists_immediate_children_and_does_not_cross_prefix_boundaries() {
        let files = vec![
            file("Work/A.md"),
            file("Workshop/B.md"),
            file("Work/Sub/C.md"),
        ];
        let result = listing(&files, "Work", false, &[], None).unwrap();
        assert_eq!(result["entries"][0]["path"], "Work/A.md");
        assert_eq!(result["entries"][1]["path"], "Work/Sub/");
        assert_eq!(result["entries"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn filters_basename_globs_and_exclusions_before_synthesizing_directories() {
        let files = vec![
            file("Work/A.md"),
            file("Work/Sub/B.md"),
            file("Other/image.png"),
        ];
        let result = listing(
            &files,
            ".",
            true,
            &["*.md".into(), "!Work/Sub/**".into()],
            Some(1),
        )
        .unwrap();
        assert_eq!(result["entries"][0]["path"], "Work/A.md");
        assert_eq!(result["truncated"], false);
        let limited = listing(&files, ".", false, &["*.md".into()], Some(0)).unwrap();
        assert_eq!(limited["truncated"], true);
        assert_eq!(limited["entries"], serde_json::json!([]));
    }

    #[test]
    fn distinguishes_missing_directory_from_no_glob_matches() {
        let files = vec![file("Work/A.md")];
        assert!(listing(&files, "Absent", false, &[], None).is_err());
        assert_eq!(
            listing(&files, "Work", true, &["*.png".into()], None).unwrap()["entries"],
            serde_json::json!([])
        );
    }
}
