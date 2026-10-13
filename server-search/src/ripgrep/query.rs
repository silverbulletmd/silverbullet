//! Structured queries: `query_args` builds rg's argv, rg runs once, and
//! `assemble` turns the ranked hits into the visible, paginated result.

use std::collections::HashSet;

use super::{args, limits, rank, RipgrepBackend, MODES};
use crate::{Match, QueryMode, QueryRequest, QueryResult, RequestCx, SearchError, SpaceView};

const PASSAGES_PER_PAGE: usize = 3;
const MAX_COUNT_PER_FILE: &str = "50";

#[derive(Debug)]
pub(super) struct RgQuery {
    pub args: Vec<String>,
    /// Words to highlight and require; empty outside `Words` mode.
    pub terms: Vec<String>,
}

/// Validates the query against `limits` and builds rg's argv (without enforced args).
pub(super) fn query_args(query: &str, mode: QueryMode) -> Result<RgQuery, SearchError> {
    if mode == QueryMode::Natural {
        return Err(SearchError::Unsupported("natural language search"));
    }
    let trimmed = query.trim();
    if trimmed.len() > limits::MAX_QUERY_BYTES {
        return Err(SearchError::Invalid("Search query is too long".into()));
    }
    if trimmed.chars().count() < limits::MIN_QUERY_CHARS {
        return Err(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS));
    }
    let mut args: Vec<String> = [
        "--json",
        "--no-ignore",
        "--glob=*.md",
        args::HIDDEN_GUARD,
        "--max-count",
        MAX_COUNT_PER_FILE,
    ]
    .map(String::from)
    .into();
    let terms: Vec<String> = match mode {
        QueryMode::Words => {
            let mut seen = HashSet::new();
            let terms: Vec<String> = trimmed
                .split_whitespace()
                .filter(|t| seen.insert(t.to_lowercase()))
                .map(String::from)
                .collect();
            if terms.len() > limits::MAX_TERMS {
                return Err(SearchError::Invalid(format!(
                    "Search for at most {} words",
                    limits::MAX_TERMS
                )));
            }
            args.extend(["--fixed-strings", "--ignore-case"].map(String::from));
            for t in &terms {
                args.push("-e".into());
                args.push(t.clone());
            }
            terms
        }
        QueryMode::Phrase => {
            args.extend(["--fixed-strings", "--ignore-case", "-e"].map(String::from));
            args.push(trimmed.to_string());
            Vec::new()
        }
        QueryMode::Regex => {
            args.extend(["--smart-case", "-e"].map(String::from));
            args.push(trimmed.to_string());
            Vec::new()
        }
        QueryMode::Natural => unreachable!("rejected above"),
    };
    args.extend(["--", "."].map(String::from));
    Ok(RgQuery { args, terms })
}

/// Which ranked pages a result may contain.
pub(super) struct PageFilter {
    /// Page names the result is limited to.
    pub include: Option<HashSet<String>>,
    /// Page names dropped from the result.
    pub exclude: HashSet<String>,
    /// File paths storage lists.
    pub visible: HashSet<String>,
}

impl PageFilter {
    fn admits(&self, hits: &rank::PageHits) -> bool {
        self.include.as_ref().is_none_or(|i| i.contains(&hits.page))
            && !self.exclude.contains(&hits.page)
            && self.visible.contains(&hits.path)
    }
}

/// Filters `ranked`, keeps the first `limit` pages as `Match`es and counts
/// every admitted page in `total`.
pub(super) fn assemble(
    ranked: Vec<rank::PageHits>,
    filter: &PageFilter,
    terms: &[String],
    limit: usize,
    view: &dyn SpaceView,
) -> (Vec<Match>, usize) {
    let mut items = Vec::new();
    let mut total = 0usize;
    for hits in ranked.iter().filter(|h| filter.admits(h)) {
        if total >= limit {
            total += 1;
            continue;
        }
        let lines = rank::best_lines(hits, terms, PASSAGES_PER_PAGE);
        let needed = lines.iter().map(|l| l.match_offset()).max().unwrap_or(0);
        let Some(prefix) = view.read_prefix(&hits.path, needed) else {
            continue;
        };
        total += 1;
        for line in lines {
            let rank::Passage {
                excerpt,
                highlights,
            } = rank::passage(line);
            items.push(Match {
                page: hits.page.clone(),
                pos: rank::pos(&prefix, line),
                line: line.line,
                heading: None,
                excerpt,
                highlights,
            });
        }
    }
    (items, total)
}

