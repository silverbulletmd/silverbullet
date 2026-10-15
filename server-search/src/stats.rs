//! What the full-text index's log lines report: the startup line, and the
//! "index ready" line after a build.

use std::time::Duration;

use crate::index::Opened;
use crate::IndexKind;

/// What the "index ready" log line reports, after the initial build and after
/// a reconcile that changed more than `BATCH_PAGES` pages.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexStats {
    /// Pages in the index.
    pub pages: u64,
    /// The index's size (`IndexStore::size_bytes`).
    pub bytes: u64,
    pub memory: bool,
    /// How long the reconcile took, listing included.
    pub elapsed: Duration,
    /// Pages left out because they are over `MAX_FILE_BYTES` or not UTF-8.
    pub skipped: u64,
    /// The reconcile updated an existing index (one reused from disk, or a
    /// large change after the first build) instead of building a new one.
    pub caught_up: bool,
}

impl IndexStats {
    /// `Search index ready (space "<name>"): 1,482 pages, 3.1 MB on disk,
    /// built in 2.4 s` (`Semantic index ready …` for a semantic sink;
    /// `caught up in` when [`IndexStats::caught_up`]) and, with skipped
    /// pages, `, skipped 2 (too large or not UTF-8)`.
    pub fn line(&self, kind: IndexKind, name: &str) -> String {
        let mut line = format!(
            "{} ready (space \"{name}\"): {}, {} {}, {} in {:.1} s",
            kind.title(),
            pages(self.pages),
            human_bytes(self.bytes),
            if self.memory { "in memory" } else { "on disk" },
            if self.caught_up { "caught up" } else { "built" },
            self.elapsed.as_secs_f64()
        );
        if self.skipped > 0 {
            line.push_str(&format!(
                ", skipped {} (too large or not UTF-8)",
                thousands(self.skipped)
            ));
        }
        line
    }
}

/// The startup line: how the store was opened and, when reused, its pages.
pub fn opened_line(name: &str, opened: Opened, pages_in_index: u64) -> String {
    let how = match opened {
        Opened::Reused => format!("reusing on-disk index, {}", pages(pages_in_index)),
        Opened::Resumed => format!(
            "resuming an unfinished on-disk index, {}",
            pages(pages_in_index)
        ),
        Opened::Fresh => "building from scratch".to_string(),
        Opened::Memory => "in memory, building".to_string(),
    };
    format!("Search index (space \"{name}\"): {how}")
}

/// `1 page`, `1,482 pages`.
pub(crate) fn pages(n: u64) -> String {
    let unit = if n == 1 { "page" } else { "pages" };
    format!("{} {unit}", thousands(n))
}

/// `1482` → `1,482`.
pub(crate) fn thousands(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Bytes, KB, MB or GB (1024-based), one decimal above bytes.
fn human_bytes(n: u64) -> String {
    const UNITS: [&str; 3] = ["KB", "MB", "GB"];
    if n < 1024 {
        return format!("{n} B");
    }
    let mut value = n as f64 / 1024.0;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_lines() {
        let stats = IndexStats {
            pages: 1482,
            bytes: 3_250_000,
            memory: false,
            elapsed: Duration::from_millis(2_440),
            skipped: 0,
            caught_up: false,
        };
        assert_eq!(
            stats.line(IndexKind::FullText, "0f6c"),
            "Search index ready (space \"0f6c\"): 1,482 pages, 3.1 MB on disk, built in 2.4 s"
        );
        let stats = IndexStats {
            pages: 1,
            bytes: 900,
            memory: true,
            elapsed: Duration::from_millis(30),
            skipped: 1234,
            caught_up: false,
        };
        assert_eq!(
            stats.line(IndexKind::FullText, "notes"),
            "Search index ready (space \"notes\"): 1 page, 900 B in memory, built in 0.0 s, \
             skipped 1,234 (too large or not UTF-8)"
        );
        let stats = IndexStats {
            pages: 2,
            bytes: 2048,
            memory: false,
            elapsed: Duration::from_millis(150),
            skipped: 0,
            caught_up: true,
        };
        assert_eq!(
            stats.line(IndexKind::FullText, "notes"),
            "Search index ready (space \"notes\"): 2 pages, 2.0 KB on disk, caught up in 0.1 s"
        );
        assert_eq!(
            stats.line(IndexKind::Semantic, "notes"),
            "Semantic index ready (space \"notes\"): 2 pages, 2.0 KB on disk, caught up in 0.1 s"
        );
        assert_eq!(
            opened_line("notes", Opened::Fresh, 0),
            "Search index (space \"notes\"): building from scratch"
        );
        assert_eq!(
            opened_line("notes", Opened::Memory, 0),
            "Search index (space \"notes\"): in memory, building"
        );
        assert_eq!(thousands(0), "0");
        assert_eq!(thousands(999), "999");
        assert_eq!(thousands(1_000), "1,000");
        assert_eq!(thousands(1_234_567), "1,234,567");
        assert_eq!(human_bytes(1023), "1023 B");
        assert_eq!(human_bytes(1024), "1.0 KB");
        assert_eq!(human_bytes(5 * 1024 * 1024 * 1024), "5.0 GB");
        assert_eq!(human_bytes(3 * 1024 * 1024 * 1024 * 1024), "3072.0 GB");
    }
}
