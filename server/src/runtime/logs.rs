//! Console-log ring buffer shared between a `ClientTransport` (which pushes
//! captured console output) and the `ClientRuntime` (which serves it via
//! `/.runtime/logs`). The standalone server hosts a single space, so this is a
//! single bounded buffer (no per-space keying — that lives in the App).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// A captured console log entry. Field names form the `/.runtime/logs` wire
/// contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogEntry {
    pub level: String,
    pub text: String,
    pub timestamp: i64,
}

const MAX_LOG_ENTRIES: usize = 1000;

/// A cloneable, thread-safe bounded ring buffer of log entries. Clones share
/// the same underlying buffer (so the transport and the runtime see one log).
#[derive(Clone, Default)]
pub struct LogBuffer {
    inner: Arc<Mutex<VecDeque<LogEntry>>>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Append an entry, evicting the oldest once `MAX_LOG_ENTRIES` is reached.
    pub fn push(&self, entry: LogEntry) {
        let mut buf = self.inner.lock().unwrap();
        if buf.len() >= MAX_LOG_ENTRIES {
            buf.pop_front();
        }
        buf.push_back(entry);
    }

    /// Return entries, optionally only those strictly newer than `since`
    /// (timestamp), capped to the most recent `limit`.
    pub fn query(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        let buf = self.inner.lock().unwrap();
        let filtered: Vec<LogEntry> = buf
            .iter()
            .filter(|e| since.is_none_or(|s| e.timestamp > s))
            .cloned()
            .collect();
        if limit < filtered.len() {
            filtered[filtered.len() - limit..].to_vec()
        } else {
            filtered
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(text: &str, ts: i64) -> LogEntry {
        LogEntry {
            level: "log".into(),
            text: text.into(),
            timestamp: ts,
        }
    }

    #[test]
    fn push_and_query_roundtrip() {
        let buf = LogBuffer::new();
        buf.push(entry("a", 1));
        buf.push(entry("b", 2));
        let all = buf.query(100, None);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].text, "a");
        assert_eq!(all[1].text, "b");
    }

    #[test]
    fn since_filters_strictly_newer() {
        let buf = LogBuffer::new();
        buf.push(entry("a", 1));
        buf.push(entry("b", 2));
        buf.push(entry("c", 3));
        let newer = buf.query(100, Some(2));
        assert_eq!(newer.len(), 1);
        assert_eq!(newer[0].text, "c");
    }

    #[test]
    fn limit_returns_the_most_recent() {
        let buf = LogBuffer::new();
        for i in 0..5 {
            buf.push(entry(&format!("e{i}"), i));
        }
        let last2 = buf.query(2, None);
        assert_eq!(last2.len(), 2);
        assert_eq!(last2[0].text, "e3");
        assert_eq!(last2[1].text, "e4");
    }

    #[test]
    fn ring_evicts_oldest_past_capacity() {
        let buf = LogBuffer::new();
        for i in 0..(MAX_LOG_ENTRIES as i64 + 10) {
            buf.push(entry("x", i));
        }
        let all = buf.query(usize::MAX, None);
        assert_eq!(all.len(), MAX_LOG_ENTRIES);
        // The oldest 10 were evicted; the first remaining timestamp is 10.
        assert_eq!(all.first().unwrap().timestamp, 10);
    }

    #[test]
    fn clones_share_one_buffer() {
        let a = LogBuffer::new();
        let b = a.clone();
        a.push(entry("shared", 1));
        assert_eq!(b.query(100, None).len(), 1);
    }
}
