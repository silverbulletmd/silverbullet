//! The multi-space orchestrator: owns the persisted `MultiConfig`, the built
//! instances, and the swap-on-change lifecycle. Every mutation follows one
//! path: validate -> persist (atomic) -> rebuild changed instances -> swap the
//! routing table.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use crate::multi::config::{Binding, MultiConfig, SpaceAccess, SpaceConfig};
use crate::multi::instance::{
    build_instance, resolve_folder, seed_index, InstanceDeps, InstanceStatus, SpaceInstance,
};
use crate::multi::registry::{Registry, RoutingTable};
use crate::multi::server_config::ServerConfig;
use crate::multi::validate::{validate, FieldError};

#[derive(Debug)]
pub enum ApiError {
    Validation(Vec<FieldError>),
    NotFound,
    Internal(String),
}

/// What an ordinary account is allowed to learn about a space it can open.
///
/// Deliberately an allowlist, not a redaction of `SpaceConfig`: that type
/// carries `#[serde(flatten)] extra`, so a denylist would expose every field
/// added later by default. Adding a field here is a conscious edit.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleSpace {
    pub id: String,
    pub name: String,
    pub binding: Binding,
    pub access: SpaceAccess,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntime {
    pub space_name: String,
    #[serde(flatten)]
    pub instance: crate::runtime::RuntimeInstance,
}

pub struct MultiManager {
    root: PathBuf,
    pub(super) git_connections: Mutex<()>,
    config_path: PathBuf,
    deps: InstanceDeps,
    /// Current persisted config + built instances, mutated under one lock so
    /// concurrent admin calls serialize.
    state: Mutex<Inner>,
    registry: Registry,
    /// Usernames that `members` entries are validated against. Set at boot
    /// and refreshable via `set_known_users` as accounts are added/removed.
    known_users: RwLock<BTreeSet<String>>,
}

struct Inner {
    server_config: ServerConfig,
    config: MultiConfig,
    instances: HashMap<String, Arc<SpaceInstance>>,
}

/// What a config change takes out of service. Dropping a `SpaceInstance`
/// drops its `RevisionEngine`, whose `Drop` joins the history thread -- and
/// that thread may be inside a `git fetch`/`git push`, bounded by the
/// transfer rather than by `ConnectTimeout`. Doing that under `state`'s lock
/// stalls every admin call on an unrelated space's network round trip, so
/// each mutation declares this *before* taking the lock: locals drop in
/// reverse declaration order, which puts this drop after the guard's.
#[derive(Default)]
struct Retired {
    instances: Vec<Arc<SpaceInstance>>,
    table: Option<Arc<RoutingTable>>,
}

impl Drop for MultiManager {
    fn drop(&mut self) {
        self.shutdown_runtimes();
    }
}

impl MultiManager {
    /// Load spaces.json (hard error when malformed), build all instances, and
    /// return the manager. `known_users` seeds member validation; refresh it
    /// later via `set_known_users` as accounts change.
    pub fn boot(
        root: PathBuf,
        deps: InstanceDeps,
        known_users: BTreeSet<String>,
    ) -> Result<Arc<Self>, String> {
        let config_path = root.join("spaces.json");
        let mut config = MultiConfig::load(&config_path)?;
        super::git_connection::recover(&root, &mut config)?;
        let mut server_config = ServerConfig::load(&root.join("server.json"))?;
        server_config
            .validate(&config)
            .map_err(|errors| format!("invalid server.json: {errors:?}"))?;
        server_config
            .validate_paths(&root, &config)
            .map_err(|errors| format!("invalid space folders: {errors:?}"))?;
        let errors = validate(&config, &root, &known_users);
        if !errors.is_empty() {
            let msgs: Vec<String> = errors
                .iter()
                .map(|e| format!("{}: {}", e.field, e.message))
                .collect();
            return Err(format!("invalid spaces.json: {}", msgs.join("; ")));
        }
        deps.runtime_enabled.store(
            server_config.runtime_api,
            std::sync::atomic::Ordering::SeqCst,
        );
        let instances: HashMap<String, Arc<SpaceInstance>> = config
            .spaces
            .iter()
            .map(|(id, cfg)| (id.clone(), Arc::new(build_instance(id, cfg, &deps))))
            .collect();
        deps.space_prefixes.set(prefix_roots(&instances));
        let table = RoutingTable::build(instances.clone());
        Ok(Arc::new(Self {
            root,
            git_connections: Mutex::new(()),
            config_path,
            deps,
            state: Mutex::new(Inner {
                server_config,
                config,
                instances,
            }),
            registry: Registry::new(table),
            known_users: RwLock::new(known_users),
        }))
    }

    /// Boot from an already-constructed, in-memory `MultiConfig` that is never
    /// read from or written to disk. Single-space mode uses this: it
    /// synthesizes exactly one space from the environment and serves it on the
    /// multi engine. Validation runs against an empty user set (single-space
    /// synthesis never uses the accounts `members` model), and because the
    /// admin API is not mounted in single mode there is no mutation path — so
    /// `spaces.json` is neither loaded nor saved.
    pub fn boot_in_memory(
        root: PathBuf,
        config: MultiConfig,
        deps: InstanceDeps,
    ) -> Result<Arc<Self>, String> {
        let config_path = root.join("spaces.json");
        let known_users = BTreeSet::new();
        let errors = validate(&config, &root, &known_users);
        if !errors.is_empty() {
            let msgs: Vec<String> = errors
                .iter()
                .map(|e| format!("{}: {}", e.field, e.message))
                .collect();
            return Err(format!("invalid synthesized config: {}", msgs.join("; ")));
        }
        let instances: HashMap<String, Arc<SpaceInstance>> = config
            .spaces
            .iter()
            .map(|(id, cfg)| (id.clone(), Arc::new(build_instance(id, cfg, &deps))))
            .collect();
        deps.space_prefixes.set(prefix_roots(&instances));
        let table = RoutingTable::build(instances.clone());
        Ok(Arc::new(Self {
            root,
            git_connections: Mutex::new(()),
            config_path,
            deps,
            state: Mutex::new(Inner {
                server_config: ServerConfig::default(),
                config,
                instances,
            }),
            registry: Registry::new(table),
            known_users: RwLock::new(known_users),
        }))
    }

