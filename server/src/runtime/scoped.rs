use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use super::{LogEntry, RuntimeBackend, RuntimeError, RuntimeInstance};
use crate::auth::{AccessLevel, AccessPolicy, Actor, AuthContext, AuthOutcome, RequestAuthorizer};
use crate::multi::{
    instance::{RuntimeFactory, RuntimeRequest},
    users::UserStore,
};

pub struct ScopedRuntime {
    space_id: String,
    server_url: String,
    factory: RuntimeFactory,
    policy: Arc<dyn AccessPolicy>,
    users: Option<Arc<UserStore>>,
    enabled: Arc<AtomicBool>,
    stopped: AtomicBool,
    entries: Mutex<HashMap<Option<String>, Arc<RuntimeLease>>>,
}

struct RuntimeLease {
    id: String,
    operation: Mutex<()>,
    terminated: AtomicBool,
    reset_pending: AtomicBool,
    username: Option<String>,
    version: Option<String>,
    token: String,
    policy: Arc<dyn AccessPolicy>,
    users: Option<Arc<UserStore>>,
    enabled: Arc<AtomicBool>,
    active: AtomicBool,
    backend: Arc<dyn RuntimeBackend>,
}

impl RuntimeLease {
    fn permitted(&self) -> bool {
        let valid = !self.terminated.load(Ordering::SeqCst)
            && self.enabled.load(Ordering::SeqCst)
            && self.policy.runtime_allowed(self.username.as_deref())
            && match (&self.users, &self.username) {
                (Some(users), Some(username)) => users
                    .credential_version(username)
                    .is_some_and(|v| Some(v) == self.version),
                _ => true,
            };
        if !valid {
            self.shutdown();
        }
        valid
    }

    fn valid(&self) -> bool {
        self.active.load(Ordering::SeqCst) && self.permitted()
    }
}

impl RuntimeBackend for RuntimeLease {
    fn eval_global(
        &self,
        name: &str,
        arg: &str,
        timeout: Duration,
    ) -> Result<serde_json::Value, RuntimeError> {
        if !self.valid() {
            return Err(RuntimeError::Forbidden);
        }
        self.backend.eval_global(name, arg, timeout)
    }
    fn screenshot(
        &self,
        selector: Option<&str>,
        timeout: Duration,
    ) -> Result<Vec<u8>, RuntimeError> {
        if !self.valid() {
            return Err(RuntimeError::Forbidden);
        }
        self.backend.screenshot(selector, timeout)
    }
    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        if !self.valid() {
            return vec![];
        }
        self.backend.logs(limit, since)
    }
    fn ready(&self) -> bool {
        self.valid() && self.backend.ready()
    }
    fn shutdown(&self) {
        self.active.store(false, Ordering::SeqCst);
        if !self.terminated.swap(true, Ordering::SeqCst) {
            self.backend.shutdown();
        }
    }
}

impl ScopedRuntime {
    pub fn new(
        space_id: String,
        server_url: String,
        factory: RuntimeFactory,
        policy: Arc<dyn AccessPolicy>,
        users: Option<Arc<UserStore>>,
        enabled: Arc<AtomicBool>,
    ) -> Arc<Self> {
        let runtime = Arc::new(Self {
            space_id,
            server_url,
            factory,
            policy,
            users,
            enabled,
            stopped: AtomicBool::new(false),
            entries: Mutex::new(HashMap::new()),
        });
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let weak = Arc::downgrade(&runtime);
            handle.spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let Some(runtime) = weak.upgrade() else {
                        break;
                    };
                    if runtime.stopped.load(Ordering::SeqCst) {
                        break;
                    }
                    runtime
                        .entries
                        .lock()
                        .unwrap()
                        .retain(|_, entry| entry.permitted());
                }
            });
        }
        runtime
    }

    fn authorize(&self, token: &str) -> Option<AuthOutcome> {
        if self.stopped.load(Ordering::SeqCst) {
            return None;
        }
        let entries = self.entries.lock().unwrap();
        let entry = entries.values().find(|entry| {
            crate::auth::config::constant_time_eq(entry.token.as_bytes(), token.as_bytes())
        })?;
        if !entry.valid() {
            return None;
        }
        Some(match &entry.username {
            Some(username) => {
                AuthOutcome::user(username.clone()).with_version(entry.version.clone())
            }
            None => AuthOutcome::anonymous(),
        })
    }
}

