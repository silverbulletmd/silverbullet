//! The multi-space orchestrator: owns the persisted `MultiConfig`, the built
//! instances, and the swap-on-change lifecycle. Every mutation follows one
//! path: validate -> persist (atomic) -> rebuild changed instances -> swap the
//! routing table -> notify the listener manager.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::multi::config::{MultiConfig, SpaceAuth, SpaceConfig};
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

pub struct MultiManager {
    root: PathBuf,
    config_path: PathBuf,
    deps: InstanceDeps,
    main_port: u16,
    metrics_port: Option<u16>,
    /// Current persisted config + built instances, mutated under one lock so
    /// concurrent admin calls serialize.
    state: Mutex<Inner>,
    registry: Registry,
    bind_errors: Mutex<HashMap<u16, String>>,
    changes: tokio::sync::watch::Sender<u64>,
}

struct Inner {
    config: MultiConfig,
    instances: HashMap<String, Arc<SpaceInstance>>,
}

impl MultiManager {
    /// Load spaces.json (hard error when malformed), build all instances, and
    /// return the manager. `changes` is a watch channel bumped on every apply.
    pub fn boot(
        root: PathBuf,
        deps: InstanceDeps,
        main_port: u16,
        metrics_port: Option<u16>,
    ) -> Result<Arc<Self>, String> {
        let config_path = root.join("spaces.json");
        let config = MultiConfig::load(&config_path)?;
        let errors = validate(&config, main_port, metrics_port);
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
        let (changes, _) = tokio::sync::watch::channel(0);
        Ok(Arc::new(Self {
            root,
            config_path,
            deps,
            main_port,
            metrics_port,
            state: Mutex::new(Inner { config, instances }),
            registry: Registry::new(table),
            bind_errors: Mutex::new(HashMap::new()),
            changes,
        }))
    }

    pub fn registry(&self) -> &Registry {
        &self.registry
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn subscribe_changes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.changes.subscribe()
    }

