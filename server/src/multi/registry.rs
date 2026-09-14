//! The live routing state: which space answers which host or prefix. Built
//! immutably from the instance set and swapped wholesale behind a `RwLock` on
//! every config change (readers clone the `Arc`, never block on rebuilds).

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::multi::instance::SpaceInstance;

pub(crate) fn runtime_host(id: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(id.as_bytes()));
    format!("{}.{}.runtime.localhost", &digest[..32], &digest[32..])
}

pub struct RoutingTable {
    pub instances: HashMap<String, Arc<SpaceInstance>>,
    hosts: HashMap<String, Vec<(String, Arc<SpaceInstance>)>>,
    runtime_hosts: HashMap<String, Arc<SpaceInstance>>,
    /// (normalized prefix, instance), sorted longest-first.
    prefixes: Vec<(String, Arc<SpaceInstance>)>,
}

impl RoutingTable {
    pub fn build(instances: HashMap<String, Arc<SpaceInstance>>) -> Self {
        Self::build_for_primary(instances, None)
    }

    pub fn build_for_primary(
        instances: HashMap<String, Arc<SpaceInstance>>,
        primary_host: Option<&str>,
    ) -> Self {
        let mut hosts: HashMap<String, Vec<(String, Arc<SpaceInstance>)>> = HashMap::new();
        let mut runtime_hosts = HashMap::new();
        let mut prefixes = Vec::new();
        for inst in instances.values() {
            if inst.config.binding.host().is_some() {
                runtime_hosts.insert(runtime_host(&inst.id), inst.clone());
            }
            if let Some(host) = inst.config.binding.effective_host_scope(primary_host) {
                hosts
                    .entry(host)
                    .or_default()
                    .push((inst.prefix.clone(), inst.clone()));
            } else {
                prefixes.push((inst.prefix.clone(), inst.clone()));
            }
        }
        for routes in hosts.values_mut() {
            routes.sort_by_key(|(prefix, _)| std::cmp::Reverse(prefix.len()));
        }
        prefixes.sort_by_key(|(prefix, _)| std::cmp::Reverse(prefix.len()));
        Self {
            instances,
            hosts,
            runtime_hosts,
            prefixes,
        }
    }

    pub(crate) fn resolve_runtime(&self, host: &str) -> Option<Arc<SpaceInstance>> {
        self.runtime_hosts.get(host).cloned()
    }

    pub fn claims_host(&self, host: &str) -> bool {
        self.hosts.contains_key(&normalize_request_host(host))
    }

    /// Resolve a main-listener request. `host` is the raw Host header. Returns
    /// the instance and matched prefix (empty for root mounts).
    pub fn resolve_main(&self, host: &str, path: &str) -> Option<(Arc<SpaceInstance>, String)> {
        let bare_host = normalize_request_host(host);
        let routes = self.hosts.get(&bare_host).unwrap_or(&self.prefixes);
        for (prefix, inst) in routes {
            let matches =
                prefix.is_empty() || path == prefix || path.starts_with(&format!("{prefix}/"));
            if matches {
                return Some((inst.clone(), prefix.clone()));
            }
        }
        None
    }
}

fn normalize_request_host(host: &str) -> String {
    crate::multi::validate::normalize_host_authority(host)
}

/// Swappable handle to the current routing table.
pub struct Registry(RwLock<Arc<RoutingTable>>);

