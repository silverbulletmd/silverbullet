//! Wiki link resolution, mirroring `plug-api/lib/resolve_path.ts`. The client
//! resolves bare `[[Name]]` links space-wide by basename; the server needs the
//! same answers so its server-side-rendered HTML links to the same files.

use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolveResult {
    pub path: String,
    pub exists: bool,
    pub ambiguous: bool,
    pub candidates: Option<Vec<String>>,
}

#[derive(Debug, Default, Clone)]
pub struct BasenameIndex {
    paths: HashSet<String>,
    by_basename: HashMap<String, BTreeSet<String>>,
}

impl BasenameIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_paths<I, S>(paths: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut index = Self::new();
        for path in paths {
            index.add(path.into());
        }
        index
    }

    pub fn add(&mut self, path: String) {
        let key = basename_key(&path);
        if !self.paths.insert(path.clone()) {
            return;
        }
        self.by_basename.entry(key).or_default().insert(path);
    }

    pub fn remove(&mut self, path: &str) {
        if !self.paths.remove(path) {
            return;
        }
        let key = basename_key(path);
        if let Some(bucket) = self.by_basename.get_mut(&key) {
            bucket.remove(path);
            if bucket.is_empty() {
                self.by_basename.remove(&key);
            }
        }
    }

    pub fn has(&self, path: &str) -> bool {
        self.paths.contains(path)
    }

    pub fn candidates(&self, basename: &str) -> Vec<String> {
        self.by_basename
            .get(&basename.to_lowercase())
            .map(|bucket| bucket.iter().cloned().collect())
            .unwrap_or_default()
    }
}

