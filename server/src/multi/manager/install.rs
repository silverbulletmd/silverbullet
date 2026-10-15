//! The one code path that installs rebuilt instances, shared by every
//! config change (`apply_locked`) and the search model switch.

use std::collections::HashMap;
use std::sync::Arc;

use super::{kept_folder, Inner, MultiManager, Retired};
use crate::multi::config::{MultiConfig, SpaceConfig};
use crate::multi::instance::{build_instance, SpaceInstance};
use crate::multi::registry::RoutingTable;

impl MultiManager {
    /// Installs `config`'s instances: keeps each existing one unless
    /// `rebuild(id, cfg, existing)` says otherwise, builds the rest (a rebuilt
    /// instance that keeps its folder inherits from its predecessor,
    /// [`SpaceInstance::inherit_from`]), publishes the prefix roots, swaps the
    /// routing table and hands the old table and instances to `retired`.
    pub(super) fn install_instances(
        &self,
        inner: &mut Inner,
        config: &MultiConfig,
        rebuild: &dyn Fn(&str, &SpaceConfig, &SpaceInstance) -> bool,
        preserve_sync_history: bool,
        retired: &mut Retired,
    ) {
        let mut instances = HashMap::new();
        for (id, cfg) in &config.spaces {
            match inner.instances.get(id) {
                Some(existing) if !rebuild(id, cfg, existing) => {
                    instances.insert(id.clone(), existing.clone());
                }
                previous => {
                    let mut instance = build_instance(id, cfg, &self.deps);
                    let kept = previous.filter(|p| kept_folder(Some(&p.config), Some(cfg)));
                    if let Some(previous) = kept {
                        instance.inherit_from(previous, preserve_sync_history);
                    }
                    instances.insert(id.clone(), Arc::new(instance));
                }
            }
        }
        let primary_host = inner.server_config.primary_host();
        super::publish_prefix_roots(&instances, primary_host.as_deref());
        retired.table = Some(self.registry.swap(RoutingTable::build_for_primary(
            instances.clone(),
            primary_host.as_deref(),
        )));
        let previous = std::mem::replace(&mut inner.instances, instances);
        retired.instances.extend(previous.into_values());
    }
}

impl SpaceInstance {
    /// What a rebuilt instance that keeps its folder takes over from
    /// `previous`: its page count (the size rule's count while the new
    /// index reopens), and with an unchanged sync policy also its sync
    /// history when `preserve_sync_history`.
    fn inherit_from(&mut self, previous: &SpaceInstance, preserve_sync_history: bool) {
        self.last_pages = previous.pages();
        let mut old_policy = previous.config.git_sync();
        old_policy.paused = false;
        let mut new_policy = self.config.git_sync();
        new_policy.paused = false;
        if preserve_sync_history && old_policy == new_policy {
            if let (Some(current), Some(old)) = (&self.revisions, &previous.revisions) {
                current.inherit_sync_history(old);
            }
        }
    }
}

/// Stops what an instance about to be replaced runs in the background: its
/// runtime, and its git sync.
pub(super) fn retire_services(instance: &SpaceInstance) {
    if let Some(runtime) = &instance.runtime {
        runtime.shutdown();
    }
    if let Some(engine) = &instance.revisions {
        engine.quiesce_sync();
    }
}
