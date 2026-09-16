use super::config::ProviderConfig;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    revision: u64,
    #[serde(default)]
    enabled: bool,
    active: Option<ProviderConfig>,
    draft: Option<ProviderConfig>,
    tested_revision: Option<u64>,
}

pub struct ProviderStore {
    path: PathBuf,
    state: Mutex<Settings>,
}
impl ProviderStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        let path = root.join("authentication.json");
        let mut state: Settings = match std::fs::read(&path) {
            Ok(data) => serde_json::from_slice(&data).map_err(|_| "Invalid authentication.json")?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(e.to_string()),
        };
        if let Some(config) = &mut state.active {
            config.validate()?;
        }
        if let Some(config) = &mut state.draft {
            config.validate()?;
        }
        Ok(Self {
            path,
            state: Mutex::new(state),
        })
    }

    fn mutate<T>(
        &self,
        change: impl FnOnce(&mut Settings) -> Result<T, String>,
    ) -> Result<T, String> {
        use std::io::Write;
        let mut state = self.state.lock().unwrap();
        let mut next = state.clone();
        let value = change(&mut next)?;
        let temp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| -> std::io::Result<()> {
            let mut file = options.open(&temp)?;
            file.write_all(&serde_json::to_vec_pretty(&next)?)?;
            file.sync_all()?;
            std::fs::rename(&temp, &self.path)
        })();
        if let Err(e) = result {
            let _ = std::fs::remove_file(temp);
            return Err(e.to_string());
        }
        *state = next;
        Ok(value)
    }

    pub fn save_draft(&self, mut config: ProviderConfig) -> Result<u64, String> {
        self.mutate(|state| {
            if config.client_secret.is_empty() {
                if let Some(previous) = state.draft.as_ref().or(state.active.as_ref()) {
                    if previous.client_id == config.client_id && previous.issuer == config.issuer {
                        config.client_secret = previous.client_secret.clone();
                    }
                }
            }
            config.validate()?;
            config.provider_id = state
                .active
                .as_ref()
                .filter(|p| p.issuer == config.issuer)
                .or_else(|| state.draft.as_ref().filter(|p| p.issuer == config.issuer))
                .map(|p| p.provider_id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            state.revision += 1;
            state.tested_revision = None;
            state.draft = Some(config);
            Ok(state.revision)
        })
    }

    pub fn mark_tested(&self, revision: u64) -> Result<(), String> {
        self.mutate(|state| {
            if state.revision != revision || state.draft.is_none() {
                return Err("Configuration changed. Test the current draft again.".into());
            }
            state.tested_revision = Some(revision);
            Ok(())
        })
    }

    pub fn activate(&self, revision: u64) -> Result<(), String> {
        self.activate_reviewed(revision, false)
    }

    pub fn activate_reviewed(&self, revision: u64, replace: bool) -> Result<(), String> {
        self.activate_with_revocation(revision, replace, |_| Ok(()))
    }

    pub fn activate_with_revocation(
        &self,
        revision: u64,
        replace: bool,
        revoke: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        self.mutate(|state| {
            if state.revision != revision || state.tested_revision != Some(revision) {
                return Err("Complete a successful sign-in test for this draft first".into());
            }
            let draft = state.draft.clone().ok_or("No draft configuration")?;
            if state
                .active
                .as_ref()
                .is_some_and(|active| active.provider_id != draft.provider_id)
                && !replace
            {
                return Err(
                    "Confirm provider replacement. Existing SSO accounts will need reprovisioning."
                        .into(),
                );
            }
            if let Some(active) = &state.active {
                revoke(&active.provider_id)?;
            }
            state.active = Some(draft);
            state.enabled = true;
            Ok(())
        })
    }

    pub fn with_active_config<T>(
        &self,
        config: &ProviderConfig,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let state = self.state.lock().unwrap();
        if !state.enabled
            || state.active.as_ref().is_none_or(|active| {
                active.public_json() != config.public_json()
                    || active.client_secret != config.client_secret
            })
        {
            return Err("Provider configuration changed. Start sign-in again.".into());
        }
        action()
    }

    pub fn disable_with_revocation(
        &self,
        revoke: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<(), String> {
        self.mutate(|state| {
            state.enabled = false;
            if let Some(active) = &state.active {
                revoke(&active.provider_id)?;
            }
            Ok(())
        })
    }

    pub fn disable(&self) -> Result<(), String> {
        self.mutate(|state| {
            state.enabled = false;
            Ok(())
        })
    }
    pub fn active(&self) -> Option<ProviderConfig> {
        let state = self.state.lock().unwrap();
        state.active.clone().filter(|_| state.enabled)
    }
    pub fn configured(&self) -> Option<ProviderConfig> {
        self.state.lock().unwrap().active.clone()
    }
    pub fn draft(&self) -> Option<(u64, ProviderConfig)> {
        let state = self.state.lock().unwrap();
        state.draft.clone().map(|c| (state.revision, c))
    }
    pub fn public_json(&self) -> serde_json::Value {
        let state = self.state.lock().unwrap();
        serde_json::json!({ "revision": state.revision, "enabled": state.enabled,
            "active": state.active.as_ref().map(ProviderConfig::public_json),
            "draft": state.draft.as_ref().map(ProviderConfig::public_json),
            "tested": state.tested_revision == Some(state.revision) })
    }
}