    /// Record/clear a port bind failure (listener manager reports these).
    /// Live availability check for a prospective port binding. Returns
    /// `(available, reason)`. `exclude_id` names the space being edited, whose
    /// own current binding counts as available. The OS-level probe binds on
    /// the loopback interface only, so it is advisory — the authoritative
    /// check remains the listener manager's real bind at apply time.
    pub fn port_check(&self, port: u16, exclude_id: Option<&str>) -> (bool, String) {
        if port == self.main_port {
            return (false, "used by the main SilverBullet listener".into());
        }
        if Some(port) == self.metrics_port {
            return (false, "used by the metrics listener".into());
        }
        {
            let inner = self.state.lock().unwrap();
            for (id, cfg) in &inner.config.spaces {
                if let crate::multi::config::Binding::Port { port: p } = &cfg.binding {
                    if *p == port {
                        if exclude_id == Some(id.as_str()) {
                            return (true, "current binding of this space".into());
                        }
                        return (false, format!("used by space \"{}\"", cfg.name));
                    }
                }
            }
        }
        match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(_) => (true, String::new()),
            Err(e) => (false, format!("not bindable: {e}")),
        }
    }

    pub fn set_bind_error(&self, port: u16, error: Option<String>) {
        let mut be = self.bind_errors.lock().unwrap();
        match error {
            Some(e) => {
                be.insert(port, e);
            }
            None => {
                be.remove(&port);
            }
        }
    }

    /// Validate + persist + rebuild + swap. Called with the state lock held by
    /// the CRUD methods (single mutation path). On validation or persist
    /// failure, `inner` is left completely untouched.
    fn apply_locked(&self, inner: &mut Inner, new_config: MultiConfig) -> Result<(), ApiError> {
        let errors = validate(&new_config, self.main_port, self.metrics_port);
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
        self.changes.send_modify(|v| *v += 1);
        Ok(())
    }

    pub fn create(&self, mut cfg: SpaceConfig) -> Result<String, ApiError> {
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
        seed_index(&folder, &cfg.index_page);
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

    pub fn set_password(&self, id: &str, plain: &str) -> Result<(), ApiError> {
        let mut inner = self.state.lock().unwrap();
        let Some(space) = inner.config.spaces.get(id).cloned() else {
            return Err(ApiError::NotFound);
        };
        let SpaceAuth::Custom {
            user,
            auth_token,
            lockout_limit,
            lockout_time,
            remember_me_hours,
            ..
        } = space.auth.clone()
        else {
            return Err(ApiError::Validation(vec![FieldError {
                field: "auth.mode".into(),
                message: "password can only be set for custom auth mode".into(),
            }]));
        };
        let pass_hash = crate::auth::password::hash_password(plain).map_err(ApiError::Internal)?;
        let mut updated = space;
        updated.auth = SpaceAuth::Custom {
            user,
            pass_hash,
            auth_token,
            lockout_limit,
            lockout_time,
            remember_me_hours,
        };
        let mut new_config = inner.config.clone();
        new_config.spaces.insert(id.to_string(), updated);
        self.apply_locked(&mut inner, new_config)
    }

    /// JSON view for GET /spaces: id -> { config (passHash redacted to
    /// hasPassword), status: { state: "running"|"errored", reason? } }.
    pub fn list(&self) -> serde_json::Value {
        let inner = self.state.lock().unwrap();
        let bind_errors = self.bind_errors.lock().unwrap();
        let mut out = serde_json::Map::new();
        for (id, inst) in &inner.instances {
            let mut v = serde_json::to_value(&inst.config).unwrap_or_default();
            // Redact the hash; expose hasPassword.
            let mut has_password = false;
            if let Some(auth) = v.get_mut("auth").and_then(|a| a.as_object_mut()) {
                if let Some(h) = auth.remove("passHash") {
                    has_password = h.as_str().map(|s| !s.is_empty()).unwrap_or(false);
                }
            }
            v["hasPassword"] = serde_json::Value::Bool(has_password);
            // Status: build errors, or a bind error reported by the listener
            // manager for port-bound spaces.
            let port_error = match &inst.config.binding {
                crate::multi::config::Binding::Port { port } => bind_errors.get(port).cloned(),
                _ => None,
            };
            v["status"] = match (&inst.status, port_error) {
                (InstanceStatus::Errored(reason), _) => {
                    serde_json::json!({ "state": "errored", "reason": reason })
                }
                (_, Some(reason)) => serde_json::json!({ "state": "errored", "reason": reason }),
                _ => serde_json::json!({ "state": "running" }),
            };
            out.insert(id.clone(), v);
        }
        serde_json::Value::Object(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceAuth, SpaceConfig};
    use crate::multi::instance::{AssetFactories, InstanceDeps};
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
            admin_auth: crate::auth::AuthConfig::try_parse(
                Some("admin:pw"),
                None,
                None,
                None,
                None,
            )
            .unwrap()
            .unwrap(),
            version: "test".into(),
            main_port: 3000,
            disable_service_worker: true,
        }
    }

    fn payload(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            auth: SpaceAuth::None,
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
        MultiManager::boot(root.to_path_buf(), deps(root), 3000, None).unwrap()
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
            MultiManager::boot(dir.path().to_path_buf(), deps(dir.path()), 3000, None).is_err()
        );
    }

    #[test]
    fn create_defaults_folder_seeds_index_persists_and_routes() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(payload(
                "Work",
                Binding::Prefix {
                    prefix: "/work".into(),
                },
            ))
            .unwrap();
        // Folder created + index seeded.
        assert!(dir
            .path()
            .join("spaces")
            .join(&id)
            .join("index.md")
            .exists());
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
        m.create(payload(
            "A",
            Binding::Prefix {
                prefix: "/x".into(),
            },
        ))
        .unwrap();
        let e = m
            .create(payload(
                "B",
                Binding::Prefix {
                    prefix: "/x".into(),
                },
            ))
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
            .create(payload(
                "A",
                Binding::Prefix {
                    prefix: "/a".into(),
                },
            ))
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
    fn set_password_hashes_and_unerrors_custom_space() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let mut p = payload(
            "C",
            Binding::Prefix {
                prefix: "/c".into(),
            },
        );
        p.auth = SpaceAuth::Custom {
            user: "u".into(),
            pass_hash: String::new(),
            auth_token: String::new(),
            lockout_limit: 10,
            lockout_time: 60,
            remember_me_hours: 168,
        };
        let id = m.create(p).unwrap();
        // Errored until a password is set.
        let list = m.list();
        assert_eq!(list[&id]["status"]["state"], "errored");
        m.set_password(&id, "hunter2").unwrap();
        let list = m.list();
        assert_eq!(list[&id]["status"]["state"], "running");
        assert_eq!(list[&id]["hasPassword"], true);
        assert!(
            list[&id]["auth"].get("passHash").is_none(),
            "hash must be redacted"
        );
    }

    #[test]
    fn set_password_on_non_custom_space_is_a_validation_error() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let id = m
            .create(payload(
                "A",
                Binding::Prefix {
                    prefix: "/a".into(),
                },
            ))
            .unwrap();
        assert!(matches!(
            m.set_password(&id, "x"),
            Err(ApiError::Validation(_))
        ));
    }

    #[test]
    fn change_watch_bumps_on_apply() {
        let dir = tempfile::tempdir().unwrap();
        let m = boot(dir.path());
        let rx = m.subscribe_changes();
        let before = *rx.borrow();
        m.create(payload("A", Binding::Port { port: 4321 }))
            .unwrap();
        assert!(*m.subscribe_changes().borrow() > before);
    }
}
