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
use crate::multi::search_policy;
use crate::multi::server_config::ServerConfig;
#[cfg(test)]
use crate::multi::validate::root_prefix_conflict_warnings;
use crate::multi::validate::{
    introduced_root_prefix_conflicts_between_scopes, introduced_root_prefix_conflicts_for_primary,
    root_prefix_conflict_warnings_for_primary, validate_for_primary, FieldError,
};

mod install;
mod search_model;

#[derive(Debug)]
pub enum ApiError {
    Validation(Vec<FieldError>),
    NotFound,
    /// The request clashes with the current state (409).
    Conflict(String),
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
        // `load` reads a missing file as no spaces; the sweep must not.
        let config_exists = config_path.exists();
        let mut config = MultiConfig::load(&config_path)?;
        super::git_connection::recover(&root, &mut config)?;
        let mut server_config = ServerConfig::load(&root.join("server.json"))?;
        server_config
            .validate(&config)
            .map_err(|errors| format!("invalid server.json: {errors:?}"))?;
        // A space whose folder can't be served safely (it overlaps the data
        // folder's reserved directories, which hold every space's search index
        // and the git keys) is skipped, not fatal: it comes up errored, with
        // the reason in `/api/spaces` and on the space's own 503 page, while
        // the other spaces start. Admin changes still refuse such a folder.
        for (id, reason) in super::data_root::folder_conflicts(&root, &config) {
            tracing::error!(space_id = id.as_str(), "space {id} is skipped: {reason}");
        }
        let primary_host = server_config.primary_host();
        let errors = validate_for_primary(&config, &root, &known_users, primary_host.as_deref());
        if !errors.is_empty() {
            let msgs: Vec<String> = errors
                .iter()
                .map(|e| format!("{}: {}", e.field, e.message))
                .collect();
            return Err(format!("invalid spaces.json: {}", msgs.join("; ")));
        }
        for warning in root_prefix_conflict_warnings_for_primary(&config, primary_host.as_deref())
            .into_values()
            .collect::<BTreeSet<_>>()
        {
            tracing::warn!("{warning}");
        }
        deps.runtime_enabled.store(
            server_config.runtime_api,
            std::sync::atomic::Ordering::SeqCst,
        );
        // Before any instance opens its index (see `search_policy::boot`).
        let deps = InstanceDeps {
            search: search_policy::boot(deps.search, &server_config, &config, config_exists),
            ..deps
        };
        let instances: HashMap<String, Arc<SpaceInstance>> = config
            .spaces
            .iter()
            .map(|(id, cfg)| (id.clone(), Arc::new(build_instance(id, cfg, &deps))))
            .collect();
        publish_prefix_roots(&instances, primary_host.as_deref());
        let table = RoutingTable::build_for_primary(instances.clone(), primary_host.as_deref());
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
        let errors = validate_for_primary(&config, &root, &known_users, None);
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
        publish_prefix_roots(&instances, None);
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