fn basename_key(path: &str) -> String {
    file_name(path).to_lowercase()
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn folder_segments(path: &str) -> Vec<&str> {
    let mut segments: Vec<&str> = path.split('/').collect();
    segments.pop();
    segments
}

fn shared_depth(a: &[&str], b: &[&str]) -> usize {
    a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count()
}

/// Ranks same-basename candidates relative to the linking page: deepest shared
/// folder prefix first, then shallowest, then lexicographic. Obsidian ranks the
/// space root above the linking page's own folder; inverting that is deliberate
/// — root-wins would resolve a link inside `docs/api/` to a sibling project's
/// root-level file whenever a space is opened at a wider root. Root preference
/// survives as the shallowest-path rule, since the root is always depth 0.
pub fn rank_candidates(candidates: &[String], from_page: &str) -> Vec<String> {
    let from = folder_segments(from_page);
    let mut ranked: Vec<String> = candidates.to_vec();
    ranked.sort_by(|a, b| {
        let a_folder = folder_segments(a);
        let b_folder = folder_segments(b);
        shared_depth(&b_folder, &from)
            .cmp(&shared_depth(&a_folder, &from))
            .then_with(|| a_folder.len().cmp(&b_folder.len()))
            .then_with(|| a.cmp(b))
    });
    ranked
}

/// Resolves a normalized ref path against the space. Exact paths always win, so
/// every link that resolves today keeps resolving to the same file. A bare name
/// falls back to a space-wide basename lookup; more than one survivor means the
/// "bare link iff unique basename" invariant is violated, which resolves
/// deterministically but is reported as ambiguous so callers can flag it.
pub fn resolve_path(path: &str, from_page: &str, index: &BasenameIndex) -> ResolveResult {
    if path.is_empty() {
        return ResolveResult {
            path: String::new(),
            exists: true,
            ambiguous: false,
            candidates: None,
        };
    }
    let bare = !path.contains('/');

    if index.has(path) {
        // An exact path match is fully determined by the link text, so it is
        // never reported ambiguous — even when other files share the basename.
        // For a root-level file the bare and qualified forms are the same
        // string, so there is nothing the author could write instead and the
        // warning could never be cleared.
        return ResolveResult {
            path: path.to_string(),
            exists: true,
            ambiguous: false,
            candidates: None,
        };
    }

    // Both lookups start from the basename bucket; a qualified path just has
    // to match more of its tail. That suffix fallback is what keeps qualified
    // links working when a space is opened at a wider root.
    let mut candidates = index.candidates(file_name(path));
    if !bare {
        let suffix = format!("/{}", path.to_lowercase());
        candidates.retain(|candidate| candidate.to_lowercase().ends_with(&suffix));
    }
    if candidates.is_empty() {
        return ResolveResult {
            path: path.to_string(),
            exists: false,
            ambiguous: false,
            candidates: None,
        };
    }

    let suffix = format!("/{path}");
    let exact_case: Vec<String> = candidates
        .iter()
        .filter(|candidate| {
            if bare {
                file_name(candidate) == path
            } else {
                candidate.ends_with(&suffix)
            }
        })
        .cloned()
        .collect();
    let ranked = rank_candidates(
        if exact_case.is_empty() {
            &candidates
        } else {
            &exact_case
        },
        from_page,
    );
    if ranked.len() == 1 {
        return ResolveResult {
            path: ranked.into_iter().next().expect("length checked"),
            exists: true,
            ambiguous: false,
            candidates: None,
        };
    }
    ResolveResult {
        path: ranked[0].clone(),
        exists: true,
        ambiguous: true,
        candidates: Some(ranked),
    }
}

/// Mirrors `normalizePath` in `plug-api/lib/ref.ts`: drops a leading `/` and
/// appends `.md` unless the name already carries an alphanumeric extension.
pub fn normalize_path(path: &str) -> String {
    let path = path.strip_prefix('/').unwrap_or(path);
    if path.is_empty() || has_extension(path) {
        path.to_string()
    } else {
        format!("{path}.md")
    }
}

fn has_extension(path: &str) -> bool {
    match path.rsplit_once('.') {
        Some((stem, ext)) => {
            !stem.is_empty() && !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// Mirrors `encodeRef` for a bare path: markdown pages are addressed without
/// their `.md` extension.
pub fn encode_ref(path: &str) -> &str {
    path.strip_suffix(".md").unwrap_or(path)
}

/// Splits a raw `[[...]]` target into its path part and the `#header` / `@pos`
/// / `$anchor` suffix, following the `refRegex` character class in
/// `plug-api/lib/ref.ts`. Returns `None` for targets that regex rejects
/// outright, which callers leave literal.
pub fn split_ref(target: &str) -> Option<(&str, &str)> {
    if target.contains('<') || target.contains('>') || target.contains('|') {
        return None;
    }
    match target.find(['@', '#', '$']) {
        Some(at) => Some((&target[..at], &target[at..])),
        None => Some((target, "")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(paths: &[&str]) -> BasenameIndex {
        BasenameIndex::from_paths(paths.iter().copied())
    }

    fn resolved(path: &str) -> ResolveResult {
        ResolveResult {
            path: path.to_string(),
            exists: true,
            ambiguous: false,
            candidates: None,
        }
    }

    #[test]
    fn bare_name_resolves_space_wide_by_basename() {
        let idx = index(&["sub/folder/Notes.md", "Other.md"]);
        assert_eq!(
            resolve_path("Notes.md", "Other.md", &idx),
            resolved("sub/folder/Notes.md")
        );
    }

    #[test]
    fn basename_lookup_is_case_insensitive() {
        let idx = index(&["sub/Notes.md"]);
        assert_eq!(
            resolve_path("notes.md", "Other.md", &idx).path,
            "sub/Notes.md"
        );
        assert_eq!(
            resolve_path("NOTES.md", "Other.md", &idx).path,
            "sub/Notes.md"
        );
    }

    #[test]
    fn exact_case_candidate_beats_case_insensitive_one() {
        let idx = index(&["a/Notes.md", "b/notes.md"]);
        assert_eq!(
            resolve_path("notes.md", "z/Page.md", &idx),
            resolved("b/notes.md")
        );
    }

    #[test]
    fn qualified_link_is_root_relative_and_exact() {
        let idx = index(&["sub/Notes.md", "other/Notes.md"]);
        assert_eq!(
            resolve_path("sub/Notes.md", "z/Page.md", &idx),
            resolved("sub/Notes.md")
        );
    }

    #[test]
    fn qualified_path_that_does_not_exist_stays_literal() {
        let idx = index(&["sub/Notes.md"]);
        assert_eq!(
            resolve_path("other/Notes.md", "z/Page.md", &idx),
            ResolveResult {
                path: "other/Notes.md".to_string(),
                exists: false,
                ambiguous: false,
                candidates: None,
            }
        );
    }

    #[test]
    fn exact_full_path_match_wins_over_basename_search() {
        let idx = index(&["Notes.md", "sub/Notes.md"]);
        assert_eq!(
            resolve_path("Notes.md", "sub/Page.md", &idx).path,
            "Notes.md"
        );
    }

    #[test]
    fn unresolvable_bare_name_stays_literal_at_the_root() {
        let idx = index(&["sub/Other.md"]);
        assert_eq!(
            resolve_path("Notes.md", "sub/Page.md", &idx),
            ResolveResult {
                path: "Notes.md".to_string(),
                exists: false,
                ambiguous: false,
                candidates: None,
            }
        );
    }

    #[test]
    fn documents_resolve_by_basename_too() {
        let idx = index(&["assets/diagram.png", "Page.md"]);
        assert_eq!(
            resolve_path("diagram.png", "Page.md", &idx).path,
            "assets/diagram.png"
        );
    }

    #[test]
    fn same_folder_beats_another_subfolder() {
        let idx = index(&["docs/api/Config.md", "sibling/Config.md"]);
        let result = resolve_path("Config.md", "docs/api/Auth.md", &idx);
        assert_eq!(result.path, "docs/api/Config.md");
        assert!(result.ambiguous);
    }

    #[test]
    fn nearest_common_ancestor_beats_a_distant_folder() {
        let idx = index(&["docs/shared/Config.md", "sibling/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "docs/api/Auth.md", &idx).path,
            "docs/shared/Config.md"
        );
    }

    #[test]
    fn wide_root_case_resolves_within_its_own_subtree() {
        let idx = index(&["docs/api/Config.md", "sibling/Config.md", "other/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "docs/api/Auth.md", &idx).path,
            "docs/api/Config.md"
        );
    }

    #[test]
    fn root_level_file_wins_outright_and_is_not_flagged() {
        // Matches the client: an exact path match is never ambiguous, since
        // its link text is already the full path of the file it finds.
        let idx = index(&["Config.md", "docs/api/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "docs/api/Auth.md", &idx),
            resolved("Config.md")
        );
    }

    #[test]
    fn qualified_link_is_never_ambiguous() {
        let idx = index(&["docs/api/Config.md", "sibling/Config.md"]);
        assert_eq!(
            resolve_path("docs/api/Config.md", "z/Page.md", &idx),
            resolved("docs/api/Config.md")
        );
    }

    #[test]
    fn root_wins_once_proximity_ties_being_shallowest() {
        let idx = index(&["Config.md", "guides/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "docs/api/Auth.md", &idx).path,
            "Config.md"
        );
    }

    #[test]
    fn shallower_path_wins_at_equal_proximity() {
        let idx = index(&["a/Config.md", "b/c/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "z/Page.md", &idx).path,
            "a/Config.md"
        );
    }

    #[test]
    fn lexicographic_order_is_the_final_tie_break() {
        let idx = index(&["b/Config.md", "a/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "z/Page.md", &idx).path,
            "a/Config.md"
        );
    }

    #[test]
    fn same_folder_beats_a_descendant_of_the_same_folder() {
        let idx = index(&["docs/api/Config.md", "docs/api/deep/Config.md"]);
        assert_eq!(
            resolve_path("Config.md", "docs/api/Auth.md", &idx).path,
            "docs/api/Config.md"
        );
    }

    #[test]
    fn ranking_is_deterministic_and_fully_ordered() {
        let candidates: Vec<String> = [
            "sibling/Config.md",
            "Config.md",
            "docs/api/Config.md",
            "docs/shared/Config.md",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let expected = vec![
            "docs/api/Config.md".to_string(),
            "docs/shared/Config.md".to_string(),
            "Config.md".to_string(),
            "sibling/Config.md".to_string(),
        ];
        assert_eq!(rank_candidates(&candidates, "docs/api/Auth.md"), expected);

        let mut reversed = candidates.clone();
        reversed.reverse();
        assert_eq!(rank_candidates(&reversed, "docs/api/Auth.md"), expected);
    }

    #[test]
    fn unique_basename_resolves_the_same_from_anywhere() {
        let idx = index(&["bla/Notes.md"]);
        for from in ["Page.md", "deep/nested/Page.md", "bla/Page.md"] {
            assert_eq!(
                resolve_path("Notes.md", from, &idx),
                resolved("bla/Notes.md")
            );
        }
    }

    #[test]
    fn ambiguity_reports_every_candidate_ranked() {
        let idx = index(&["bla/Notes.md", "bla2/Notes.md"]);
        let result = resolve_path("Notes.md", "bla/Page.md", &idx);
        assert!(result.ambiguous);
        assert_eq!(result.path, "bla/Notes.md");
        assert_eq!(
            result.candidates,
            Some(vec![
                "bla/Notes.md".to_string(),
                "bla2/Notes.md".to_string()
            ])
        );
    }

    #[test]
    fn case_exact_filtering_collapses_ambiguity() {
        let idx = index(&["a/Notes.md", "b/notes.md", "c/NOTES.md"]);
        let result = resolve_path("Notes.md", "z/Page.md", &idx);
        assert!(!result.ambiguous);
        assert_eq!(result.path, "a/Notes.md");
    }

    #[test]
    fn the_empty_path_resolves_to_the_current_page() {
        let idx = index(&["Page.md"]);
        assert_eq!(resolve_path("", "Page.md", &idx), resolved(""));
    }

    #[test]
    fn the_index_tracks_files_incrementally() {
        let mut idx = index(&["bla/Notes.md"]);
        assert!(!resolve_path("Notes.md", "Page.md", &idx).ambiguous);

        idx.add("bla2/Notes.md".to_string());
        assert!(resolve_path("Notes.md", "Page.md", &idx).ambiguous);

        idx.remove("bla2/Notes.md");
        assert_eq!(
            resolve_path("Notes.md", "Page.md", &idx),
            resolved("bla/Notes.md")
        );
    }

    #[test]
    fn basenames_sharing_a_prefix_are_not_confused() {
        let idx = index(&["a/Notes.md", "b/Notes Extra.md"]);
        assert_eq!(
            resolve_path("Notes.md", "z/Page.md", &idx).path,
            "a/Notes.md"
        );
    }

    #[test]
    fn normalize_path_appends_md_only_without_an_extension() {
        assert_eq!(normalize_path("Home"), "Home.md");
        assert_eq!(normalize_path("/Home"), "Home.md");
        assert_eq!(normalize_path("sub/Home"), "sub/Home.md");
        assert_eq!(normalize_path("assets/diagram.png"), "assets/diagram.png");
        assert_eq!(normalize_path("Notes.md"), "Notes.md");
        assert_eq!(normalize_path("v1.2 plan"), "v1.2 plan.md");
        assert_eq!(normalize_path(""), "");
    }

    #[test]
    fn split_ref_separates_the_detail_suffix() {
        assert_eq!(split_ref("Home"), Some(("Home", "")));
        assert_eq!(split_ref("Home#Section"), Some(("Home", "#Section")));
        assert_eq!(split_ref("Home@42"), Some(("Home", "@42")));
        assert_eq!(split_ref("Home$anchor"), Some(("Home", "$anchor")));
        assert_eq!(split_ref("#Section"), Some(("", "#Section")));
        assert_eq!(split_ref("a|b"), None);
    }

    /// Runs the shared fixture that `plug-api/lib/resolve_path.test.ts` also
    /// runs, so this resolver and the TypeScript one cannot drift.
    #[test]
    fn shared_fixture_matches_the_typescript_resolver() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../plug-api/lib/resolve_path_fixture.json"))
                .expect("fixture parses");
        let cases = fixture["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let files: Vec<String> = case["files"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| f.as_str().unwrap().to_string())
                .collect();
            let idx = BasenameIndex::from_paths(files);
            let result = resolve_path(
                case["link"].as_str().unwrap(),
                case["from"].as_str().unwrap(),
                &idx,
            );
            let expect = &case["expect"];
            assert_eq!(result.path, expect["path"].as_str().unwrap(), "{name}");
            assert_eq!(result.exists, expect["exists"].as_bool().unwrap(), "{name}");
            assert_eq!(
                result.ambiguous,
                expect["ambiguous"].as_bool().unwrap(),
                "{name}"
            );
            if expect["ambiguous"].as_bool().unwrap() {
                let expected: Vec<String> = expect["candidates"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| c.as_str().unwrap().to_string())
                    .collect();
                assert_eq!(result.candidates.as_deref(), Some(&expected[..]), "{name}");
            }
        }
    }
}