    pub fn primary_url(&self) -> Option<String> {
        self.state.lock().unwrap().server_config.primary_url.clone()
    }

    pub fn runtime_enabled(&self) -> bool {
        self.deps
            .runtime_enabled
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn server_name(&self) -> String {
        self.state.lock().unwrap().server_config.server_name.clone()
    }

    pub fn set_primary_url(&self, value: &str) -> Result<(), ApiError> {
        self.set_server_config(Some(value), None, None)
    }

    pub fn set_server_config(
        &self,
        primary_url: Option<&str>,
        server_name: Option<&str>,
        runtime_api: Option<bool>,
    ) -> Result<(), ApiError> {
        let mut inner = self.state.lock().unwrap();
        let mut config = inner.server_config.clone();
        if let Some(value) = primary_url {
            config.primary_url = Some(value.into());
        }
        if let Some(value) = server_name {
            config.server_name = value.into();
        }
        if let Some(value) = runtime_api {
            config.runtime_api = value;
        }
        config
            .validate(&inner.config)
            .map_err(ApiError::Validation)?;
        config
            .validate_paths(&self.root, &inner.config)
            .map_err(ApiError::Validation)?;
        config
            .save(&self.root.join("server.json"))
            .map_err(ApiError::Internal)?;
        self.deps
            .runtime_enabled
            .store(config.runtime_api, std::sync::atomic::Ordering::SeqCst);
        if !config.runtime_api {
            for instance in inner.instances.values() {
                if let Some(runtime) = &instance.runtime {
                    runtime.reset();
                }
            }
        }
        inner.server_config = config;
        Ok(())
    }

    pub fn runtime_instances(&self) -> Vec<ManagedRuntime> {
        let runtimes: Vec<_> = self
            .state
            .lock()
            .unwrap()
            .instances
            .values()
            .filter_map(|instance| Some((instance.config.name.clone(), instance.runtime.clone()?)))
            .collect();
        let mut instances: Vec<_> = runtimes
            .into_iter()
            .flat_map(|(space_name, runtime)| {
                runtime
                    .runtime_instances()
                    .into_iter()
                    .map(move |instance| ManagedRuntime {
                        space_name: space_name.clone(),
                        instance,
                    })
            })
            .collect();
        instances.sort_by(|a, b| {
            (&a.space_name, &a.instance.space_id, &a.instance.username).cmp(&(
                &b.space_name,
                &b.instance.space_id,
                &b.instance.username,
            ))
        });
        instances
    }

    pub fn manage_runtime(
        &self,
        id: &str,
        reset: bool,
    ) -> Result<bool, crate::runtime::RuntimeError> {
        let runtimes: Vec<_> = self
            .state
            .lock()
            .unwrap()
            .instances
            .values()
            .filter_map(|instance| instance.runtime.clone())
            .collect();
        for runtime in runtimes {
            if runtime.manage_runtime(id, reset)? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn revoke_user_runtime(&self, username: &str) {
        for instance in self.state.lock().unwrap().instances.values() {
            if let Some(runtime) = &instance.runtime {
                runtime.revoke_user(username);
            }
        }
    }

    pub fn shutdown_runtimes(&self) {
        for instance in self.state.lock().unwrap().instances.values() {
            if let Some(runtime) = &instance.runtime {
                runtime.shutdown();
            }
        }
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The live built instance for `id`, if any — the admin git-sync routes
    /// use this to reach a running space's `RevisionEngine` and resolved
    /// folder, since they are not nested inside that space's own router.
    pub fn instance(&self, id: &str) -> Option<Arc<SpaceInstance>> {
        self.state.lock().unwrap().instances.get(id).cloned()
    }

    /// Replace the set of usernames `members` entries are validated against.
    pub fn set_known_users(&self, users: BTreeSet<String>) {
        *self.known_users.write().unwrap() = users;
    }

    /// Remove `username` from every space's `members` map (e.g. after the
    /// account is deleted, so the membership doesn't linger and point at a
    /// nonexistent user) and, atomically with that sweep, replace
    /// `known_users` with `new_known_users` (normally the store's usernames
    /// *after* the deletion). Both happen while `state`'s lock is held, so no
    /// concurrent `create`/`update`/`set_password` call — each of which reads
    /// `known_users` inside `apply_locked` while also holding `state`'s lock —
    /// can observe a moment where `known_users` has shrunk but a space still
    /// references the deleted user, or vice versa. That was the actual race:
    /// with the sweep and the `known_users` update as two separate critical
    /// sections, a create/update landing between them could validate against
    /// the stale (still-containing-the-deleted-user) `known_users` and
    /// persist a fresh `members` entry for an account that no longer exists —
    /// which then hard-fails the *next* boot, since boot validates against
    /// the current, already-shrunk usernames.
    ///
    /// `known_users` is written first (still a no-op on disk/instances until
    /// `apply_locked` runs below), then the sweep computes whether any space
    /// actually referenced `username`; if none did, this returns early with
    /// `known_users` already updated and no persist/rebuild — still race-free
    /// as a no-op relative to unrelated mutations, which serialize behind the
    /// same lock. Note this acquires `known_users`'s write lock while holding
    /// `state`'s lock — the same nesting order `apply_locked` already uses
    /// when it read-locks `known_users`, so this introduces no lock-order
    /// inversion.
    pub fn remove_member_everywhere(
        &self,
        username: &str,
        new_known_users: BTreeSet<String>,
    ) -> Result<(), ApiError> {
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        *self.known_users.write().unwrap() = new_known_users;
        let mut new_config = inner.config.clone();
        let mut changed = false;
        for space in new_config.spaces.values_mut() {
            if space.members.remove(username).is_some() {
                changed = true;
            }
        }
        if !changed {
            return Ok(());
        }
        self.apply_locked(&mut inner, new_config, &mut retired, None, true)
    }

    /// Validate + persist + rebuild + swap. Called with the state lock held by
    /// the CRUD methods (single mutation path). On validation or persist
    /// failure, `inner` is left completely untouched.
    fn apply_locked(
        &self,
        inner: &mut Inner,
        mut new_config: MultiConfig,
        retired: &mut Retired,
        journal_id: Option<&str>,
        preserve_sync_history: bool,
    ) -> Result<(), ApiError> {
        inner
            .server_config
            .clone()
            .validate(&new_config)
            .map_err(ApiError::Validation)?;
        inner
            .server_config
            .validate_paths(&self.root, &new_config)
            .map_err(ApiError::Validation)?;
        for (id, config) in &mut new_config.spaces {
            if let Some(previous) = inner.config.spaces.get(id) {
                for (name, entry) in &mut config.members {
                    if !entry.runtime_api_explicit
                        && previous
                            .members
                            .get(name)
                            .is_some_and(|old| !old.runtime_api)
                    {
                        entry.runtime_api = false;
                    }
                    entry.runtime_api_explicit = true;
                    if entry.role == super::config::MemberRole::Read
                        && previous
                            .members
                            .get(name)
                            .is_some_and(|old| old.role == super::config::MemberRole::Write)
                    {
                        entry.runtime_api = false;
                    }
                }
            }
        }
        let known_users = self.known_users.read().unwrap().clone();
        let errors = validate(&new_config, &self.root, &known_users);
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
        new_config
            .save(&self.config_path)
            .map_err(ApiError::Internal)?;
        for (id, instance) in &inner.instances {
            if new_config.spaces.get(id) != Some(&instance.config) {
                if let Some(runtime) = &instance.runtime {
                    runtime.shutdown();
                }
                if let Some(engine) = &instance.revisions {
                    engine.quiesce_sync();
                }
            }
        }
        if let Some(id) = journal_id {
            super::git_connection::finish_change(&self.root, id).map_err(ApiError::Internal)?;
        }
        let mut instances = HashMap::new();
        for (id, cfg) in &new_config.spaces {
            match inner.instances.get(id) {
                Some(existing)
                    if &existing.config == cfg
                        && (journal_id != Some(id.as_str()) || preserve_sync_history) =>
                {
                    instances.insert(id.clone(), existing.clone());
                }
                _ => {
                    let instance = Arc::new(build_instance(id, cfg, &self.deps));
                    if let Some(previous) = inner.instances.get(id) {
                        let mut old_policy = previous.config.git_sync();
                        old_policy.paused = false;
                        let mut new_policy = cfg.git_sync();
                        new_policy.paused = false;
                        if preserve_sync_history
                            && old_policy == new_policy
                            && previous.config.folder == cfg.folder
                        {
                            if let (Some(current), Some(old)) =
                                (&instance.revisions, &previous.revisions)
                            {
                                current.inherit_sync_history(old);
                            }
                        }
                    }
                    instances.insert(id.clone(), instance);
                }
            }
        }
        self.deps.space_prefixes.set(prefix_roots(&instances));
        retired.table = Some(self.registry.swap(RoutingTable::build(instances.clone())));
        inner.config = new_config;
        let previous = std::mem::replace(&mut inner.instances, instances);
        retired.instances.extend(previous.into_values());
        Ok(())
    }

    pub(super) fn change_git(
        &self,
        id: &str,
        preserve_sync_history: bool,
        change: impl FnOnce(&SpaceInstance, &mut SpaceConfig) -> Result<(), String>,
    ) -> Result<(), ApiError> {
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        let instance = inner.instances.get(id).cloned().ok_or(ApiError::NotFound)?;
        let repo = super::admin_api::syncable_repo(&instance)
            .ok_or_else(|| ApiError::Internal("this space cannot sync".into()))?;
        if instance.config.read_only {
            return Err(ApiError::Internal("this space is read only".into()));
        }
        if let Some(engine) = &instance.revisions {
            engine.quiesce_sync();
        }
        let mut new_config = inner.config.clone();
        let result = (|| {
            super::git_connection::begin_change(
                &self.root,
                id,
                &repo,
                instance.config.git_sync.clone(),
            )
            .map_err(ApiError::Internal)?;
            change(&instance, new_config.spaces.get_mut(id).unwrap())
                .map_err(ApiError::Internal)?;
            super::git_connection::sync_git_config(&repo).map_err(ApiError::Internal)?;
            self.apply_locked(
                &mut inner,
                new_config,
                &mut retired,
                Some(id),
                preserve_sync_history,
            )
        })();
        if result.is_err() {
            super::git_connection::recover(&self.root, &mut inner.config)
                .map_err(ApiError::Internal)?;
            if let Some(engine) = &instance.revisions {
                engine.set_sync_paused(instance.config.git_sync().paused);
            }
        } else if let Some(current) = inner.instances.get(id) {
            if let Some(engine) = &current.revisions {
                engine.set_sync_paused(current.config.git_sync().paused);
            }
        }
        result
    }

    pub fn create(&self, mut cfg: SpaceConfig, should_seed: bool) -> Result<String, ApiError> {
        cfg.normalize();
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        if cfg.folder.is_empty() {
            cfg.folder = format!("spaces/{id}");
        }
        let folder = resolve_folder(&self.root, &id, &cfg.folder);
        std::fs::create_dir_all(&folder).map_err(|e| {
            ApiError::Validation(vec![FieldError {
                field: "folder".into(),
                message: format!("could not create folder {}: {e}", folder.display()),
            }])
        })?;
        let mut new_config = inner.config.clone();
        new_config.spaces.insert(id.clone(), cfg.clone());
        self.apply_locked(&mut inner, new_config, &mut retired, None, true)?;
        if should_seed {
            seed_index(
                &folder,
                &cfg.index_page,
                &self.deps.index_template,
                &cfg.space_ignore,
            );
        }
        Ok(id)
    }

    pub fn update(&self, id: &str, mut cfg: SpaceConfig) -> Result<(), ApiError> {
        cfg.normalize();
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        if !inner.config.spaces.contains_key(id) {
            return Err(ApiError::NotFound);
        }
        cfg.git_sync = inner
            .config
            .spaces
            .get(id)
            .and_then(|space| space.git_sync.clone());
        let mut new_config = inner.config.clone();
        new_config.spaces.insert(id.to_string(), cfg);
        self.apply_locked(&mut inner, new_config, &mut retired, None, true)
    }

    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        if !inner.config.spaces.contains_key(id) {
            return Err(ApiError::NotFound);
        }
        let mut new_config = inner.config.clone();
        new_config.spaces.remove(id);
        self.apply_locked(&mut inner, new_config, &mut retired, None, true)
    }

    /// JSON view for GET /spaces: id -> { config,
    /// status: { state: "running"|"errored", reason? } }.
    pub fn list(&self) -> serde_json::Value {
        let inner = self.state.lock().unwrap();
        let mut out = serde_json::Map::new();
        for (id, inst) in &inner.instances {
            out.insert(id.clone(), space_json(&inst.config, &inst.status));
        }
        serde_json::Value::Object(out)
    }

    /// User-facing space list. Administrators can reach every space; ordinary
    /// accounts see public spaces and spaces that explicitly list them as a
    /// member. Computed from the live config on every request so access
    /// changes take effect immediately.
    ///
    /// Returns `VisibleSpace`, not the stored config — see that type.
    pub fn list_accessible(&self, username: &str, admin: bool) -> Vec<VisibleSpace> {
        let inner = self.state.lock().unwrap();
        let mut out: Vec<VisibleSpace> = inner
            .instances
            .iter()
            .filter(|(_, inst)| {
                admin
                    || inst.config.access() != SpaceAccess::None
                    || inst.config.members.contains_key(username)
            })
            .map(|(id, inst)| VisibleSpace {
                id: id.clone(),
                name: inst.config.name.clone(),
                binding: inst.config.binding.clone(),
                access: inst.config.access(),
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// JSON view for GET /spaces/{id}; `None` when there is no such space.
    pub fn get(&self, id: &str) -> Option<serde_json::Value> {
        let inner = self.state.lock().unwrap();
        inner
            .instances
            .get(id)
            .map(|inst| space_json(&inst.config, &inst.status))
    }

    /// Shallow-merge a partial body into a stored space config.
    ///
    /// The merge runs over the config's own serialization, never over
    /// `space_json`: the latter carries `status`, which is
    /// not `SpaceConfig` fields and would be captured by the `extra` flatten
    /// and written verbatim into spaces.json.
    ///
    /// A present top-level key replaces that field entirely — `members` in the
    /// body is the complete new membership map, not a delta.
    pub fn patch(
        &self,
        id: &str,
        patch: serde_json::Map<String, serde_json::Value>,
    ) -> Result<(), ApiError> {
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        let Some(existing) = inner.config.spaces.get(id).cloned() else {
            return Err(ApiError::NotFound);
        };
        // A legacy `public` key without an accompanying `access` must still
        // take effect: the base config's own `access` (every stored config
        // is normalized, so it always has one) would otherwise always win
        // and the legacy key would silently do nothing.
        let legacy_public_without_access =
            patch.contains_key("public") && !patch.contains_key("access");
        let mut merged =
            serde_json::to_value(&existing).map_err(|e| ApiError::Internal(e.to_string()))?;
        let obj = merged
            .as_object_mut()
            .ok_or_else(|| ApiError::Internal("space config is not a JSON object".into()))?;
        for (k, v) in patch {
            // Derived keys the API emits itself: ignore rather than reject, so
            // a GET -> edit -> PATCH round-trip works without the caller
            // having to strip what the server just handed it.
            if k == "status" {
                continue;
            }
            obj.insert(k, v);
        }
        if legacy_public_without_access {
            obj.remove("access");
        }
        let mut cfg: SpaceConfig = serde_json::from_value(merged).map_err(|e| {
            ApiError::Validation(vec![FieldError {
                field: String::new(),
                message: e.to_string(),
            }])
        })?;
        cfg.git_sync = existing.git_sync.clone();
        cfg.normalize();
        let mut new_config = inner.config.clone();
        new_config.spaces.insert(id.to_string(), cfg);
        self.apply_locked(&mut inner, new_config, &mut retired, None, true)
    }
}

/// Every space's non-empty prefix root, sorted. Host bindings (prefix `""`)
/// and a root-bound space's own `""` are excluded: neither can be shadowed by
/// another space's origin-scoped service worker.
fn prefix_roots(instances: &HashMap<String, Arc<SpaceInstance>>) -> Vec<String> {
    let mut roots: Vec<String> = instances
        .values()
        .map(|inst| inst.prefix.clone())
        .filter(|prefix| !prefix.is_empty())
        .collect();
    roots.sort();
    roots
}

/// Per-space JSON view shared by `list` and `get`: the config, plus the
/// live `status`. The derived key is not a
/// `SpaceConfig` field — which is exactly why `patch` merges over the
/// config's own serialization and not over this.
fn space_json(config: &SpaceConfig, status: &InstanceStatus) -> serde_json::Value {
    let mut v = serde_json::to_value(config).unwrap_or_default();
    v["status"] = match status {
        InstanceStatus::Errored(reason) => {
            serde_json::json!({ "state": "errored", "reason": reason })
        }
        _ => serde_json::json!({ "state": "running" }),
    };
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, MemberEntry, MemberRole, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use silverbullet_server_common::space::MemorySpacePrimitives;

    fn deps(root: &std::path::Path) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime_enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            runtime: Arc::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Single(Some(
                crate::auth::AuthConfig::try_parse(Some("admin:pw"), None, None, None, None)
                    .unwrap()
                    .unwrap(),
            )),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            shell_disabled: false,
            index_template: "# Test space\n".into(),
            shutdown: None,
            space_prefixes: Default::default(),
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            access: Some(SpaceAccess::Write),
            legacy_public: None,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            git_sync: None,
            revisions_commit: None,
            extra: Default::default(),
        }
    }

    fn boot(root: &std::path::Path) -> std::sync::Arc<MultiManager> {
        MultiManager::boot(root.to_path_buf(), deps(root), BTreeSet::new()).unwrap()
    }

    fn boot_with_users(root: &std::path::Path, users: &[&str]) -> std::sync::Arc<MultiManager> {
        MultiManager::boot(
            root.to_path_buf(),
            deps(root),
            users.iter().map(|u| u.to_string()).collect(),
        )
        .unwrap()
    }

    #[test]
    fn server_name_defaults_and_persists_without_losing_settings() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert_eq!(m.server_name(), "SilverBullet");
        drop(m);
        std::fs::write(
            dir.path().join("server.json"),
            r#"{"primaryUrl":"https://manager.example.test","future":true}"#,
        )
        .unwrap();
        let m = boot(dir.path());
        m.set_server_config(None, Some("  Notebook Server  "), None)
            .unwrap();
        assert_eq!(m.server_name(), "Notebook Server");
        m.set_primary_url("https://other.example.test").unwrap();
        assert_eq!(m.server_name(), "Notebook Server");
        assert!(m.set_server_config(None, Some("  "), None).is_err());
        assert!(m
            .set_server_config(None, Some(&"x".repeat(101)), None)
            .is_err());
        drop(m);
        let m = boot(dir.path());
        assert_eq!(m.server_name(), "Notebook Server");
        assert_eq!(
            m.primary_url().as_deref(),
            Some("https://other.example.test")
        );
        let persisted = ServerConfig::load(&dir.path().join("server.json")).unwrap();
        assert_eq!(persisted.extra["future"], true);
    }

    #[test]
    fn primary_origin_persists_and_accepts_same_host_bindings() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert_eq!(m.primary_url(), None);
        m.set_primary_url("https://Manager.Example.test/").unwrap();
        assert_eq!(
            m.primary_url().as_deref(),
            Some("https://manager.example.test")
        );
        assert!(m
            .create(
                payload(
                    "Notes",
                    Binding::Prefix {
                        prefix: "/notes".into()
                    }
                ),
                false
            )
            .is_ok());
        m.create(
            payload(
                "Notes",
                Binding::Host {
                    host: "manager.example.test".into(),
                },
            ),
            false,
        )
        .unwrap();
        m.create(
            payload(
                "Notes",
                Binding::Host {
                    host: "notes.example.test".into(),
                },
            ),
            false,
        )
        .unwrap();
        drop(m);
        assert_eq!(
            boot(dir.path()).primary_url().as_deref(),
            Some("https://manager.example.test")
        );
    }

    #[test]
    fn primary_origin_accepts_existing_prefix_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        m.create(
            payload(
                "Notes",
                Binding::Prefix {
                    prefix: "/notes".into(),
                },
            ),
            false,
        )
        .unwrap();
        m.set_primary_url("https://manager.example.test").unwrap();
        assert!(dir.path().join("server.json").exists());
    }

    #[test]
    fn boots_empty_without_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert!(m.registry().current().instances.is_empty());
    }

