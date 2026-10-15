//! Choosing the server's search model at runtime, and the instances the
//! search admin API reports on.

use std::collections::HashSet;
use std::sync::Arc;

use silverbullet_server_search::semantic::catalog;

use super::install::retire_services;
use super::{ApiError, MultiManager, Retired};
use crate::multi::instance::SpaceInstance;
use crate::multi::search_policy;
use crate::multi::validate::FieldError;

impl MultiManager {
    /// Chooses the model semantic search runs with (`None`: off): saves it
    /// in `server.json`, switches the search service (which starts the
    /// download at once), and rebuilds every space that runs
    /// semantic search now or will with the new model (every space that doesn't opt
    /// out, unless it is too large; `SpaceSearch::semantic_state`): onto
    /// the new service, or onto full-text search. Their builds queue for the
    /// one build slot. Per-space settings are never rewritten. An id this
    /// server doesn't offer changes nothing.
    pub fn set_search_model(&self, id: Option<&str>) -> Result<(), ApiError> {
        let spec = match id {
            None => None,
            Some(id) => Some(catalog::resolve(id).map_err(|_| {
                ApiError::Validation(vec![FieldError {
                    field: "model".into(),
                    message: format!("{id} isn't a search model this server offers"),
                }])
            })?),
        };
        let mut retired = Retired::default();
        let mut inner = self.state.lock().unwrap();
        let mut server_config = inner.server_config.clone();
        server_config.search.model = spec.map(|spec| spec.id.to_string());
        server_config
            .save(&self.root.join("server.json"))
            .map_err(ApiError::Internal)?;
        inner.server_config = server_config;
        if !self.deps.search.set_model(spec) {
            return Ok(());
        }
        let config = inner.config.clone();
        let search = &self.deps.search;
        let rebuilt: HashSet<String> = inner
            .instances
            .iter()
            .filter(|(id, instance)| {
                config.spaces.get(*id).is_some_and(|cfg| {
                    search_policy::model_change_rebuilds(search, id, cfg, instance)
                })
            })
            .map(|(id, instance)| {
                retire_services(instance);
                id.clone()
            })
            .collect();
        self.install_instances(
            &mut inner,
            &config,
            &|id, _, _| rebuilt.contains(id),
            true,
            &mut retired,
        );
        Ok(())
    }

    /// Every space's instance, by id.
    pub fn search_instances(&self) -> Vec<(String, Arc<SpaceInstance>)> {
        let inner = self.state.lock().unwrap();
        let mut instances: Vec<_> = inner
            .instances
            .iter()
            .map(|(id, instance)| (id.clone(), instance.clone()))
            .collect();
        instances.sort_by(|a, b| a.0.cmp(&b.0));
        instances
    }
}
