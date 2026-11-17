use std::collections::HashMap;
use std::sync::Mutex;

pub struct Handoff {
    pub destination: String,
    pub scope: String,
    pub binding: String,
    pub username: String,
    pub credential_version: Option<String>,
    pub session_id: String,
    pub shared: bool,
    pub encrypt: bool,
}

#[derive(Default)]
pub struct Handoffs(Mutex<HashMap<String, (u64, Handoff)>>);

impl Handoffs {
    pub fn issue(&self, grant: Handoff, now: u64) -> Result<String, String> {
        let mut entries = self.0.lock().unwrap();
        entries.retain(|_, (expires, _)| *expires > now);
        if entries.len() >= 1024 {
            return Err("Too many pending sign-ins. Try again shortly.".into());
        }
        let code = crate::auth::oidc::attempts::random_secret();
        entries.insert(code.clone(), (now + 60, grant));
        Ok(code)
    }
    pub fn consume(&self, code: &str, origin: &str, binding: &str, now: u64) -> Option<Handoff> {
        let (expires, grant) = self.0.lock().unwrap().remove(code)?;
        let destination = reqwest::Url::parse(&grant.destination).ok()?;
        if expires <= now
            || destination.origin().ascii_serialization() != origin
            || !crate::auth::config::constant_time_eq(grant.binding.as_bytes(), binding.as_bytes())
        {
            return None;
        }
        Some(grant)
    }
}