impl RipgrepBackend {
    pub(super) async fn run_query(
        &self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> Result<QueryResult, SearchError> {
        self.check_available()?;
        let mode = req.mode.unwrap_or(MODES[0]);
        let RgQuery { args, terms } = query_args(&req.query, mode)?;
        let _slot = cx.process_slot().await?;
        let out = self.rg(&args, None, &cx).await?;
        if out.code == Some(2) && out.stdout.is_empty() {
            let message = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(SearchError::Invalid(if message.is_empty() {
                "Invalid search".into()
            } else {
                message
            }));
        }
        let limit = req
            .limit
            .unwrap_or(limits::MAX_RESULTS)
            .min(limits::MAX_RESULTS);
        let include = req.include.map(|v| v.into_iter().collect());
        let exclude = req.exclude.unwrap_or_default().into_iter().collect();
        let view = self.view.clone();
        let stdout = out.stdout;
        let (items, total) = tokio::task::spawn_blocking(move || {
            let hits = rank::parse_json_lines(&stdout, &terms);
            let ranked = rank::qualify_and_rank(hits, &terms, mode);
            let filter = PageFilter {
                include,
                exclude,
                visible: view.list(),
            };
            assemble(ranked, &filter, &terms, limit, &*view)
        })
        .await
        .map_err(|e| SearchError::Failed(e.to_string()))?;
        let partial = out.timed_out || out.truncated || out.code.is_none();
        Ok(QueryResult {
            items,
            total,
            partial,
            notice: partial.then(|| "Search took too long; results may be incomplete".to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{backend, backend_with, cx, space, DirView, MemView};
    use super::super::Engine;
    use super::*;
    use crate::SearchBackend;
    use std::sync::Arc;
    use std::time::Duration;

    fn words(query: &str) -> Result<RgQuery, SearchError> {
        query_args(query, QueryMode::Words)
    }

    fn count(args: &[String], value: &str) -> usize {
        args.iter().filter(|a| *a == value).count()
    }

    #[test]
    fn words_mode_dedupes_terms_into_fixed_string_patterns() {
        let q = words("basil  basil Tomato").unwrap();
        assert_eq!(q.terms, ["basil", "Tomato"]);
        for flag in ["--fixed-strings", "--ignore-case", "basil", "Tomato"] {
            assert_eq!(count(&q.args, flag), 1, "{flag} in {:?}", q.args);
        }
        let e = |t: &str| q.args.windows(2).any(|w| w[0] == "-e" && w[1] == t);
        assert!(e("basil") && e("Tomato"));
        assert!(q.args.ends_with(&["--".to_string(), ".".to_string()]));
        assert!(q.args.iter().any(|a| a == super::super::args::HIDDEN_GUARD));
    }

    #[test]
    fn phrase_and_regex_modes_pass_one_trimmed_pattern() {
        let q = query_args("  basil pesto ", QueryMode::Phrase).unwrap();
        assert_eq!(count(&q.args, "-e"), 1);
        assert!(q
            .args
            .windows(2)
            .any(|w| w[0] == "-e" && w[1] == "basil pesto"));
        assert!(q.terms.is_empty());
        let q = query_args("F[e]rn", QueryMode::Regex).unwrap();
        assert_eq!(count(&q.args, "--smart-case"), 1);
        assert_eq!(count(&q.args, "--fixed-strings"), 0);
    }

    #[test]
    fn flag_like_words_are_only_pattern_values() {
        let q = words("--pre=sh").unwrap();
        let at = q.args.iter().position(|a| a == "--pre=sh").unwrap();
        assert_eq!(q.args[at - 1], "-e");
        assert_eq!(count(&q.args, "--pre=sh"), 1);
    }

    #[test]
    fn invalid_queries_are_refused() {
        let many: Vec<String> = (0..17).map(|i| format!("w{i}")).collect();
        assert_eq!(
            words(&many.join(" ")).unwrap_err(),
            SearchError::Invalid("Search for at most 16 words".into())
        );
        assert_eq!(words("f").unwrap_err(), SearchError::QueryTooShort(2));
        assert!(matches!(
            query_args("basil", QueryMode::Natural),
            Err(SearchError::Unsupported(_))
        ));
    }

    fn hit(path: &str, line_offset: u64, text: &str, at: &str) -> rank::PageHits {
        let start = text.find(at).unwrap();
        rank::PageHits {
            page: path.strip_suffix(".md").unwrap().to_string(),
            path: path.to_string(),
            lines: vec![rank::LineHit {
                line: 1,
                line_offset,
                text: text.to_string(),
                submatches: vec![(start, start + at.len())],
            }],
            content_terms: Default::default(),
            occurrences: 1,
        }
    }

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn total_counts_only_admitted_pages_including_those_past_the_limit() {
        let names = ["A.md", "B.md", "C.md", "D.md", "E.md", "F.md"];
        let view = MemView::new(&names.map(|n| (n, "fern\n")));
        let ranked = names.iter().map(|n| hit(n, 0, "fern\n", "fern")).collect();
        let filter = PageFilter {
            include: Some(set(&["A", "B", "C", "D", "E"])),
            exclude: set(&["B"]),
            visible: set(&["A.md", "B.md", "C.md", "E.md", "F.md"]),
        };
        let (items, total) = assemble(ranked, &filter, &[], 1, &view);
        let pages: Vec<_> = items.iter().map(|m| m.page.as_str()).collect();
        assert_eq!(pages, ["A"]);
        // C and E are past the limit; B is excluded, D unlisted, F outside include.
        assert_eq!(total, 3);
    }

    #[test]
    fn pages_missing_from_the_listing_are_dropped_even_when_readable() {
        let view = MemView::new(&[("Shown.md", "lichen\n"), ("Ignored.md", "lichen\n")]);
        let ranked = vec![
            hit("Ignored.md", 0, "lichen\n", "lichen"),
            hit("Shown.md", 0, "lichen\n", "lichen"),
        ];
        let filter = PageFilter {
            include: None,
            exclude: HashSet::new(),
            visible: set(&["Shown.md"]),
        };
        let (items, total) = assemble(ranked, &filter, &[], 10, &view);
        assert_eq!(total, 1);
        assert!(items.iter().all(|m| m.page == "Shown"));
    }

    #[test]
    fn positions_are_utf16_offsets_from_the_file_start() {
        let head = "Café ✓\n";
        assert_eq!(head.len(), 10);
        let line = "é😀 basil\n";
        let view = MemView::new(&[("P.md", &format!("{head}{line}"))]);
        let filter = PageFilter {
            include: None,
            exclude: HashSet::new(),
            visible: set(&["P.md"]),
        };
        let (items, total) = assemble(
            vec![hit("P.md", 10, line, "basil")],
            &filter,
            &[],
            10,
            &view,
        );
        assert_eq!(total, 1);
        let expected = head.encode_utf16().count() + "é😀 ".encode_utf16().count();
        assert_eq!(items[0].pos as usize, expected);
    }

    #[test]
    fn unreadable_pages_are_neither_listed_nor_counted() {
        let view = MemView::new(&[("A.md", "fern\n")]);
        let ranked = vec![
            hit("A.md", 0, "fern\n", "fern"),
            hit("Gone.md", 0, "fern\n", "fern"),
        ];
        let filter = PageFilter {
            include: None,
            exclude: HashSet::new(),
            visible: set(&["A.md", "Gone.md"]),
        };
        let (items, total) = assemble(ranked, &filter, &[], 10, &view);
        assert_eq!((items.len(), total), (1, 1));
    }

    #[tokio::test]
    async fn files_missing_from_the_visible_listing_never_appear() {
        let dir = space(&[
            ("Shown.md", "lichen here\n"),
            ("Ignored.md", "lichen here\n"),
        ]);
        let view = DirView::new(dir.path(), &[]).unlisted(&["Ignored.md"]);
        assert!(view.read_prefix("Ignored.md", 6).is_some());
        let Some(b) = backend_with(dir.path(), view) else {
            return;
        };
        let result = b.query(req("lichen", None), cx()).await.unwrap();
        assert_eq!(result.total, 1);
        assert!(result.items.iter().all(|m| m.page == "Shown"));
    }

    fn req(query: &str, mode: Option<QueryMode>) -> QueryRequest {
        QueryRequest {
            query: query.into(),
            mode,
            include: None,
            exclude: None,
            limit: None,
        }
    }

    #[tokio::test]
    async fn words_search_finds_pages_with_all_terms_and_exact_positions() {
        let dir = space(&[
            (
                "Garden.md",
                "# Garden\nCafé 🙂 notes: water the Basil and mint\n",
            ),
            ("Kitchen.md", "basil pesto\n"),
            ("Projects/Mint Plan.md", "add basil\n"),
        ]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let r = b.query(req("basil mint", None), cx()).await.unwrap();
        let pages: Vec<_> = r.items.iter().map(|m| m.page.as_str()).collect();
        assert!(pages.contains(&"Garden") && pages.contains(&"Projects/Mint Plan"));
        assert!(!pages.contains(&"Kitchen"));
        let garden = r.items.iter().find(|m| m.page == "Garden").unwrap();
        let text = "# Garden\nCafé 🙂 notes: water the Basil and mint\n";
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let pos = garden.pos as usize;
        let at = String::from_utf16(&utf16[pos..pos + 5])
            .unwrap()
            .to_lowercase();
        assert!(
            at == "basil" || at.starts_with("mint"),
            "pos landed on {at:?}"
        );
        assert_eq!(garden.line, 2);
    }

    #[tokio::test]
    async fn duplicate_terms_differing_in_case_are_deduped() {
        let dir = space(&[("Herbs.md", "just basil here\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let r = b.query(req("basil Basil", None), cx()).await.unwrap();
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].page, "Herbs");
    }

    #[tokio::test]
    async fn flag_like_queries_are_literal() {
        let dir = space(&[("Opts.md", "use --pre=sh carefully\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let r = b
            .query(req("--pre=sh", Some(QueryMode::Phrase)), cx())
            .await
            .unwrap();
        assert_eq!(r.items.len(), 1);
        let r = b.query(req("-e", None), cx()).await.unwrap();
        assert!(r.items.is_empty());
    }

    #[tokio::test]
    async fn hidden_and_ignored_files_never_appear() {
        let dir = space(&[
            ("Visible.md", "secret word\n"),
            (".silverbullet/cache.md", "secret word\n"),
            ("Archive/Old.md", "secret word\n"),
        ]);
        let Some(b) = backend(dir.path(), &["Archive/Old.md"]) else {
            return;
        };
        let r = b.query(req("secret", None), cx()).await.unwrap();
        let pages: Vec<_> = r.items.iter().map(|m| m.page.as_str()).collect();
        assert_eq!(pages, ["Visible"]);
        assert_eq!(r.total, 1);
    }

    #[tokio::test]
    async fn include_and_exclude_filter_pages() {
        let dir = space(&[("A.md", "fern\n"), ("B.md", "fern\n"), ("C.md", "fern\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let mut r = req("fern", None);
        r.exclude = Some(vec!["B".into()]);
        let pages: Vec<_> = b
            .query(r, cx())
            .await
            .unwrap()
            .items
            .into_iter()
            .map(|m| m.page)
            .collect();
        assert_eq!(pages, ["A", "C"]);
        let mut r = req("fern", None);
        r.include = Some(vec!["C".into()]);
        let pages: Vec<_> = b
            .query(r, cx())
            .await
            .unwrap()
            .items
            .into_iter()
            .map(|m| m.page)
            .collect();
        assert_eq!(pages, ["C"]);
    }

    #[tokio::test]
    async fn regex_uses_smart_case_and_rejects_short_queries() {
        let dir = space(&[("A.md", "Fern\nfern\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let r = b
            .query(req("F[e]rn", Some(QueryMode::Regex)), cx())
            .await
            .unwrap();
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].line, 1);
        assert_eq!(
            b.query(req("f", None), cx()).await.unwrap_err(),
            SearchError::QueryTooShort(2)
        );
        assert!(matches!(
            b.query(req("x", Some(QueryMode::Natural)), cx()).await,
            Err(SearchError::Unsupported(_))
        ));
    }

    #[tokio::test]
    async fn oversized_files_and_lines_stay_bounded() {
        let big = format!("needle{}\n", "z".repeat(2 * 1024 * 1024));
        let long_line = format!("{}needle\n", "y".repeat(5000));
        let dir = space(&[("Big.md", &big), ("Long.md", &long_line)]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let r = b.query(req("needle", None), cx()).await.unwrap();
        let pages: Vec<_> = r.items.iter().map(|m| m.page.as_str()).collect();
        assert!(
            !pages.contains(&"Big"),
            "files over max-filesize are skipped"
        );
        assert!(r.items.iter().all(|m| m.excerpt.chars().count() <= 240));
    }

    #[tokio::test]
    async fn status_reports_unavailable_without_a_binary() {
        let dir = tempfile::tempdir().unwrap();
        let view = Arc::new(DirView::new(dir.path(), &[]));
        let engine = Engine::detect(dir.path(), None);
        let b = RipgrepBackend::new(dir.path().to_path_buf(), engine, view);
        let status = b.status();
        assert!(!status.ready);
        assert_eq!(status.backend, None);
        assert!(status.reason.unwrap().contains("ripgrep"));
        assert!(matches!(
            b.query(req("fern", None), cx()).await,
            Err(SearchError::Unavailable(_))
        ));
    }

    #[tokio::test]
    async fn total_never_counts_hidden_pages_past_the_limit() {
        let dir = space(&[
            ("A.md", "fern\n"),
            ("B.md", "fern\n"),
            ("C.md", "fern\n"),
            ("D.md", "fern\n"),
        ]);
        let Some(b) = backend(dir.path(), &["B.md", "C.md", "D.md"]) else {
            return;
        };
        let mut r = req("fern", None);
        r.limit = Some(1);
        let r = b.query(r, cx()).await.unwrap();
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.total, 1);
    }

    #[tokio::test]
    async fn pathological_regexes_return_promptly() {
        let line = format!("{}\n", "a".repeat(200_000));
        let dir = space(&[("Long.md", &line)]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let started = std::time::Instant::now();
        let r = b
            .query(req("(a|aa)*b", Some(QueryMode::Regex)), cx())
            .await
            .unwrap();
        assert!(r.items.is_empty());
        assert!(!r.partial, "linear-time regex finishes before the deadline");
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
