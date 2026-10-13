//! Fixed resource limits for ripgrep searches. They are not configurable: they
//! bound what one signed-in user can make the server do, and public visitors
//! get no ripgrep search at all.

use std::time::Duration;

/// How long a structured query or related-pages search may run.
pub const DEADLINE: Duration = Duration::from_secs(3);
/// How long a raw rg passthrough may run.
pub const RAW_DEADLINE: Duration = Duration::from_secs(15);
/// rg processes running at once, server-wide.
pub const MAX_PROCESSES: usize = 3;
/// How long a request waits for a free process before it is `Busy`.
pub const QUEUE_WAIT: Duration = Duration::from_secs(1);
pub const MIN_QUERY_CHARS: usize = 2;
pub const MAX_QUERY_BYTES: usize = 4096;
pub const MAX_TERMS: usize = 16;
pub const MAX_RESULTS: usize = 50;
/// rg's stdout is cut (and rg killed) past this many bytes.
pub const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
/// `--max-filesize`: larger files are skipped (1M).
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// `--max-columns`: longer lines are not printed.
pub const MAX_COLUMNS: u32 = 500;
/// `RLIMIT_CPU` for each rg process.
pub const CPU_SECONDS: u64 = 10;
/// Scheduling priority each rg process runs at.
pub const NICENESS: i32 = 10;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_match_the_spec() {
        assert_eq!(DEADLINE, Duration::from_millis(3000));
        assert_eq!(RAW_DEADLINE, Duration::from_millis(15000));
        assert_eq!((MAX_PROCESSES, QUEUE_WAIT), (3, Duration::from_secs(1)));
        assert_eq!((MIN_QUERY_CHARS, MAX_QUERY_BYTES, MAX_TERMS), (2, 4096, 16));
        assert_eq!((MAX_RESULTS, MAX_OUTPUT_BYTES), (50, 8 << 20));
        assert_eq!((MAX_FILE_BYTES, MAX_COLUMNS), (1 << 20, 500));
        assert_eq!((CPU_SECONDS, NICENESS), (10, 10));
    }
}