    /// The server's search (its semantic model, for the admin API).
    pub fn search(&self) -> &crate::search::SpaceSearch {
        &self.deps.search
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
        let current_primary = inner.server_config.primary_host();
        let proposed_primary = config.primary_host();
        let known_users = self.known_users.read().unwrap().clone();
        let errors = validate_for_primary(
            &inner.config,
            &self.root,
            &known_users,
            proposed_primary.as_deref(),
        );
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
        let errors = introduced_root_prefix_conflicts_between_scopes(
            &inner.config,
            current_primary.as_deref(),
            &inner.config,
            proposed_primary.as_deref(),
        );
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
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
        publish_prefix_roots(&inner.instances, proposed_primary.as_deref());
        self.registry.swap(RoutingTable::build_for_primary(
            inner.instances.clone(),
            proposed_primary.as_deref(),
        ));
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
        let errors = introduced_folder_conflicts(&self.root, &inner.config, &new_config);
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
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
        let primary_host = inner.server_config.primary_host();
        let errors = validate_for_primary(
            &new_config,
            &self.root,
            &known_users,
            primary_host.as_deref(),
        );
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
        let errors = introduced_root_prefix_conflicts_for_primary(
            &inner.config,
            &new_config,
            primary_host.as_deref(),
        );
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
        new_config
            .save(&self.config_path)
            .map_err(ApiError::Internal)?;
        for (id, instance) in &inner.instances {
            if new_config.spaces.get(id) != Some(&instance.config) {
                install::retire_services(instance);
            }
        }
        if let Some(id) = journal_id {
            super::git_connection::finish_change(&self.root, id).map_err(ApiError::Internal)?;
        }
        let rebuild = |id: &str, cfg: &SpaceConfig, existing: &SpaceInstance| {
            &existing.config != cfg || (journal_id == Some(id) && !preserve_sync_history)
        };
        self.install_instances(inner, &new_config, &rebuild, preserve_sync_history, retired);
        inner.config = new_config;
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
        {
            let mut retired = Retired::default();
            let mut inner = self.state.lock().unwrap();
            if !inner.config.spaces.contains_key(id) {
                return Err(ApiError::NotFound);
            }
            let mut new_config = inner.config.clone();
            new_config.spaces.remove(id);
            self.apply_locked(&mut inner, new_config, &mut retired, None, true)?;
            // The lock, then the retired instance (and its index worker), drop here.
        }
        self.remove_search_index(id);
        Ok(())
    }

    /// Removes a deleted space's indexes in the background
    /// (`SpaceSearch::remove_space`), unless a space with that id exists again.
    fn remove_search_index(&self, id: &str) {
        if !self.state.lock().unwrap().config.spaces.contains_key(id) {
            self.deps.search.remove_space(id);
        }
    }

