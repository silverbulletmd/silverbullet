//! The multi-space orchestrator: owns the persisted `MultiConfig`, the built
//! instances, and the swap-on-change lifecycle. Every mutation follows one
//! path: validate -> persist (atomic) -> rebuild changed instances -> swap the
//! routing table.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use crate::multi::config::{Binding, MultiConfig, SpaceConfig};
use crate::multi::instance::{
    build_instance, resolve_folder, seed_index, InstanceDeps, InstanceStatus, SpaceInstance,
};
use crate::multi::registry::{Registry, RoutingTable};
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
    pub state: SpaceState,
}

/// Coarse health, with no `reason` string: those embed server filesystem
/// paths (see the assertion in `instance.rs` that a reason contains "folder").
/// The admin API (`manager.rs`'s `list()`/`to_json`, see below) still returns
/// the reason to callers that hit it directly, but no client screen renders
/// it any more — an admin sees a red `errored` badge with no in-app path to
/// the cause. Surfacing it in the UI again would mean an admin-only fetch of
/// that admin listing, not widening `VisibleSpace`: this type must keep
/// carrying no `reason`, since ordinary accounts can see spaces they don't
/// administer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SpaceState {
    Running,
    Errored,
}

pub struct MultiManager {
    root: PathBuf,
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
    config: MultiConfig,
    instances: HashMap<String, Arc<SpaceInstance>>,
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
        let config = MultiConfig::load(&config_path)?;
        let errors = validate(&config, &root, &known_users);
        if !errors.is_empty() {
            let msgs: Vec<String> = errors
                .iter()
                .map(|e| format!("{}: {}", e.field, e.message))
                .collect();
            return Err(format!("invalid spaces.json: {}", msgs.join("; ")));
        }
        let instances: HashMap<String, Arc<SpaceInstance>> = config
            .spaces
            .iter()
            .map(|(id, cfg)| (id.clone(), Arc::new(build_instance(id, cfg, &deps))))
            .collect();
        let table = RoutingTable::build(instances.clone());
        Ok(Arc::new(Self {
            root,
            config_path,
            deps,
            state: Mutex::new(Inner { config, instances }),
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
        let table = RoutingTable::build(instances.clone());
        Ok(Arc::new(Self {
            root,
            config_path,
            deps,
            state: Mutex::new(Inner { config, instances }),
            registry: Registry::new(table),
            known_users: RwLock::new(known_users),
        }))
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn root(&self) -> &Path {
        &self.root
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
        self.apply_locked(&mut inner, new_config)
    }

    /// Validate + persist + rebuild + swap. Called with the state lock held by
    /// the CRUD methods (single mutation path). On validation or persist
    /// failure, `inner` is left completely untouched.
    fn apply_locked(&self, inner: &mut Inner, new_config: MultiConfig) -> Result<(), ApiError> {
        let known_users = self.known_users.read().unwrap().clone();
        let errors = validate(&new_config, &self.root, &known_users);
        if !errors.is_empty() {
            return Err(ApiError::Validation(errors));
        }
        new_config
            .save(&self.config_path)
            .map_err(ApiError::Internal)?;
        // Rebuild changed/new instances; reuse Arcs for untouched ones.
        let mut instances = HashMap::new();
        for (id, cfg) in &new_config.spaces {
            match inner.instances.get(id) {
                Some(existing) if &existing.config == cfg => {
                    instances.insert(id.clone(), existing.clone());
                }
                _ => {
                    instances.insert(id.clone(), Arc::new(build_instance(id, cfg, &self.deps)));
                }
            }
        }
        self.registry.swap(RoutingTable::build(instances.clone()));
        inner.config = new_config;
        inner.instances = instances;
        Ok(())
    }

    pub fn create(&self, mut cfg: SpaceConfig, should_seed: bool) -> Result<String, ApiError> {
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
        self.apply_locked(&mut inner, new_config)?;
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

    pub fn update(&self, id: &str, cfg: SpaceConfig) -> Result<(), ApiError> {
        let mut inner = self.state.lock().unwrap();
        if !inner.config.spaces.contains_key(id) {
            return Err(ApiError::NotFound);
        }
        let mut new_config = inner.config.clone();
        new_config.spaces.insert(id.to_string(), cfg);
        self.apply_locked(&mut inner, new_config)
    }

    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        let mut inner = self.state.lock().unwrap();
        if !inner.config.spaces.contains_key(id) {
            return Err(ApiError::NotFound);
        }
        let mut new_config = inner.config.clone();
        new_config.spaces.remove(id);
        self.apply_locked(&mut inner, new_config)
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
                admin || inst.config.public || inst.config.members.contains_key(username)
            })
            .map(|(id, inst)| VisibleSpace {
                id: id.clone(),
                name: inst.config.name.clone(),
                binding: inst.config.binding.clone(),
                state: match inst.status {
                    InstanceStatus::Errored(_) => SpaceState::Errored,
                    InstanceStatus::Running => SpaceState::Running,
                },
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
        let mut inner = self.state.lock().unwrap();
        let Some(existing) = inner.config.spaces.get(id).cloned() else {
            return Err(ApiError::NotFound);
        };
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
        let cfg: SpaceConfig = serde_json::from_value(merged).map_err(|e| {
            ApiError::Validation(vec![FieldError {
                field: String::new(),
                message: e.to_string(),
            }])
        })?;
        let mut new_config = inner.config.clone();
        new_config.spaces.insert(id.to_string(), cfg);
        self.apply_locked(&mut inner, new_config)
    }
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
    use crate::multi::config::{Binding, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceAuth, InstanceDeps};
    use silverbullet_server_common::space::MemorySpacePrimitives;

    fn deps(root: &std::path::Path) -> InstanceDeps {
        InstanceDeps {
            root: root.to_path_buf(),
            assets: AssetFactories {
                client_bundle: Box::new(|| Box::new(MemorySpacePrimitives::new())),
                base_fs: Box::new(|| Box::new(MemorySpacePrimitives::new())),
            },
            runtime: Box::new(|_| None),
            metrics: None,
            auth: InstanceAuth::Single(Some(
                crate::auth::AuthConfig::try_parse(Some("admin:pw"), None, None, None, None)
                    .unwrap()
                    .unwrap(),
            )),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
            index_template: "# Test space\n".into(),
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            public: true,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
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
    fn boots_empty_without_config_file() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        assert!(m.registry().current().instances.is_empty());
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
        // Folder created + index seeded with the configured template.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("spaces").join(&id).join("index.md")).unwrap(),
            "# Test space\n"
        );
        // Routes live immediately.
        let (inst, prefix) = m
            .registry()
            .current()
            .resolve_main("localhost", "/work/x")
            .unwrap();
        assert_eq!(inst.id, id);
        assert_eq!(prefix, "/work");
        // Persisted.
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
        cfg.folder = format!("spaces/{id}"); // keep the same folder
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
        // One root-bound, open space whose folder is the root itself.
        let mut cfg = payload("Solo", Binding::Prefix { prefix: "/".into() });
        cfg.folder = ".".into();
        cfg.public = false;
        let mut spaces = HashMap::new();
        spaces.insert("solo".to_string(), cfg);
        let config = MultiConfig { spaces };

        let m = MultiManager::boot_in_memory(dir.path().to_path_buf(), config, deps(dir.path()))
            .unwrap();

        // Routes resolve on any host/path (root binding).
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

        // No space references "ghost": a no-op, not an error.
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
        // Everything the patch didn't name survives.
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
    fn visible_space_omits_sensitive_config() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot_with_users(dir.path(), &["bob"]);
        let mut cfg = payload(
            "Private",
            Binding::Prefix {
                prefix: "/priv".into(),
            },
        );
        cfg.public = false;
        cfg.members.insert("bob".into(), Default::default());
        m.create(cfg, true).unwrap();

        let visible = m.list_accessible("bob", false);
        assert_eq!(visible.len(), 1);
        let json = serde_json::to_value(&visible[0]).unwrap();
        let obj = json.as_object().unwrap();
        // The allowlist: exactly these keys, nothing else.
        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec!["binding", "id", "name", "state"]);
        // Named explicitly so a regression names the leaked field.
        for leaked in ["folder", "members", "shell", "runtimeApi", "logPush"] {
            assert!(!obj.contains_key(leaked), "leaked `{leaked}`");
        }
    }

    #[test]
    fn space_state_serializes_lowercase() {
        let state = serde_json::to_value(SpaceState::Errored).unwrap();
        assert_eq!(state, serde_json::json!("errored"));
        let state = serde_json::to_value(SpaceState::Running).unwrap();
        assert_eq!(state, serde_json::json!("running"));
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
        public.public = true;
        m.create(public, true).unwrap();

        let mut bobs = payload(
            "Bobs",
            Binding::Prefix {
                prefix: "/bob".into(),
            },
        );
        bobs.public = false;
        bobs.members.insert("bob".into(), Default::default());
        m.create(bobs, true).unwrap();

        let mut carols = payload(
            "Carols",
            Binding::Prefix {
                prefix: "/carol".into(),
            },
        );
        carols.public = false;
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
        // Six spaces, created in an order that is neither alphabetical nor
        // its reverse, so that HashMap's per-process random iteration order
        // cannot accidentally happen to match the expected output — with 3
        // elements that lands by chance roughly 1 in 6 runs; with 6 it's
        // 1 in 720, which is what `out.sort_by(...)` in `list_accessible`
        // exists to guarantee regardless of iteration order.
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
            cfg.public = true;
            m.create(cfg, true).unwrap();
        }
        let names: Vec<String> = m
            .list_accessible("anyone", false)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert_eq!(names, ["Alpha", "Delta", "Foxtrot", "Kilo", "Mike", "Zulu"]);
    }
}