    #[test]
    fn a_legacy_payload_is_normalized_on_create() {
        let dir = tempfile::tempdir().unwrap();
        let manager = boot(dir.path());
        let cfg: SpaceConfig = serde_json::from_str(
            r#"{"name":"W","folder":"w","binding":{"prefix":"/w"},"public":true}"#,
        )
        .unwrap();
        let id = manager.create(cfg, false).unwrap();
        let stored = manager.get(&id).unwrap();
        assert_eq!(stored["access"], serde_json::json!("write"));
        assert!(stored.get("public").is_none());
    }

    #[test]
    fn a_legacy_payload_is_normalized_on_update() {
        let dir = tempfile::tempdir().unwrap();
        let manager = boot(dir.path());
        let id = manager
            .create(
                payload(
                    "W",
                    Binding::Prefix {
                        prefix: "/w".into(),
                    },
                ),
                false,
            )
            .unwrap();
        let mut cfg: SpaceConfig =
            serde_json::from_str(r#"{"name":"W","binding":{"prefix":"/w"},"public":false}"#)
                .unwrap();
        cfg.folder = format!("spaces/{id}");
        manager.update(&id, cfg).unwrap();
        let stored = manager.get(&id).unwrap();
        assert_eq!(stored["access"], serde_json::json!("none"));
        assert!(stored.get("public").is_none());
    }

    #[test]
    fn malformed_config_fails_boot() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{ nope").unwrap();
        assert!(
            MultiManager::boot(dir.path().to_path_buf(), deps(dir.path()), BTreeSet::new())
                .is_err()
        );
    }

    #[test]
    fn create_defaults_folder_seeds_index_persists_and_routes() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
                true,
            )
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("spaces").join(&id).join("index.md")).unwrap(),
            "# Test space\n"
        );
        let (inst, prefix) = m
            .registry()
            .current()
            .resolve_main("localhost", "/work/x")
            .unwrap();
        assert_eq!(inst.id, id);
        assert_eq!(prefix, "/work");
        let cfg = crate::multi::config::MultiConfig::load(&dir.path().join("spaces.json")).unwrap();
        assert_eq!(cfg.spaces[&id].name, "Work");
    }

    #[test]
    fn duplicate_prefix_is_rejected_and_not_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        m.create(
            payload(
                "A",
                Binding::Prefix {
                    prefix: "/x".into(),
                },
            ),
            true,
        )
        .unwrap();
        let e = m
            .create(
                payload(
                    "B",
                    Binding::Prefix {
                        prefix: "/x".into(),
                    },
                ),
                true,
            )
            .unwrap_err();
        assert!(matches!(e, ApiError::Validation(_)));
        let cfg = crate::multi::config::MultiConfig::load(&dir.path().join("spaces.json")).unwrap();
        assert_eq!(cfg.spaces.len(), 1);
    }

    #[test]
    fn update_rebinds_and_delete_removes_but_keeps_files() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "A",
                    Binding::Prefix {
                        prefix: "/a".into(),
                    },
                ),
                true,
            )
            .unwrap();
        let mut cfg = payload(
            "A",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        cfg.folder = format!("spaces/{id}");
        m.update(&id, cfg).unwrap();
        assert!(m
            .registry()
            .current()
            .resolve_main("localhost", "/a/x")
            .is_none());
        assert!(m
            .registry()
            .current()
            .resolve_main("localhost", "/b/x")
            .is_some());

        m.delete(&id).unwrap();
        assert!(m.registry().current().instances.is_empty());
        assert!(
            dir.path()
                .join("spaces")
                .join(&id)
                .join("index.md")
                .exists(),
            "files kept"
        );
        assert!(matches!(m.delete(&id), Err(ApiError::NotFound)));
    }

    #[test]
    fn boot_in_memory_routes_without_persisting_spaces_json() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = payload("Solo", Binding::Prefix { prefix: "/".into() });
        cfg.folder = ".".into();
        cfg.access = Some(SpaceAccess::None);
        let mut spaces = HashMap::new();
        spaces.insert("solo".to_string(), cfg);
        let config = MultiConfig { spaces };

        let m = MultiManager::boot_in_memory(dir.path().to_path_buf(), config, deps(dir.path()))
            .unwrap();

        let (inst, prefix) = m
            .registry()
            .current()
            .resolve_main("localhost", "/whatever")
            .unwrap();
        assert_eq!(inst.id, "solo");
        assert_eq!(prefix, "");
        // spaces.json must never be created by an in-memory boot.
        assert!(
            !dir.path().join("spaces.json").exists(),
            "boot_in_memory must not persist spaces.json"
        );
    }

    #[test]
    fn remove_member_everywhere_sweeps_all_spaces_and_is_a_noop_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        m.set_known_users(["bob".to_string(), "eve".to_string()].into_iter().collect());
        let mut a = payload(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        a.members.insert("bob".into(), Default::default());
        a.members.insert("eve".into(), Default::default());
        let id_a = m.create(a, true).unwrap();
        let mut b = payload(
            "B",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        b.members.insert("eve".into(), Default::default());
        let id_b = m.create(b, true).unwrap();

        let known = ["bob".to_string(), "eve".to_string()]
            .into_iter()
            .collect::<BTreeSet<_>>();
        m.remove_member_everywhere("ghost", known.clone()).unwrap();

        let known_after_bob: BTreeSet<String> = ["eve".to_string()].into_iter().collect();
        m.remove_member_everywhere("bob", known_after_bob).unwrap();
        let cfg = crate::multi::config::MultiConfig::load(&dir.path().join("spaces.json")).unwrap();
        assert!(!cfg.spaces[&id_a].members.contains_key("bob"));
        assert!(
            cfg.spaces[&id_a].members.contains_key("eve"),
            "unrelated member untouched"
        );
        assert!(cfg.spaces[&id_b].members.contains_key("eve"));
    }

    /// Regression test for the delete-user race: once `known_users` has been
    /// shrunk atomically with the membership sweep, a subsequent config
    /// mutation that tries to reintroduce the deleted user as a member must
    /// be rejected by validation — it should never be possible to persist a
    /// `members` entry for a user `remove_member_everywhere` already erased
    /// from `known_users`.
    #[test]
    fn remove_member_everywhere_shrinks_known_users_atomically_with_sweep() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        m.set_known_users(["bob".to_string()].into_iter().collect());
        let mut a = payload(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        a.members.insert("bob".into(), Default::default());
        m.create(a, true).unwrap();

        // Simulate deleting "bob": the store's usernames no longer include
        // him, and that's exactly what's passed in as the new known-users
        // set alongside the sweep.
        m.remove_member_everywhere("bob", BTreeSet::new()).unwrap();

        // A racing create that tries to add "bob" as a member must now be
        // rejected — known_users was shrunk atomically with the sweep, not
        // as some later, separate step.
        let mut b = payload(
            "B",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        b.members.insert("bob".into(), Default::default());
        let e = m.create(b, true).unwrap_err();
        assert!(matches!(e, ApiError::Validation(_)), "{e:?}");
    }

    #[test]
    fn create_with_seed_index_false_skips_index() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "NoSeed",
                    Binding::Prefix {
                        prefix: "/ns".into(),
                    },
                ),
                false,
            )
            .unwrap();
        assert!(
            !dir.path()
                .join("spaces")
                .join(&id)
                .join("index.md")
                .exists(),
            "index.md must not be seeded when seed_index=false"
        );
    }

    #[test]
    fn patch_updates_one_field_and_preserves_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["bob"]);
        let mut cfg = payload(
            "Work",
            Binding::Prefix {
                prefix: "/work".into(),
            },
        );
        cfg.read_only = true;
        cfg.index_page = "home".into();
        cfg.members.insert("bob".into(), Default::default());
        let id = m.create(cfg, false).unwrap();

        let mut body = serde_json::Map::new();
        body.insert("name".into(), serde_json::json!("Renamed"));
        m.patch(&id, body).unwrap();

        let v = m.get(&id).unwrap();
        assert_eq!(v["name"], "Renamed");
        assert_eq!(v["readOnly"], true);
        assert_eq!(v["indexPage"], "home");
        assert_eq!(v["binding"]["prefix"], "/work");
        assert!(
            v["members"].get("bob").is_some(),
            "membership was wiped: {v}"
        );
    }

    #[test]
    fn patch_replaces_members_wholesale() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["bob", "carol"]);
        let mut cfg = payload(
            "Work",
            Binding::Prefix {
                prefix: "/work".into(),
            },
        );
        cfg.members.insert("bob".into(), Default::default());
        cfg.members.insert("carol".into(), Default::default());
        let id = m.create(cfg, false).unwrap();

        let mut body = serde_json::Map::new();
        body.insert("members".into(), serde_json::json!({ "carol": {} }));
        m.patch(&id, body).unwrap();

        let v = m.get(&id).unwrap();
        assert!(v["members"].get("carol").is_some());
        assert!(
            v["members"].get("bob").is_none(),
            "shallow merge must replace the map, not union it: {v}"
        );
    }

    #[test]
    fn patch_ignores_derived_keys_and_does_not_persist_them() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
                false,
            )
            .unwrap();

        // A naive GET -> edit -> PATCH round-trip hands back the keys the API
        // emitted itself. They must not reach the config's `extra` map.
        let mut body = serde_json::Map::new();
        body.insert("name".into(), serde_json::json!("Renamed"));
        body.insert("status".into(), serde_json::json!({ "state": "running" }));
        m.patch(&id, body).unwrap();

        let raw = std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
        assert!(!raw.contains("\"status\""), "derived key persisted: {raw}");
    }

    #[test]
    fn patch_with_an_empty_body_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
                false,
            )
            .unwrap();

        m.patch(&id, serde_json::Map::new()).unwrap();
        assert_eq!(m.get(&id).unwrap()["name"], "Work");
    }

    #[test]
    fn patch_and_get_reject_an_unknown_id() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert!(m.get("nope").is_none());
        assert!(matches!(
            m.patch("nope", serde_json::Map::new()),
            Err(ApiError::NotFound)
        ));
    }

    #[test]
    fn patch_legacy_public_key_locks_down_a_write_space() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
                false,
            )
            .unwrap();
        assert_eq!(m.get(&id).unwrap()["access"], serde_json::json!("write"));

        let mut body = serde_json::Map::new();
        body.insert("public".into(), serde_json::json!(false));
        m.patch(&id, body).unwrap();

        let v = m.get(&id).unwrap();
        assert_eq!(
            v["access"],
            serde_json::json!("none"),
            "the legacy key must actually take effect, not be a silent no-op: {v}"
        );
        assert!(v.get("public").is_none());
    }

    #[test]
    fn patch_with_explicit_access_still_works() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(
                payload(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
                false,
            )
            .unwrap();

        let mut body = serde_json::Map::new();
        body.insert("access".into(), serde_json::json!("read"));
        m.patch(&id, body).unwrap();

        assert_eq!(m.get(&id).unwrap()["access"], serde_json::json!("read"));
    }

    #[test]
    fn visible_space_omits_sensitive_config() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["bob"]);
        let mut cfg = payload(
            "Private",
            Binding::Prefix {
                prefix: "/priv".into(),
            },
        );
        cfg.access = Some(SpaceAccess::None);
        cfg.members.insert("bob".into(), Default::default());
        m.create(cfg, true).unwrap();

        let visible = m.list_accessible("bob", false);
        assert_eq!(visible.len(), 1);
        let json = serde_json::to_value(&visible[0]).unwrap();
        let obj = json.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec!["access", "binding", "id", "name"]);
        // Named explicitly so a regression names the leaked field.
        for leaked in ["folder", "members", "shell", "runtimeApi", "logPush"] {
            assert!(!obj.contains_key(leaked), "leaked `{leaked}`");
        }
    }

    #[test]
    fn list_accessible_visibility_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["bob", "carol"]);

        let mut public = payload(
            "Public",
            Binding::Prefix {
                prefix: "/pub".into(),
            },
        );
        public.access = Some(SpaceAccess::Write);
        m.create(public, true).unwrap();

        let mut bobs = payload(
            "Bobs",
            Binding::Prefix {
                prefix: "/bob".into(),
            },
        );
        bobs.access = Some(SpaceAccess::None);
        bobs.members.insert("bob".into(), Default::default());
        m.create(bobs, true).unwrap();

        let mut carols = payload(
            "Carols",
            Binding::Prefix {
                prefix: "/carol".into(),
            },
        );
        carols.access = Some(SpaceAccess::None);
        carols.members.insert("carol".into(), Default::default());
        m.create(carols, true).unwrap();

        let names = |v: Vec<VisibleSpace>| {
            let mut n: Vec<String> = v.into_iter().map(|s| s.name).collect();
            n.sort();
            n
        };
        assert_eq!(names(m.list_accessible("bob", false)), ["Bobs", "Public"]);
        assert_eq!(
            names(m.list_accessible("carol", false)),
            ["Carols", "Public"]
        );
        assert_eq!(
            names(m.list_accessible("admin", true)),
            ["Bobs", "Carols", "Public"]
        );
    }

    #[test]
    fn list_accessible_is_sorted_by_name() {
        // Six unsorted inputs reduce the chance that random HashMap order
        // accidentally satisfies the sorting assertion.
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &[]);
        for (name, prefix) in [
            ("Mike", "/m"),
            ("Zulu", "/z"),
            ("Delta", "/d"),
            ("Foxtrot", "/f"),
            ("Alpha", "/a"),
            ("Kilo", "/k"),
        ] {
            let mut cfg = payload(
                name,
                Binding::Prefix {
                    prefix: prefix.into(),
                },
            );
            cfg.access = Some(SpaceAccess::Write);
            m.create(cfg, true).unwrap();
        }
        let names: Vec<String> = m
            .list_accessible("anyone", false)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, ["Alpha", "Delta", "Foxtrot", "Kilo", "Mike", "Zulu"]);
    }

    /// One private space (member "zef" only) and one `access: read` space
    /// open to any account. Returns the `TempDir` guard alongside the
    /// manager: `boot` writes `spaces.json` under it and `create` seeds index
    /// pages and starts a live fs watcher per instance, so the directory must
    /// outlive the caller's use of the manager rather than being dropped here.
    fn manager_with_private_and_public() -> (tempfile::TempDir, std::sync::Arc<MultiManager>) {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["zef"]);

        let mut work = payload(
            "Work",
            Binding::Prefix {
                prefix: "/work".into(),
            },
        );
        work.access = Some(SpaceAccess::None);
        work.members.insert("zef".into(), Default::default());
        m.create(work, true).unwrap();

        let mut wiki = payload(
            "Public Wiki",
            Binding::Prefix {
                prefix: "/wiki".into(),
            },
        );
        wiki.access = Some(SpaceAccess::Read);
        m.create(wiki, true).unwrap();

        (dir, m)
    }

    fn manager_with_read_role_member() -> (tempfile::TempDir, std::sync::Arc<MultiManager>) {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["sam"]);

        let mut cfg = payload(
            "Team",
            Binding::Prefix {
                prefix: "/team".into(),
            },
        );
        cfg.access = Some(SpaceAccess::None);
        cfg.members.insert(
            "sam".into(),
            MemberEntry {
                role: MemberRole::Read,
                runtime_api: false,
                runtime_api_explicit: true,
                extra: Default::default(),
            },
        );
        m.create(cfg, true).unwrap();

        (dir, m)
    }

    #[test]
    fn a_read_public_space_is_listed_for_every_account() {
        let (_dir, manager) = manager_with_private_and_public();
        let names: Vec<_> = manager
            .list_accessible("sam", false)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["Public Wiki".to_string()]);
    }

    #[test]
    fn the_listing_reports_the_access_level() {
        let (_dir, manager) = manager_with_private_and_public();
        let listed = manager.list_accessible("zef", false);
        let wiki = listed.iter().find(|s| s.name == "Public Wiki").unwrap();
        assert_eq!(wiki.access, SpaceAccess::Read);
        let private = listed.iter().find(|s| s.name == "Work").unwrap();
        assert_eq!(private.access, SpaceAccess::None);
    }

    #[test]
    fn a_read_role_member_can_see_the_space() {
        let (_dir, manager) = manager_with_read_role_member();
        assert_eq!(manager.list_accessible("sam", false).len(), 1);
    }
}