impl Registry {
    pub fn new(table: RoutingTable) -> Self {
        Self(RwLock::new(Arc::new(table)))
    }
    pub fn current(&self) -> Arc<RoutingTable> {
        self.0.read().expect("registry lock poisoned").clone()
    }
    /// Returns the table it replaced, so a caller that must control *when*
    /// the outgoing instances are dropped can hold on to it.
    pub fn swap(&self, table: RoutingTable) -> Arc<RoutingTable> {
        std::mem::replace(
            &mut *self.0.write().expect("registry lock poisoned"),
            Arc::new(table),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceAccess, SpaceConfig};
    use crate::multi::instance::{InstanceStatus, SpaceInstance};
    use std::collections::HashMap;
    use std::sync::Arc;

    fn inst(id: &str, binding: Binding) -> Arc<SpaceInstance> {
        let prefix = crate::multi::validate::normalize_prefix(binding.prefix());
        Arc::new(SpaceInstance {
            id: id.into(),
            config: SpaceConfig {
                name: id.into(),
                folder: String::new(),
                binding,
                access: Some(SpaceAccess::Write),
                legacy_public: None,
                members: Default::default(),
                read_only: false,
                shell: Default::default(),
                index_page: "index".into(),
                description: String::new(),
                theme_color: String::new(),
                head_html: String::new(),
                space_ignore: String::new(),
                log_push: false,
                revisions: Default::default(),
                git_sync: None,
                revisions_commit: None,
                extra: Default::default(),
            },
            prefix,
            space_prefixes: Default::default(),
            status: InstanceStatus::Running,
            router: None,
            revisions: None,
            runtime: None,
            runtime_authorizer: None,
        })
    }

    fn table() -> RoutingTable {
        let mut m = HashMap::new();
        m.insert(
            "root".into(),
            inst("root", Binding::Prefix { prefix: "/".into() }),
        );
        m.insert(
            "work".into(),
            inst(
                "work",
                Binding::Prefix {
                    prefix: "/work".into(),
                },
            ),
        );
        m.insert(
            "deep".into(),
            inst(
                "deep",
                Binding::Prefix {
                    prefix: "/work/sub".into(),
                },
            ),
        );
        m.insert(
            "hosted".into(),
            inst(
                "hosted",
                Binding::Host {
                    host: "notes.example.com".into(),
                    prefix: String::new(),
                },
            ),
        );
        RoutingTable::build(m)
    }

    #[test]
    fn custom_host_prefixes_are_isolated_and_longest_first() {
        let mut instances = table().instances;
        for (id, prefix) in [("host-work", "/work"), ("host-wiki", "/wiki")] {
            instances.insert(
                id.into(),
                inst(
                    id,
                    Binding::Host {
                        host: "Projects.Example.test.".into(),
                        prefix: prefix.into(),
                    },
                ),
            );
        }
        let t = RoutingTable::build(instances.clone());
        for (path, id, prefix) in [
            ("/work/page", "host-work", "/work"),
            ("/wiki", "host-wiki", "/wiki"),
        ] {
            let (instance, matched) = t.resolve_main("PROJECTS.example.test", path).unwrap();
            assert_eq!(instance.id, id);
            assert_eq!(matched, prefix);
        }
        assert!(t
            .resolve_main("projects.example.test.", "/missing")
            .is_none());
        assert!(t
            .resolve_main("projects.example.test", "/workother")
            .is_none());
        assert_eq!(
            t.resolve_main("other.example.test", "/work").unwrap().0.id,
            "work"
        );
        instances.insert(
            "host-root".into(),
            inst(
                "host-root",
                Binding::Host {
                    host: "projects.example.test".into(),
                    prefix: String::new(),
                },
            ),
        );
        let t = RoutingTable::build(instances);
        assert_eq!(
            t.resolve_main("projects.example.test", "/work/page")
                .unwrap()
                .0
                .id,
            "host-work"
        );
        assert_eq!(
            t.resolve_main("projects.example.test", "/missing")
                .unwrap()
                .0
                .id,
            "host-root"
        );
    }

    #[test]
    fn host_match_beats_prefix_match() {
        let t = table();
        let (i, p) = t.resolve_main("notes.example.com", "/work/page").unwrap();
        assert_eq!(i.id, "hosted");
        assert_eq!(p, "");
    }

    #[test]
    fn host_match_is_case_insensitive() {
        let t = table();
        let (i, p) = t.resolve_main("Notes.Example.COM", "/x").unwrap();
        assert_eq!(i.id, "hosted");
        assert_eq!(p, "");
    }

    #[test]
    fn longest_prefix_wins() {
        let t = table();
        assert_eq!(
            t.resolve_main("localhost", "/work/sub/x").unwrap().0.id,
            "deep"
        );
        assert_eq!(
            t.resolve_main("localhost", "/work/other").unwrap().0.id,
            "work"
        );
        assert_eq!(t.resolve_main("localhost", "/work").unwrap().0.id, "work");
        assert_eq!(
            t.resolve_main("localhost", "/workother").unwrap().0.id,
            "root"
        );
        assert_eq!(
            t.resolve_main("localhost", "/anything").unwrap().0.id,
            "root"
        );
    }

    #[test]
    fn no_root_space_means_no_match() {
        let mut m = HashMap::new();
        m.insert(
            "work".into(),
            inst(
                "work",
                Binding::Prefix {
                    prefix: "/work".into(),
                },
            ),
        );
        let t = RoutingTable::build(m);
        assert!(t.resolve_main("localhost", "/other").is_none());
    }

    #[test]
    fn primary_hostname_binding_routes_in_the_default_scope() {
        let mut m = HashMap::new();
        m.insert(
            "root".into(),
            inst("root", Binding::Prefix { prefix: "/".into() }),
        );
        m.insert(
            "notes".into(),
            inst(
                "notes",
                Binding::Host {
                    host: "MANAGER.example.test.".into(),
                    prefix: "/notes".into(),
                },
            ),
        );
        let t = RoutingTable::build_for_primary(m, Some("manager.example.test"));
        assert_eq!(
            t.resolve_main("manager.example.test", "/notes/page")
                .unwrap()
                .0
                .id,
            "notes"
        );
        assert_eq!(
            t.resolve_main("manager.example.test", "/other")
                .unwrap()
                .0
                .id,
            "root"
        );
        assert_eq!(
            t.resolve_runtime(&runtime_host("notes")).unwrap().id,
            "notes"
        );
    }

    #[test]
    fn prefixed_custom_hostname_is_claimed_even_when_path_does_not_match() {
        let mut m = HashMap::new();
        m.insert(
            "work".into(),
            inst(
                "work",
                Binding::Host {
                    host: "team.example.test".into(),
                    prefix: "/work".into(),
                },
            ),
        );
        let t = RoutingTable::build(m);
        assert!(t.claims_host("team.example.test"));
        assert!(!t.claims_host("team.example.test:3000"));
        assert!(!t.claims_host("other.example.test:3000"));
    }

    #[test]
    fn bare_and_explicitly_ported_hosts_are_distinct_scopes() {
        let mut m = HashMap::new();
        m.insert(
            "bare".into(),
            inst(
                "bare",
                Binding::Host {
                    host: "team.example.test".into(),
                    prefix: "/work".into(),
                },
            ),
        );
        m.insert(
            "ported".into(),
            inst(
                "ported",
                Binding::Host {
                    host: "TEAM.example.test.:3000".into(),
                    prefix: "/work".into(),
                },
            ),
        );
        let t = RoutingTable::build(m);
        assert_eq!(
            t.resolve_main("team.example.test", "/work/page")
                .unwrap()
                .0
                .id,
            "bare"
        );
        assert_eq!(
            t.resolve_main("team.example.test.:3000", "/work/page")
                .unwrap()
                .0
                .id,
            "ported"
        );
    }

    #[test]
    fn registry_swaps_atomically() {
        let r = Registry::new(table());
        assert!(!r.current().instances.is_empty());
        r.swap(RoutingTable::build(HashMap::new()));
        assert!(r.current().instances.is_empty());
    }
}