impl RuntimeBackend for ScopedRuntime {
    fn for_actor(&self, actor: &Actor) -> Result<Option<Arc<dyn RuntimeBackend>>, RuntimeError> {
        loop {
            let previous = self.entries.lock().unwrap().get(&actor.username).cloned();
            let _operation = previous
                .as_ref()
                .map(|entry| entry.operation.lock().unwrap());
            let mut entries = self.entries.lock().unwrap();
            let current = entries.get(&actor.username);
            if !match (&previous, current) {
                (Some(previous), Some(current)) => Arc::ptr_eq(previous, current),
                (None, None) => true,
                _ => false,
            } {
                continue;
            }
            if self.stopped.load(Ordering::SeqCst) || !self.enabled.load(Ordering::SeqCst) {
                return Err(RuntimeError::NotReady);
            }
            if actor.level != AccessLevel::Write
                || !self.policy.runtime_allowed(actor.username.as_deref())
            {
                return Err(RuntimeError::Forbidden);
            }
            let version = match (&self.users, &actor.username) {
                (Some(users), Some(username)) => Some(
                    users
                        .credential_version(username)
                        .ok_or(RuntimeError::Forbidden)?,
                ),
                _ => None,
            };
            if self.users.is_some()
                && actor.username.is_some()
                && actor.credential_version != version
            {
                return Err(RuntimeError::Forbidden);
            }

            if let Some(entry) = &previous {
                if entry.reset_pending.load(Ordering::SeqCst) {
                    return Err(RuntimeError::NotReady);
                }
                if entry.valid() {
                    return Ok(Some(entry.clone()));
                }
            }
            let token = uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string();
            let resumed = match &previous {
                Some(entry) if entry.permitted() => entry.backend.restart(&token)?,
                _ => None,
            };
            let backend = match resumed {
                Some(backend) => backend,
                None => Arc::from(
                    (self.factory)(&RuntimeRequest {
                        space_id: &self.space_id,
                        server_url: self.server_url.clone(),
                        headless_token: &token,
                        read_only: false,
                    })
                    .ok_or(RuntimeError::NotReady)?,
                ),
            };
            let entry = Arc::new(RuntimeLease {
                id: uuid::Uuid::new_v4().to_string(),
                operation: Mutex::new(()),
                terminated: AtomicBool::new(false),
                reset_pending: AtomicBool::new(false),
                username: actor.username.clone(),
                version,
                token,
                policy: self.policy.clone(),
                users: self.users.clone(),
                enabled: self.enabled.clone(),
                active: AtomicBool::new(true),
                backend,
            });
            if !entry.valid() {
                return Err(RuntimeError::Forbidden);
            }
            entries.insert(actor.username.clone(), entry.clone());
            return Ok(Some(entry));
        }
    }
    fn runtime_instances(&self) -> Vec<RuntimeInstance> {
        let entries: Vec<_> = self.entries.lock().unwrap().values().cloned().collect();
        entries
            .into_iter()
            .filter_map(|entry| {
                if !entry.permitted() {
                    return None;
                }
                Some(RuntimeInstance {
                    id: entry.id.clone(),
                    space_id: self.space_id.clone(),
                    username: entry.username.clone(),
                    snapshot: entry.backend.snapshot()?,
                })
            })
            .collect()
    }
    fn manage_runtime(&self, id: &str, reset: bool) -> Result<bool, RuntimeError> {
        let entry = self
            .entries
            .lock()
            .unwrap()
            .values()
            .find(|entry| entry.id == id)
            .cloned();
        let Some(entry) = entry else {
            return Ok(false);
        };
        let _operation = entry.operation.lock().unwrap();
        {
            let entries = self.entries.lock().unwrap();
            if !entries
                .get(&entry.username)
                .is_some_and(|current| Arc::ptr_eq(current, &entry))
            {
                return Ok(false);
            }
            if !reset && entry.reset_pending.load(Ordering::SeqCst) {
                return Err(RuntimeError::NotReady);
            }
            if reset {
                entry.reset_pending.store(true, Ordering::SeqCst);
            }
            entry.active.store(false, Ordering::SeqCst);
        }
        entry.backend.stop(!reset)?;
        if reset {
            let mut entries = self.entries.lock().unwrap();
            if entries
                .get(&entry.username)
                .is_some_and(|current| Arc::ptr_eq(current, &entry))
            {
                entries.remove(&entry.username);
            }
            entry.shutdown();
        }
        Ok(true)
    }
    fn eval_global(
        &self,
        _: &str,
        _: &str,
        _: Duration,
    ) -> Result<serde_json::Value, RuntimeError> {
        Err(RuntimeError::NotReady)
    }
    fn logs(&self, _: usize, _: Option<i64>) -> Vec<LogEntry> {
        vec![]
    }
    fn ready(&self) -> bool {
        false
    }
    fn reset(&self) {
        for entry in self.entries.lock().unwrap().drain().map(|(_, entry)| entry) {
            entry.shutdown();
        }
    }
    fn revoke_user(&self, username: &str) {
        if let Some(entry) = self.entries.lock().unwrap().remove(&Some(username.into())) {
            entry.shutdown();
        }
    }
    fn shutdown(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.reset();
    }
}

