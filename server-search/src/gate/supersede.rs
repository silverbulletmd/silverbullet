//! A tab's newer interactive query cancels its previous one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio_util::sync::CancellationToken;

use super::MAX_TRACKED;

/// The user and whether they write, not just the username: a signed-out writer
/// and an anonymous visitor on the same tab id are different clients.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Key {
    space: String,
    user: Option<String>,
    writer: bool,
    tab: String,
}

struct Entry {
    cancel: CancellationToken,
    /// Shared with the admitted request; once only this copy is left, no request uses the entry.
    live: Arc<()>,
}

/// Keeps a superseding request's entry alive for as long as the request runs.
pub(crate) struct Registration {
    _live: Arc<()>,
}

pub(crate) struct Supersede {
    entries: Mutex<HashMap<Key, Entry>>,
    max_tracked: usize,
}

impl Supersede {
    pub(crate) fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            max_tracked: MAX_TRACKED,
        }
    }

    /// Cancels the previous request of `(space, user, writer, tab)` and registers a new one.
    pub(crate) fn register(
        &self,
        space: &str,
        user: Option<&str>,
        writer: bool,
        tab: &str,
    ) -> (CancellationToken, Registration) {
        let mut entries = self.entries.lock().expect("search gate poisoned");
        if entries.len() > self.max_tracked {
            entries.retain(|_, e| Arc::strong_count(&e.live) > 1);
        }
        let key = Key {
            space: space.to_string(),
            user: user.map(String::from),
            writer,
            tab: tab.to_string(),
        };
        let entry = Entry {
            cancel: CancellationToken::new(),
            live: Arc::new(()),
        };
        let admitted = (
            entry.cancel.clone(),
            Registration {
                _live: entry.live.clone(),
            },
        );
        if let Some(previous) = entries.insert(key, entry) {
            previous.cancel.cancel();
        }
        admitted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eviction_drops_only_entries_no_request_holds() {
        let mut supersede = Supersede::new();
        supersede.max_tracked = 1;
        let (held, _registration) = supersede.register("/spaces/a", Some("alice"), true, "held");
        for i in 0..3 {
            drop(supersede.register("/spaces/a", Some("alice"), true, &i.to_string()));
        }
        assert!(supersede.entries.lock().unwrap().len() <= 2);
        let _ = supersede.register("/spaces/a", Some("alice"), true, "held");
        assert!(held.is_cancelled(), "a held entry survives eviction");
    }
}
