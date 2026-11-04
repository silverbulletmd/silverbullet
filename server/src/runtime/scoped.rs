use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

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
    /// Seconds without a request after which a runtime is stopped, keeping
    /// its profile; `0` never stops it.
    idle_timeout: Arc<AtomicU64>,
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
    last_used: Mutex<Instant>,
    in_flight: AtomicUsize,
    backend: Arc<dyn RuntimeBackend>,
}

/// Marks a request in progress on a lease, so idle stop leaves it alone.
struct InFlight<'a>(&'a RuntimeLease);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.touch();
        self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

impl RuntimeLease {
    fn touch(&self) {
        *self.last_used.lock().unwrap() = Instant::now();
    }

    fn begin(&self) -> InFlight<'_> {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        self.touch();
        InFlight(self)
    }

    fn idle_for(&self, timeout: Duration) -> bool {
        self.active.load(Ordering::SeqCst)
            && !self.reset_pending.load(Ordering::SeqCst)
            && self.in_flight.load(Ordering::SeqCst) == 0
            && self.last_used.lock().unwrap().elapsed() >= timeout
    }

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
        let _in_flight = self.begin();
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
        let _in_flight = self.begin();
        if !self.valid() {
            return Err(RuntimeError::Forbidden);
        }
        self.backend.screenshot(selector, timeout)
    }
    fn screenshot_full_page(
        &self,
        timeout: Duration,
    ) -> Result<super::fullpage::FullPageShot, RuntimeError> {
        let _in_flight = self.begin();
        if !self.valid() {
            return Err(RuntimeError::Forbidden);
        }
        self.backend.screenshot_full_page(timeout)
    }
    fn logs(&self, limit: usize, since: Option<i64>) -> Vec<LogEntry> {
        let _in_flight = self.begin();
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
    fn shutdown_keep_profile(&self) {
        self.active.store(false, Ordering::SeqCst);
        if !self.terminated.swap(true, Ordering::SeqCst) {
            self.backend.shutdown_keep_profile();
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
        idle_timeout: Arc<AtomicU64>,
    ) -> Arc<Self> {
        let runtime = Arc::new(Self {
            space_id,
            server_url,
            factory,
            policy,
            users,
            enabled,
            idle_timeout,
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
                    let timeout = runtime.idle_timeout.load(Ordering::SeqCst);
                    if timeout == 0 {
                        continue;
                    }
                    let timeout = Duration::from_secs(timeout);
                    let idle = runtime.idle_entries(timeout);
                    if !idle.is_empty() {
                        tokio::task::spawn_blocking(move || {
                            for entry in idle {
                                runtime.stop_if_idle(&entry, timeout);
                            }
                        });
                    }
                }
            });
        }
        runtime
    }

    fn idle_entries(&self, timeout: Duration) -> Vec<Arc<RuntimeLease>> {
        self.entries
            .lock()
            .unwrap()
            .values()
            .filter(|entry| entry.idle_for(timeout))
            .cloned()
            .collect()
    }

    /// Stops `entry` like the administrator's Stop, keeping its profile, if it
    /// is still the current lease and still idle once no request can start on
    /// it: `for_actor` marks a lease used under the same operation lock.
    fn stop_if_idle(&self, entry: &Arc<RuntimeLease>, timeout: Duration) -> bool {
        let _operation = entry.operation.lock().unwrap();
        {
            let entries = self.entries.lock().unwrap();
            if !entries
                .get(&entry.username)
                .is_some_and(|current| Arc::ptr_eq(current, entry))
                || !entry.idle_for(timeout)
            {
                return false;
            }
            entry.active.store(false, Ordering::SeqCst);
        }
        match entry.backend.stop(true) {
            Ok(()) => {
                tracing::info!(
                    space_id = self.space_id.as_str(),
                    user = entry.username.as_deref().unwrap_or("-"),
                    "stopped runtime after {} idle minutes",
                    timeout.as_secs() / 60
                );
                true
            }
            Err(error) => {
                // A failed stop cannot be resumed; unlike the administrator's
                // Stop nobody is watching to press Reset, so drop the lease and
                // let the next request start a fresh one on the same profile.
                tracing::warn!(
                    space_id = self.space_id.as_str(),
                    "could not stop idle runtime, shutting it down: {error}"
                );
                {
                    let mut entries = self.entries.lock().unwrap();
                    if entries
                        .get(&entry.username)
                        .is_some_and(|current| Arc::ptr_eq(current, entry))
                    {
                        entries.remove(&entry.username);
                    }
                }
                entry.shutdown_keep_profile();
                false
            }
        }
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
                    entry.touch();
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
                        username: actor.username.as_deref(),
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
                last_used: Mutex::new(Instant::now()),
                in_flight: AtomicUsize::new(0),
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
    fn enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
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
    /// Server shutdown or instance rebuild: profiles stay for the next start.
    fn shutdown(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        for entry in self.entries.lock().unwrap().drain().map(|(_, entry)| entry) {
            entry.shutdown_keep_profile();
        }
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
        fail_stop: AtomicBool,
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
        fn shutdown_keep_profile(&self) {
            self.stopped.store(true, Ordering::SeqCst);
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
            if self.fail_stop.load(Ordering::SeqCst) {
                return Err(RuntimeError::Transport("browser still in use".into()));
            }
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
                fail_stop: AtomicBool::new(false),
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
                    fail_stop: AtomicBool::new(false),
                }))
            }),
            Arc::new(AuthorizedPolicy),
            None,
            enabled,
            Arc::new(AtomicU64::new(0)),
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
    fn idle_runtime_stops_keeping_its_profile_and_resumes_on_next_request() {
        let runtime = runtime(Arc::new(AtomicBool::new(true)));
        let lease = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        let hour = Duration::from_secs(3600);
        assert!(runtime.idle_entries(hour).is_empty());
        let idle = runtime.idle_entries(Duration::ZERO);
        assert_eq!(idle.len(), 1);
        assert!(runtime.stop_if_idle(&idle[0], Duration::ZERO));
        assert_eq!(runtime.runtime_instances()[0].snapshot.status, "stopped");
        assert!(runtime.idle_entries(Duration::ZERO).is_empty());
        assert!(lease.eval_global("f", "", Duration::ZERO).is_err());
        let resumed = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        assert_eq!(
            resumed.eval_global("f", "", Duration::ZERO).unwrap(),
            serde_json::json!(0),
            "the next request resumes on the retained profile"
        );
        assert_eq!(runtime.runtime_instances()[0].snapshot.status, "running");
    }

    #[test]
    fn idle_stop_spares_a_runtime_in_use_or_used_since() {
        let runtime = runtime(Arc::new(AtomicBool::new(true)));
        runtime.for_actor(&actor("writer-one")).unwrap();
        let entry = runtime.entries.lock().unwrap()[&Some("writer-one".into())].clone();
        let busy = entry.begin();
        assert!(runtime.idle_entries(Duration::ZERO).is_empty());
        assert!(!runtime.stop_if_idle(&entry, Duration::ZERO));
        drop(busy);
        assert!(!runtime.stop_if_idle(&entry, Duration::from_secs(3600)));
        assert_eq!(runtime.runtime_instances()[0].snapshot.status, "running");
    }

    #[test]
    fn a_failed_idle_stop_hands_the_next_request_a_fresh_runtime() {
        let mut runtime = runtime(Arc::new(AtomicBool::new(true)));
        let next = Arc::new(AtomicUsize::new(0));
        let ids = next.clone();
        Arc::get_mut(&mut runtime).unwrap().factory = Arc::new(move |_| {
            Some(Box::new(Backend {
                id: ids.fetch_add(1, Ordering::SeqCst),
                stopped: AtomicBool::new(false),
                deleted: AtomicBool::new(false),
                fail_reset: AtomicBool::new(false),
                fail_stop: AtomicBool::new(true),
            }))
        });
        runtime.for_actor(&actor("writer-one")).unwrap();
        let entry = runtime.entries.lock().unwrap()[&Some("writer-one".into())].clone();
        assert!(!runtime.stop_if_idle(&entry, Duration::ZERO));
        assert!(runtime.runtime_instances().is_empty());
        assert!(
            entry.backend.restart("probe").is_ok(),
            "shut down keeping the profile"
        );
        let fresh = runtime.for_actor(&actor("writer-one")).unwrap().unwrap();
        assert_eq!(
            fresh.eval_global("f", "", Duration::ZERO).unwrap(),
            serde_json::json!(1)
        );
    }

    #[test]
    fn server_shutdown_keeps_profiles_and_reset_deletes_them() {
        let runtime = runtime(Arc::new(AtomicBool::new(true)));
        runtime.for_actor(&actor("writer-one")).unwrap();
        let entry = runtime.entries.lock().unwrap()[&Some("writer-one".into())].clone();
        runtime.shutdown();
        assert!(!entry.backend.ready());
        assert!(entry.backend.restart("next").is_ok(), "profile kept");

        let runtime = super::tests::runtime(Arc::new(AtomicBool::new(true)));
        runtime.for_actor(&actor("writer-one")).unwrap();
        let entry = runtime.entries.lock().unwrap()[&Some("writer-one".into())].clone();
        runtime.reset();
        assert!(entry.backend.restart("next").is_err(), "profile deleted");
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
                fail_stop: AtomicBool::new(false),
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
