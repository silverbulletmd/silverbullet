//! The live routing state: which space answers which host/prefix/port. Built
//! immutably from the instance set and swapped wholesale behind a `RwLock` on
//! every config change (readers clone the `Arc`, never block on rebuilds).

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use crate::multi::config::Binding;
use crate::multi::instance::SpaceInstance;

pub struct RoutingTable {
    pub instances: HashMap<String, Arc<SpaceInstance>>,
    hosts: HashMap<String, Arc<SpaceInstance>>,
    /// (normalized prefix, instance), sorted longest-first.
    prefixes: Vec<(String, Arc<SpaceInstance>)>,
    ports: HashMap<u16, Arc<SpaceInstance>>,
}

impl RoutingTable {
    pub fn build(instances: HashMap<String, Arc<SpaceInstance>>) -> Self {
        let mut hosts = HashMap::new();
        let mut prefixes = Vec::new();
        let mut ports = HashMap::new();
        for inst in instances.values() {
            match &inst.config.binding {
                Binding::Prefix { .. } => prefixes.push((inst.prefix.clone(), inst.clone())),
                Binding::Host { host } => {
                    // Host matching is case-insensitive (DNS is); store the key
                    // lowercased and lowercase the request host at resolve time.
                    hosts.insert(host.to_ascii_lowercase(), inst.clone());
                }
                Binding::Port { port } => {
                    ports.insert(*port, inst.clone());
                }
            }
        }
        prefixes.sort_by_key(|(prefix, _)| std::cmp::Reverse(prefix.len()));
        Self {
            instances,
            hosts,
            prefixes,
            ports,
        }
    }

    /// Resolve a main-listener request. `host` is the raw Host header (may
    /// include :port — stripped internally). Returns the instance and the
    /// matched prefix ("" for host matches).
    pub fn resolve_main(&self, host: &str, path: &str) -> Option<(Arc<SpaceInstance>, String)> {
        let bare_host = host.split(':').next().unwrap_or(host).to_ascii_lowercase();
        if let Some(inst) = self.hosts.get(&bare_host) {
            return Some((inst.clone(), String::new()));
        }
        for (prefix, inst) in &self.prefixes {
            let matches =
                prefix.is_empty() || path == prefix || path.starts_with(&format!("{prefix}/"));
            if matches {
                return Some((inst.clone(), prefix.clone()));
            }
        }
        None
    }

    pub fn resolve_port(&self, port: u16) -> Option<Arc<SpaceInstance>> {
        self.ports.get(&port).cloned()
    }

    pub fn ports(&self) -> Vec<u16> {
        let mut v: Vec<u16> = self.ports.keys().copied().collect();
        v.sort_unstable();
        v
    }
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
    pub fn swap(&self, table: RoutingTable) {
        *self.0.write().expect("registry lock poisoned") = Arc::new(table);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, SpaceAuth, SpaceConfig};
    use crate::multi::instance::{InstanceStatus, SpaceInstance};
    use std::collections::HashMap;
    use std::sync::Arc;

    fn inst(id: &str, binding: Binding) -> Arc<SpaceInstance> {
        let prefix = match &binding {
            Binding::Prefix { prefix } => crate::multi::validate::normalize_prefix(prefix),
            _ => String::new(),
        };
        Arc::new(SpaceInstance {
            id: id.into(),
            config: SpaceConfig {
                name: id.into(),
                folder: String::new(),
                binding,
                auth: SpaceAuth::None,
                read_only: false,
                shell: Default::default(),
                runtime_api: false,
                index_page: "index".into(),
                description: String::new(),
                theme_color: String::new(),
                head_html: String::new(),
                space_ignore: String::new(),
                log_push: false,
                extra: Default::default(),
            },
            prefix,
            status: InstanceStatus::Running,
            router: None,
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
                },
            ),
        );
        m.insert(
            "ported".into(),
            inst("ported", Binding::Port { port: 4001 }),
        );
        RoutingTable::build(m)
    }

    #[test]
    fn host_match_beats_prefix_match() {
        let t = table();
        let (i, p) = t
            .resolve_main("notes.example.com:3000", "/work/page")
            .unwrap();
        assert_eq!(i.id, "hosted");
        assert_eq!(p, "");
    }

    #[test]
    fn host_match_is_case_insensitive() {
        let t = table();
        // Mixed-case Host header still resolves to the lowercase-bound space.
        let (i, p) = t.resolve_main("Notes.Example.COM:3000", "/x").unwrap();
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
        // /workother must NOT match /work (boundary check).
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
    fn port_resolution_and_listing() {
        let t = table();
        assert_eq!(t.resolve_port(4001).unwrap().id, "ported");
        assert!(t.resolve_port(4002).is_none());
        assert_eq!(t.ports(), vec![4001]);
    }

    #[test]
    fn registry_swaps_atomically() {
        let r = Registry::new(table());
        assert_eq!(r.current().ports(), vec![4001]);
        r.swap(RoutingTable::build(HashMap::new()));
        assert!(r.current().ports().is_empty());
    }
}
