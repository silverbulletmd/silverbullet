//! `sb logs` — show console logs from the running SilverBullet server.
//!
//! Behaviour:
//!  - Initial fetch: `conn.logs(lines, None)`, print each entry as
//!    `<RFC3339-UTC> [<level>] <text>`, track the highest timestamp seen.
//!  - With `--follow`: loop every 500 ms, fetch `conn.logs(0, Some(last_ts))`,
//!    print any new entries, update the high-water mark.

use crate::api::LogEntry;
use crate::conn::SpaceConnection;

// ---------------------------------------------------------------------------
// Pure formatter — tested independently
// ---------------------------------------------------------------------------

/// Format one log entry as `<RFC3339-UTC> [<level>] <text>`.
///
/// The timestamp is epoch **milliseconds** (matching `LogEntry.timestamp`).
/// Rendered at UTC seconds precision with a `Z` suffix.
pub fn format_entry(entry: &LogEntry) -> String {
    let ts = chrono::DateTime::from_timestamp_millis(entry.timestamp)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true); // `true` → 'Z', Secs → no fraction
    format!("{ts} [{}] {}", entry.level, entry.text)
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Run the `logs` command, writing output to `out`.
///
/// `lines`  – how many recent entries to fetch initially (passed as `limit`).
/// `follow` – if `true`, poll every 500 ms for new entries after the initial
///            fetch and print them as they arrive (Ctrl-C to stop).
pub fn run(
    conn: &SpaceConnection,
    lines: usize,
    follow: bool,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    // Initial fetch: limit=lines, no `since` filter.
    let logs = conn.logs(lines, None)?;
    let mut last_ts: i64 = 0;
    for e in &logs {
        writeln!(out, "{}", format_entry(e)).map_err(|err| err.to_string())?;
        if e.timestamp > last_ts {
            last_ts = e.timestamp;
        }
    }

    if follow {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            // limit=0 (no cap), since=last_ts to get only new entries.
            let new_logs = conn.logs(0, Some(last_ts))?;
            for e in &new_logs {
                writeln!(out, "{}", format_entry(e)).map_err(|err| err.to_string())?;
                if e.timestamp > last_ts {
                    last_ts = e.timestamp;
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::LogEntry;

    fn entry(level: &str, text: &str, timestamp: i64) -> LogEntry {
        LogEntry {
            level: level.to_string(),
            text: text.to_string(),
            timestamp,
        }
    }

    // -----------------------------------------------------------------------
    // format_entry — RFC3339 UTC, second precision, 'Z' suffix
    // -----------------------------------------------------------------------

    /// 1717848000000 ms = 2024-06-08T12:00:00Z
    #[test]
    fn format_entry_known_timestamp() {
        let e = entry("log", "hello", 1_717_848_000_000);
        assert_eq!(format_entry(&e), "2024-06-08T12:00:00Z [log] hello");
    }

    /// level=error, text with spaces
    #[test]
    fn format_entry_error_level_with_spaces() {
        let e = entry("error", "some text", 1_717_848_000_000);
        assert_eq!(format_entry(&e), "2024-06-08T12:00:00Z [error] some text");
    }

    /// timestamp=0 → Unix epoch
    #[test]
    fn format_entry_epoch_zero() {
        let e = entry("info", "boot", 0);
        assert_eq!(format_entry(&e), "1970-01-01T00:00:00Z [info] boot");
    }

    /// timestamp at a fractional-second boundary — must truncate to seconds, no fraction
    #[test]
    fn format_entry_no_fractional_seconds() {
        // 1717848000500 ms = 2024-06-08T12:00:00.5Z — should display as :00Z
        let e = entry("warn", "mid-second", 1_717_848_000_500);
        let formatted = format_entry(&e);
        assert_eq!(formatted, "2024-06-08T12:00:00Z [warn] mid-second");
    }

    // -----------------------------------------------------------------------
    // run() — drive via an in-memory writer (no HTTP)
    // -----------------------------------------------------------------------

    // We can't easily call run() without a live server, but we can verify
    // format_entry is the single formatting path and that the output written
    // for known entries matches expectations via the formatter alone.
    // (Integration tests with a mock HTTP server live in api.rs.)
}
