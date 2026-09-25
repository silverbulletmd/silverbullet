use super::config::ProviderConfig;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct ProviderAttempt {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub config: ProviderConfig,
}

#[derive(Clone)]
pub struct TestAttempt {
    pub revision: u64,
    pub owner: String,
    pub username: String,
    pub session_id: String,
    pub credential_version: Option<String>,
    pub proof_hash: String,
}

pub struct Attempt {
    pub expires: u64,
    pub destination: String,
    pub scope: String,
    pub binding: String,
    pub central_binding: Option<String>,
    pub csrf: String,
    pub remember: bool,
    pub encrypt: bool,
    pub provider: Option<ProviderAttempt>,
    pub test: Option<TestAttempt>,
}

pub struct Resume {
    pub attempt_id: String,
    pub expires: u64,
    pub destination: String,
    pub scope: String,
    pub session_id: String,
    pub username: String,
    pub encrypt: bool,
}

#[derive(Default)]
pub struct Attempts {
    pub entries: Mutex<HashMap<String, Attempt>>,
    pub results: Mutex<HashMap<String, (u64, String, serde_json::Value)>>,
    pub resumes: Mutex<HashMap<String, Resume>>,
}

pub fn random_secret() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS random source");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
