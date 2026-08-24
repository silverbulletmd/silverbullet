use std::sync::{Arc, Weak};
use std::time::Duration;

use super::engine::{AuthorConfig, RevisionEngine};
use crate::runtime::RuntimeBackend;

enum Attempt {
    NotReady,
    Done,
    Gone,
}

/// One poll: upgrades both `Weak`s, checks readiness, and (if ready) performs
/// the lookup — all strong refs are dropped when this returns, so the caller
/// never holds them across the retry sleep.
fn attempt(revisions: &Weak<RevisionEngine>, runtime: &Weak<dyn RuntimeBackend>) -> Attempt {
    let (Some(revisions), Some(runtime)) = (revisions.upgrade(), runtime.upgrade()) else {
        return Attempt::Gone;
    };
    if !runtime.ready() {
        return Attempt::NotReady;
    }
    if let Ok(v) = runtime.eval_global(
        "sbRuntime.evalLua",
        "config.get('revisions.authorEmailDomain')",
        Duration::from_secs(5),
    ) {
        revisions.set_author_config(AuthorConfig::from_config(v.as_str().unwrap_or("")));
    }
    Attempt::Done
}

/// Boot-time lookup of the space's `revisions.authorEmailDomain` Lua config,
/// applied to `revisions` once the runtime becomes ready. A no-op when the
/// store never auto-commits (nothing to attribute).
pub fn spawn_author_config_lookup(
    revisions: &Arc<RevisionEngine>,
    runtime: &Arc<dyn RuntimeBackend>,
) {
    if !revisions.store().auto_commit_allowed() {
        return;
    }
    let revisions = Arc::downgrade(revisions);
    let runtime = Arc::downgrade(runtime);
    std::thread::Builder::new()
        .name("sb-author-config".to_string())
        .spawn(move || {
            for _ in 0..20 {
                match attempt(&revisions, &runtime) {
                    Attempt::Done | Attempt::Gone => return,
                    Attempt::NotReady => std::thread::sleep(Duration::from_secs(30)),
                }
            }
        })
        .expect("failed to spawn author-config lookup thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::revisions::RevisionStore;
    use crate::runtime::{LogEntry, RuntimeError};
    use silverbullet_server_common::RevisionsMode;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct PanicsIfReady(AtomicBool);

    impl RuntimeBackend for PanicsIfReady {
        fn eval_global(
            &self,
            _fn_name: &str,
            _arg: &str,
            _timeout: Duration,
        ) -> Result<serde_json::Value, RuntimeError> {
            panic!("eval_global should never be reached for an unmanaged store");
        }
        fn logs(&self, _limit: usize, _since: Option<i64>) -> Vec<LogEntry> {
            vec![]
        }
        fn ready(&self) -> bool {
            self.0.store(true, Ordering::SeqCst);
            true
        }
    }

    #[test]
    fn unmanaged_store_never_spawns_the_lookup_thread() {
        let dir = tempfile::tempdir().unwrap();
        let store = RevisionStore::open(dir.path(), RevisionsMode::Unmanaged).unwrap();
        let revisions = RevisionEngine::start(store, None);
        let ready_called = Arc::new(PanicsIfReady(AtomicBool::new(false)));
        let runtime: Arc<dyn RuntimeBackend> = ready_called.clone();

        spawn_author_config_lookup(&revisions, &runtime);
        std::thread::sleep(Duration::from_millis(100));

        assert!(
            !ready_called.0.load(Ordering::SeqCst),
            "no thread should have been spawned for an unmanaged (never-auto-committing) store"
        );
    }
}