impl Drop for ScopedRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct ScopedRuntimeAuthorizer {
    pub inner: Option<Arc<dyn RequestAuthorizer>>,
    pub cookie_name: String,
    pub runtime: Arc<ScopedRuntime>,
}

impl RequestAuthorizer for ScopedRuntimeAuthorizer {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome> {
        if let Some(token) = crate::auth::cookie_value(ctx.headers, &self.cookie_name) {
            return self.runtime.authorize(&token);
        }
        match &self.inner {
            Some(inner) => inner.authorize(ctx),
            None => Some(AuthOutcome::trusted()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{AccessLevel, AuthorizedPolicy};
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;
    struct Backend {
        id: usize,
        stopped: AtomicBool,
        deleted: AtomicBool,
        fail_reset: AtomicBool,
    }
    impl RuntimeBackend for Backend {
        fn eval_global(
            &self,
            _: &str,
            _: &str,
            _: Duration,
        ) -> Result<serde_json::Value, RuntimeError> {
            Ok(serde_json::json!(self.id))
        }
        fn logs(&self, _: usize, _: Option<i64>) -> Vec<super::super::LogEntry> {
            vec![]
        }
        fn ready(&self) -> bool {
            !self.stopped.load(Ordering::SeqCst)
        }
        fn shutdown(&self) {
            self.stopped.store(true, Ordering::SeqCst);
            self.deleted.store(true, Ordering::SeqCst);
        }
        fn snapshot(&self) -> Option<super::super::RuntimeSnapshot> {
            Some(super::super::RuntimeSnapshot {
                status: if self.stopped.load(Ordering::SeqCst) {
                    "stopped"
                } else {
                    "running"
                }
                .into(),
                cpu_percent: Some(0.0),
                memory_bytes: Some(1024),
                disk_bytes: Some(2048),
            })
        }
        fn stop(&self, retain_profile: bool) -> Result<(), RuntimeError> {
            self.stopped.store(true, Ordering::SeqCst);
            if !retain_profile && self.fail_reset.swap(false, Ordering::SeqCst) {
                return Err(RuntimeError::Transport("profile deletion failed".into()));
            }
            self.deleted.store(!retain_profile, Ordering::SeqCst);
            Ok(())
        }
        fn restart(&self, _: &str) -> Result<Option<Arc<dyn RuntimeBackend>>, RuntimeError> {
            if self.deleted.load(Ordering::SeqCst) {
                return Err(RuntimeError::NotReady);
            }
            Ok(Some(Arc::new(Backend {
                id: self.id,
                stopped: AtomicBool::new(false),
                deleted: AtomicBool::new(false),
                fail_reset: AtomicBool::new(false),
            })))
        }
    }
    fn actor(name: &str) -> Actor {
        Actor {
            username: Some(name.into()),
            level: AccessLevel::Write,
            ..Default::default()
        }
    }
    fn runtime(enabled: Arc<AtomicBool>) -> Arc<ScopedRuntime> {
        let next = AtomicUsize::new(0);
        ScopedRuntime::new(
            "space".into(),
            "http://127.0.0.1:3000".into(),
            Arc::new(move |_| {
                Some(Box::new(Backend {
                    id: next.fetch_add(1, Ordering::SeqCst),
                    stopped: AtomicBool::new(false),
                    deleted: AtomicBool::new(false),
                    fail_reset: AtomicBool::new(false),
                }))
            }),
            Arc::new(AuthorizedPolicy),
            None,
            enabled,
        )
    }
    #[test]
    fn administrative_stop_revokes_old_generation_and_resumes_with_new_identity() {
        let runtime = runtime(Arc::new(AtomicBool::new(true)));
        assert!(runtime.runtime_instances().is_empty());
        let old = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        let token = runtime.entries.lock().unwrap()[&Some("writer-one".into())]
            .token
            .clone();
        let initial = runtime.runtime_instances();
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].space_id, "space");
        assert_eq!(initial[0].username.as_deref(), Some("writer-one"));
        assert!(runtime.manage_runtime(&initial[0].id, false).unwrap());
        assert!(runtime.authorize(&token).is_none());
        assert!(old.eval_global("f", "", Duration::ZERO).is_err());
        assert_eq!(runtime.runtime_instances()[0].snapshot.status, "stopped");
        let new = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        assert!(!Arc::ptr_eq(&old, &new));
        assert!(new.eval_global("f", "", Duration::ZERO).is_ok());
        assert!(old.eval_global("f", "", Duration::ZERO).is_err());
        assert!(runtime.authorize(&token).is_none());
        let replacement = runtime.runtime_instances();
        assert_ne!(initial[0].id, replacement[0].id);
        let new_token = runtime.entries.lock().unwrap()[&Some("writer-one".into())]
            .token
            .clone();
        assert_ne!(token, new_token);
        assert_eq!(
            runtime.authorize(&new_token).unwrap().username.as_deref(),
            Some("writer-one")
        );
        assert!(!runtime.manage_runtime(&initial[0].id, true).unwrap());
        assert!(runtime.manage_runtime(&replacement[0].id, true).unwrap());
        assert!(runtime.runtime_instances().is_empty());
    }

