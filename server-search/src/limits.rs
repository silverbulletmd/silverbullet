//! Fixed limits every search backend shares. They are not configurable: they
//! bound what one caller can make the server do.

use std::time::Duration;

/// How long a structured query or related-pages search may run.
pub const DEADLINE: Duration = Duration::from_secs(3);
/// Shorter queries are refused, except one Chinese, Japanese or Korean
/// character.
pub const MIN_QUERY_CHARS: usize = 2;
pub const MAX_QUERY_BYTES: usize = 4096;
pub const MAX_TERMS: usize = 16;
pub const MAX_RESULTS: usize = 50;
/// Larger files are never searched (1 MiB).
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Queries an index backend runs at once, server-wide.
pub const MAX_QUERIES: usize = 8;
/// How long a query waits for a free query slot before it is `Busy`.
pub const QUERY_QUEUE_WAIT: Duration = Duration::from_secs(1);
/// Query embeddings that may wait for the semantic model, server-wide; one
/// more is `Busy`.
pub const MAX_QUERY_EMBEDS: usize = 8;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_match_the_spec() {
        assert_eq!(DEADLINE, Duration::from_millis(3000));
        assert_eq!((MIN_QUERY_CHARS, MAX_QUERY_BYTES, MAX_TERMS), (2, 4096, 16));
        assert_eq!((MAX_RESULTS, MAX_FILE_BYTES), (50, 1 << 20));
        assert_eq!((MAX_QUERIES, QUERY_QUEUE_WAIT), (8, Duration::from_secs(1)));
        assert_eq!(MAX_QUERY_EMBEDS, 8);
    }
}
