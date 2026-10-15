//! The space-size policy for semantic search: it is on by default for a
//! space of up to [`SEMANTIC_MAX_PAGES`] pages, as the full-text index counts
//! them, and off by default above that ([`too_large`]), where a space can
//! still turn it on. A space that has it keeps it at any size, with a
//! warning ([`oversize_warning`]).

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Mutex;

/// The space-size policy, far below the semantic index's own page cap
/// (`sink::MAX_PAGES`): semantic search is on by default for a space of
/// up to this many pages (regular and meta pages, as the full-text index
/// counts them). A space that grows past it keeps semantic search, with a
/// warning; a larger one turns it on explicitly.
pub const SEMANTIC_MAX_PAGES: u64 = 5_000;
use crate::stats::thousands;

/// Semantic search is off by default for this space: it has `pages`
/// pages, more than [`SEMANTIC_MAX_PAGES`]. It reads as the dashboard's
/// note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SemanticTooLarge {
    pub pages: u64,
}

impl fmt::Display for SemanticTooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "This space has {} pages, more than {}, so semantic search is off by default. Turn it on to build it anyway; the first build can take a long time.",
            thousands(self.pages),
            thousands(SEMANTIC_MAX_PAGES)
        )
    }
}

impl std::error::Error for SemanticTooLarge {}

/// Why semantic search is off by default for a space whose full-text
/// index counts `pages` pages: more than [`SEMANTIC_MAX_PAGES`]. Without a
/// count (the space isn't running, or its index failed) it is on, and the
/// semantic index's own caps apply. Whether the space was admitted before
/// is the caller's to judge (`SpaceSearch` in the server).
pub fn too_large(pages: Option<u64>) -> Option<SemanticTooLarge> {
    pages
        .filter(|&pages| pages > SEMANTIC_MAX_PAGES)
        .map(|pages| SemanticTooLarge { pages })
}

/// The status warning of a space with semantic search above the limit.
pub fn oversize_warning(pages: Option<u64>) -> Option<String> {
    pages.filter(|&pages| pages > SEMANTIC_MAX_PAGES).map(|_| {
        format!(
            "This space has more pages than semantic search is tuned for ({}); results may be less relevant.",
            thousands(SEMANTIC_MAX_PAGES)
        )
    })
}

/// Spaces already warned about in the log, process-wide.
static WARNED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// [`oversize_warning`], logging it the first time space `name` is seen
/// above the limit in this process.
pub(crate) fn oversize_warning_logged(name: &str, pages: Option<u64>) -> Option<String> {
    let warning = oversize_warning(pages)?;
    if first_time(name) {
        tracing::warn!(
            "Semantic index (space \"{name}\"): {} pages, more than the {} semantic search is tuned for",
            thousands(pages.unwrap_or_default()),
            thousands(SEMANTIC_MAX_PAGES)
        );
    }
    Some(warning)
}

fn first_time(name: &str) -> bool {
    WARNED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limit_is_far_below_the_index_caps() {
        assert_eq!(SEMANTIC_MAX_PAGES, 5_000);
        assert!(SEMANTIC_MAX_PAGES < super::super::sink::MAX_PAGES as u64);
    }

    #[test]
    fn only_a_count_above_the_limit_is_too_large() {
        assert_eq!(too_large(Some(5_000)), None);
        assert_eq!(too_large(None), None, "an unknown count is allowed");
        let refused = too_large(Some(5_001)).unwrap();
        assert_eq!(refused, SemanticTooLarge { pages: 5_001 });
        assert_eq!(
            refused.to_string(),
            "This space has 5,001 pages, more than 5,000, so semantic search is off by default. Turn it on to build it anyway; the first build can take a long time."
        );
    }

    #[test]
    fn the_warning_starts_above_the_limit() {
        assert_eq!(oversize_warning(None), None);
        assert_eq!(oversize_warning(Some(5_000)), None);
        assert_eq!(
            oversize_warning(Some(5_001)).as_deref(),
            Some("This space has more pages than semantic search is tuned for (5,000); results may be less relevant.")
        );
    }

    #[test]
    fn each_space_is_logged_once() {
        assert!(first_time("size-test-Orchard"));
        assert!(!first_time("size-test-Orchard"));
        assert!(first_time("size-test-Meadow"));
        assert!(oversize_warning_logged("size-test-Meadow", Some(9_000)).is_some());
        assert!(oversize_warning_logged("size-test-Meadow", Some(10)).is_none());
    }
}