    #[test]
    fn failed_reset_cannot_resume_partially_deleted_profile() {
        let mut runtime = runtime(Arc::new(AtomicBool::new(true)));
        Arc::get_mut(&mut runtime).unwrap().factory = Arc::new(|_| {
            Some(Box::new(Backend {
                id: 0,
                stopped: AtomicBool::new(false),
                deleted: AtomicBool::new(false),
                fail_reset: AtomicBool::new(true),
            }))
        });
        runtime.for_actor(&actor("writer-one")).unwrap();
        let id = runtime.runtime_instances()[0].id.clone();
        assert!(runtime.manage_runtime(&id, true).is_err());
        assert!(runtime.for_actor(&actor("writer-one")).is_err());
        assert_eq!(runtime.runtime_instances()[0].id, id);
        assert!(runtime.manage_runtime(&id, true).unwrap());
        assert!(runtime.runtime_instances().is_empty());
        assert!(runtime.for_actor(&actor("writer-one")).is_ok());
    }

    #[test]
    fn revoked_stopped_runtime_is_deleted_without_restart() {
        let enabled = Arc::new(AtomicBool::new(true));
        let runtime = runtime(enabled.clone());
        runtime.for_actor(&actor("writer-one")).unwrap();
        let id = runtime.runtime_instances()[0].id.clone();
        runtime.manage_runtime(&id, false).unwrap();
        let retained = runtime.entries.lock().unwrap()[&Some("writer-one".into())].clone();
        enabled.store(false, Ordering::SeqCst);
        runtime.reset();
        assert!(runtime.runtime_instances().is_empty());
        assert!(runtime.for_actor(&actor("writer-one")).is_err());
        assert!(retained.backend.restart("replacement").is_err());
    }

    #[test]
    fn queued_actor_cannot_join_runtime_after_credential_revocation() {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user(
                "writer-one",
                "before-password",
                false,
                crate::multi::users::Profile::default(),
            )
            .unwrap();
        let mut runtime = runtime(Arc::new(AtomicBool::new(true)));
        Arc::get_mut(&mut runtime).unwrap().users = Some(users.clone());
        let mut queued = actor("writer-one");
        queued.credential_version = users.credential_version("writer-one");
        assert!(runtime.for_actor(&queued).is_ok());
        users.set_password("writer-one", "after-password").unwrap();
        assert!(matches!(
            runtime.for_actor(&queued),
            Err(RuntimeError::Forbidden)
        ));
    }

    #[test]
    fn runtime_selection_is_per_actor_and_reuses_only_that_actor() {
        let runtime = runtime(Arc::new(AtomicBool::new(true)));
        let one = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        let again = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        let other = runtime.for_actor(&actor("writer-two")).unwrap().unwrap();
        assert!(Arc::ptr_eq(&one, &again));
        assert!(!Arc::ptr_eq(&one, &other));
        assert_ne!(
            one.eval_global("f", "", Duration::ZERO).unwrap(),
            other.eval_global("f", "", Duration::ZERO).unwrap()
        );
    }
    #[test]
    fn revocation_invalidates_stale_handles_and_reset_allows_fresh_runtime() {
        let enabled = Arc::new(AtomicBool::new(true));
        let runtime = runtime(enabled.clone());
        let old = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        runtime.revoke_user("writer-one");
        assert!(old.eval_global("f", "", Duration::ZERO).is_err());
        let new = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        assert!(!Arc::ptr_eq(&old, &new));
        enabled.store(false, Ordering::SeqCst);
        runtime.reset();
        assert!(runtime.for_actor(&actor("writer-one")).is_err());
        assert!(new.eval_global("f", "", Duration::ZERO).is_err());
        enabled.store(true, Ordering::SeqCst);
        assert!(runtime.for_actor(&actor("writer-one")).is_ok());
        runtime.shutdown();
        assert!(runtime.for_actor(&actor("writer-one")).is_err());
    }
}