    /// JSON view for GET /spaces: id -> { config,
    /// status: { state: "running"|"errored", reason? } }.
    pub fn list(&self) -> serde_json::Value {
        let inner = self.state.lock().unwrap();
        let mut out = serde_json::Map::new();
        let primary_host = inner.server_config.primary_host();
        let warnings =
            root_prefix_conflict_warnings_for_primary(&inner.config, primary_host.as_deref());
        for (id, inst) in &inner.instances {
            out.insert(id.clone(), space_json(inst, warnings.get(id)));
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
        inner.instances.get(id).map(|inst| {
            space_json(
                inst,
                root_prefix_conflict_warnings_for_primary(
                    &inner.config,
                    inner.server_config.primary_host().as_deref(),
                )
                .get(id),
            )
        })
    }

    /// Shallow-merge a partial body into a stored space config.
    ///
    /// The merge runs over the config's own serialization, never over
    /// `space_json`: its derived fields would be captured by the `extra` flatten
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
            if DERIVED_KEYS.contains(&k.as_str()) {
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

fn publish_prefix_roots(
    instances: &HashMap<String, Arc<SpaceInstance>>,
    primary_host: Option<&str>,
) {
    let mut scopes: HashMap<Option<String>, Vec<String>> = HashMap::new();
    for inst in instances.values() {
        let roots = scopes
            .entry(inst.config.binding.effective_host_scope(primary_host))
            .or_default();
        if !inst.prefix.is_empty() {
            roots.push(inst.prefix.clone());
        }
    }
    for roots in scopes.values_mut() {
        roots.sort();
    }
    for inst in instances.values() {
        inst.space_prefixes
            .set(scopes[&inst.config.binding.effective_host_scope(primary_host)].clone());
    }
}

/// The folder errors `new` introduces (see `data_root::folder_conflict`): a
/// new space's, or a changed folder's. A space that keeps its folder keeps
/// its conflict without an error: it was skipped at boot and stays errored
/// until its folder is fixed or it is deleted, and other changes to it (a
/// member removed with their account, a rename) or to other spaces must
/// still apply.
fn introduced_folder_conflicts(
    root: &Path,
    current: &MultiConfig,
    new: &MultiConfig,
) -> Vec<FieldError> {
    let mut introduced = super::data_root::folder_conflicts(root, new);
    introduced.retain(|id, _| !kept_folder(current.spaces.get(id), new.spaces.get(id)));
    super::data_root::folder_errors(introduced)
}

/// Whether a space present before (`old`) and after (`new`) a change keeps
/// its folder.
pub(super) fn kept_folder(old: Option<&SpaceConfig>, new: Option<&SpaceConfig>) -> bool {
    old.zip(new)
        .is_some_and(|(old, new)| old.folder == new.folder)
}

/// The keys [`space_json`] adds to a space's config: [`MultiManager::patch`]
/// ignores them.
const DERIVED_KEYS: [&str; 2] = ["status", "bindingWarning"];

fn space_json(inst: &SpaceInstance, warning: Option<&String>) -> serde_json::Value {
    let mut v = serde_json::to_value(&inst.config).unwrap_or_default();
    v["status"] = match &inst.status {
        InstanceStatus::Errored(reason) => {
            serde_json::json!({ "state": "errored", "reason": reason })
        }
        _ => serde_json::json!({ "state": "running" }),
    };
    if let Some(warning) = warning {
        v["bindingWarning"] = serde_json::json!(warning);
    }
    // Present, `null` when it follows the default (its config omits it).
    v["semanticSearch"] = serde_json::json!(inst.config.semantic_search);
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, MemberEntry, MemberRole, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use silverbullet_server_common::space::MemorySpacePrimitives;

    mod search;

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
            search: crate::search::SpaceSearch::in_memory(),
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig::test(name, binding)
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

    fn legacy_root_mix(root: &Path) -> Arc<MultiManager> {
        let config = MultiConfig {
            spaces: [
                (
                    "root".into(),
                    payload("Root", Binding::Prefix { prefix: "".into() }),
                ),
                (
                    "work".into(),
                    payload(
                        "Work",
                        Binding::Prefix {
                            prefix: "/work".into(),
                        },
                    ),
                ),
            ]
            .into_iter()
            .collect(),
        };
        config.save(&root.join("spaces.json")).unwrap();
        boot(root)
    }

    #[tokio::test]
    async fn legacy_root_mix_rejects_expansion_without_changing_disk_or_registry() {
        let dir = tempfile::tempdir().unwrap();
        let m = legacy_root_mix(dir.path());
        let warning = "Root and prefixed bindings share the default hostname: \"Root\" (/), \"Work\" (/work). Move these spaces to separate hostnames or remove the root binding.";
        assert_eq!(
            root_prefix_conflict_warnings(&m.state.lock().unwrap().config),
            HashMap::from([
                ("root".into(), warning.into()),
                ("work".into(), warning.into()),
            ])
        );
        let before_disk = std::fs::read(dir.path().join("spaces.json")).unwrap();
        let before_registry = m.registry().current();
        let error = m
            .create(
                payload(
                    "Wiki",
                    Binding::Prefix {
                        prefix: "/wiki".into(),
                    },
                ),
                false,
            )
            .unwrap_err();
        let ApiError::Validation(errors) = error else {
            panic!("{error:?}")
        };
        assert_eq!(errors.len(), 1);
        assert!(errors[0].field.ends_with(".binding"));
        assert_ne!(errors[0].field, "root.binding");
        assert!(errors[0].message.contains("/wiki"));
        assert!(errors[0].message.contains("Root"));
        assert_eq!(
            std::fs::read(dir.path().join("spaces.json")).unwrap(),
            before_disk
        );
        assert!(Arc::ptr_eq(&before_registry, &m.registry().current()));
        assert_eq!(m.list().as_object().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn explicit_primary_hostname_and_implicit_bindings_share_warnings_routes_and_prefixes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("server.json"),
            r#"{"primaryUrl":"https://manager.example.test"}"#,
        )
        .unwrap();
        let config = MultiConfig {
            spaces: [
                (
                    "root".into(),
                    payload(
                        "Root",
                        Binding::Host {
                            host: "Manager.Example.test.".into(),
                            prefix: String::new(),
                        },
                    ),
                ),
                (
                    "notes".into(),
                    payload(
                        "Notes",
                        Binding::Prefix {
                            prefix: "/notes".into(),
                        },
                    ),
                ),
            ]
            .into_iter()
            .collect(),
        };
        config.save(&dir.path().join("spaces.json")).unwrap();
        let m = boot(dir.path());
        let listed = m.list();
        assert!(listed["root"]["bindingWarning"].as_str().is_some());
        assert!(listed["notes"]["bindingWarning"].as_str().is_some());
        assert_eq!(
            m.instance("root").unwrap().space_prefixes.current(),
            vec!["/notes"]
        );
        assert_eq!(
            m.instance("notes").unwrap().space_prefixes.current(),
            vec!["/notes"]
        );
        assert_eq!(
            m.registry()
                .current()
                .resolve_main("manager.example.test", "/notes/x")
                .unwrap()
                .0
                .id,
            "notes"
        );
        let error = m
            .create(
                payload(
                    "Wiki",
                    Binding::Prefix {
                        prefix: "/wiki".into(),
                    },
                ),
                false,
            )
            .unwrap_err();
        assert!(matches!(error, ApiError::Validation(_)));
    }

    #[tokio::test]
    async fn changing_primary_hostname_cannot_introduce_a_cross_representation_root_mix() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        m.create(
            payload(
                "Root",
                Binding::Host {
                    host: "manager.example.test".into(),
                    prefix: String::new(),
                },
            ),
            false,
        )
        .unwrap();
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
        let error = m
            .set_primary_url("https://manager.example.test")
            .unwrap_err();
        assert!(matches!(error, ApiError::Validation(_)));
        assert_eq!(m.primary_url(), None);
    }

    #[tokio::test]
    async fn legacy_root_mix_accepts_unrelated_patches_and_conflict_removal() {
        for remove_root in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let m = legacy_root_mix(dir.path());
            m.patch(
                "work",
                serde_json::json!({"description": "Updated"})
                    .as_object()
                    .unwrap()
                    .clone(),
            )
            .unwrap();
            assert_eq!(m.get("work").unwrap()["description"], "Updated");
            m.delete(if remove_root { "root" } else { "work" }).unwrap();
            assert_eq!(m.registry().current().instances.len(), 1);
        }
        let dir = tempfile::tempdir().unwrap();
        let m = legacy_root_mix(dir.path());
        m.patch(
            "work",
            serde_json::json!({"binding": {"host": "team.example.com", "prefix": "/work"}})
                .as_object()
                .unwrap()
                .clone(),
        )
        .unwrap();
        assert_eq!(
            m.get("work").unwrap()["binding"]["host"],
            "team.example.com"
        );
        let before_disk = std::fs::read(dir.path().join("spaces.json")).unwrap();
        let before_registry = m.registry().current();
        let error = m
            .patch(
                "work",
                serde_json::json!({"binding": {"prefix": "/work"}})
                    .as_object()
                    .unwrap()
                    .clone(),
            )
            .unwrap_err();
        let ApiError::Validation(errors) = error else {
            panic!("{error:?}")
        };
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].field, "work.binding");
        assert!(errors[0].message.contains("Root"));
        assert_eq!(
            std::fs::read(dir.path().join("spaces.json")).unwrap(),
            before_disk
        );
        assert!(Arc::ptr_eq(&before_registry, &m.registry().current()));
        assert!(root_prefix_conflict_warnings(&m.state.lock().unwrap().config).is_empty());
    }

    #[tokio::test]
    async fn server_name_defaults_and_persists_without_losing_settings() {
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

    #[tokio::test]
    async fn primary_origin_persists_and_accepts_same_host_prefixed_bindings() {
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
                    prefix: "/wiki".into(),
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
                    prefix: String::new(),
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

    #[tokio::test]
    async fn primary_origin_accepts_existing_prefix_spaces() {
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

    #[tokio::test]
    async fn boots_empty_without_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert!(m.registry().current().instances.is_empty());
    }

    #[tokio::test]
    async fn a_legacy_payload_is_normalized_on_create() {
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

    #[tokio::test]
    async fn a_legacy_payload_is_normalized_on_update() {
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

    #[tokio::test]
    async fn malformed_config_fails_boot() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("spaces.json"), "{ nope").unwrap();
        assert!(
            MultiManager::boot(dir.path().to_path_buf(), deps(dir.path()), BTreeSet::new())
                .is_err()
        );
    }

    #[tokio::test]
    async fn create_defaults_folder_seeds_index_persists_and_routes() {
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

    #[tokio::test]
    async fn duplicate_prefix_is_rejected_and_not_persisted() {
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

    #[tokio::test]
    async fn update_rebinds_and_delete_removes_but_keeps_files() {
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

    #[tokio::test]
    async fn boot_in_memory_routes_without_persisting_spaces_json() {
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

    #[tokio::test]
    async fn remove_member_everywhere_sweeps_all_spaces_and_is_a_noop_when_absent() {
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
    #[tokio::test]
    async fn remove_member_everywhere_shrinks_known_users_atomically_with_sweep() {
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

    #[tokio::test]
    async fn create_with_seed_index_false_skips_index() {
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

    #[tokio::test]
    async fn patch_updates_one_field_and_preserves_the_rest() {
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

    #[tokio::test]
    async fn patch_replaces_members_wholesale() {
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

    #[tokio::test]
    async fn admin_space_json_warns_only_for_legacy_root_mix_participants() {
        let dir = tempfile::tempdir().unwrap();
        let m = legacy_root_mix(dir.path());
        let separate = m
            .create(
                payload(
                    "Separate",
                    Binding::Host {
                        host: "separate.test".into(),
                        prefix: String::new(),
                    },
                ),
                false,
            )
            .unwrap();
        for id in ["root", "work"] {
            let warning = m.get(id).unwrap()["bindingWarning"]
                .as_str()
                .unwrap()
                .to_string();
            assert!(warning.contains("Root") && warning.contains("Work"));
            assert_eq!(m.list()[id]["bindingWarning"], warning);
        }
        assert!(m.get(&separate).unwrap().get("bindingWarning").is_none());
        let visible = serde_json::to_value(m.list_accessible("fixture-admin", true)).unwrap();
        assert!(!visible.to_string().contains("bindingWarning"));
        m.delete("root").unwrap();
        assert!(m.get("work").unwrap().get("bindingWarning").is_none());
    }

    #[tokio::test]
    async fn patch_ignores_derived_keys_and_does_not_persist_them() {
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
        body.insert(
            "bindingWarning".into(),
            serde_json::json!("Advisory warning"),
        );
        m.patch(&id, body).unwrap();

        let raw = std::fs::read_to_string(dir.path().join("spaces.json")).unwrap();
        assert!(!raw.contains("\"status\""), "derived key persisted: {raw}");
        assert!(
            !raw.contains("bindingWarning"),
            "derived key persisted: {raw}"
        );
    }

    #[tokio::test]
    async fn patch_with_an_empty_body_is_a_no_op() {
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

    #[tokio::test]
    async fn patch_and_get_reject_an_unknown_id() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert!(m.get("nope").is_none());
        assert!(matches!(
            m.patch("nope", serde_json::Map::new()),
            Err(ApiError::NotFound)
        ));
    }

    #[tokio::test]
    async fn patch_legacy_public_key_locks_down_a_write_space() {
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

    #[tokio::test]
    async fn patch_with_explicit_access_still_works() {
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

    #[tokio::test]
    async fn visible_space_omits_sensitive_config() {
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

    #[tokio::test]
    async fn list_accessible_visibility_is_unchanged() {
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

    #[tokio::test]
    async fn list_accessible_is_sorted_by_name() {
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

    #[tokio::test]
    async fn a_read_public_space_is_listed_for_every_account() {
        let (_dir, manager) = manager_with_private_and_public();
        let names: Vec<_> = manager
            .list_accessible("sam", false)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, vec!["Public Wiki".to_string()]);
    }

    #[tokio::test]
    async fn the_listing_reports_the_access_level() {
        let (_dir, manager) = manager_with_private_and_public();
        let listed = manager.list_accessible("zef", false);
        let wiki = listed.iter().find(|s| s.name == "Public Wiki").unwrap();
        assert_eq!(wiki.access, SpaceAccess::Read);
        let private = listed.iter().find(|s| s.name == "Work").unwrap();
        assert_eq!(private.access, SpaceAccess::None);
    }

    #[tokio::test]
    async fn a_read_role_member_can_see_the_space() {
        let (_dir, manager) = manager_with_read_role_member();
        assert_eq!(manager.list_accessible("sam", false).len(), 1);
    }
}
