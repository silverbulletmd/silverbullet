use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const CLIENT_ID: &str = "silverbullet-cli";
pub const GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
pub const TTL: u64 = 300;
pub const INTERVAL: u64 = 5;
const MAX_ATTEMPTS: usize = 256;

#[derive(Clone)]
pub struct Attempt {
    pub device_code: String,
    pub user_code: String,
    pub device_name: String,
    issued: u64,
    last_poll: Option<u64>,
    interval: u64,
    decision: Option<Option<String>>,
}

#[derive(Default)]
struct Inner {
    attempts: HashMap<String, Attempt>,
    issued: Vec<u64>,
    guesses: Vec<u64>,
}

#[derive(Default)]
pub struct DeviceStore(Mutex<Inner>);

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn permit(events: &mut Vec<u64>, now: u64, limit: usize) -> bool {
    events.retain(|t| now.saturating_sub(*t) < 60);
    if events.len() >= limit {
        return false;
    }
    events.push(now);
    true
}

fn normalize(code: &str) -> String {
    code.chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .flat_map(char::to_uppercase)
        .collect()
}

impl DeviceStore {
    pub fn issue(&self, label: String, now: u64) -> Result<Attempt, &'static str> {
        let mut inner = self.0.lock().unwrap();
        inner
            .attempts
            .retain(|_, a| now.saturating_sub(a.issued) < TTL);
        if inner.attempts.len() >= MAX_ATTEMPTS || !permit(&mut inner.issued, now, 30) {
            return Err("slow_down");
        }
        loop {
            let mut bytes = [0u8; 40];
            getrandom::fill(&mut bytes).expect("OS RNG must be available");
            let device_code = bytes[..32]
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            let user_code = bytes[32..]
                .iter()
                .map(|b| alphabet[(*b as usize) % alphabet.len()] as char)
                .collect::<String>();
            if inner
                .attempts
                .values()
                .any(|a| normalize(&a.user_code) == user_code)
            {
                continue;
            }
            let attempt = Attempt {
                device_code: device_code.clone(),
                user_code: format!("{}-{}", &user_code[..4], &user_code[4..]),
                device_name: label,
                issued: now,
                last_poll: None,
                interval: INTERVAL,
                decision: None,
            };
            inner.attempts.insert(device_code, attempt.clone());
            return Ok(attempt);
        }
    }

    pub fn lookup(&self, code: &str, now: u64) -> Result<Attempt, &'static str> {
        let mut inner = self.0.lock().unwrap();
        if !permit(&mut inner.guesses, now, 60) {
            return Err("slow_down");
        }
        inner
            .attempts
            .values()
            .find(|a| {
                normalize(&a.user_code) == normalize(code)
                    && now.saturating_sub(a.issued) < TTL
                    && a.decision.is_none()
            })
            .cloned()
            .ok_or("invalid_grant")
    }

    pub fn decide(
        &self,
        code: &str,
        username: Option<String>,
        now: u64,
    ) -> Result<(), &'static str> {
        let mut inner = self.0.lock().unwrap();
        if !permit(&mut inner.guesses, now, 60) {
            return Err("slow_down");
        }
        let attempt = inner
            .attempts
            .values_mut()
            .find(|a| {
                normalize(&a.user_code) == normalize(code)
                    && now.saturating_sub(a.issued) < TTL
                    && a.decision.is_none()
            })
            .ok_or("invalid_grant")?;
        attempt.decision = Some(username);
        Ok(())
    }

    pub fn poll(&self, code: &str, client: &str, now: u64) -> Result<String, &'static str> {
        if client != CLIENT_ID {
            return Err("unauthorized_client");
        }
        let mut inner = self.0.lock().unwrap();
        let attempt = inner.attempts.get_mut(code).ok_or("invalid_grant")?;
        if now.saturating_sub(attempt.issued) >= TTL {
            inner.attempts.remove(code);
            return Err("expired_token");
        }
        if attempt
            .last_poll
            .is_some_and(|last| now.saturating_sub(last) < attempt.interval)
        {
            attempt.interval = attempt.interval.saturating_add(5);
            attempt.last_poll = Some(now);
            return Err("slow_down");
        }
        attempt.last_poll = Some(now);
        if attempt.decision.is_none() {
            return Err("authorization_pending");
        }
        let attempt = inner.attempts.remove(code).unwrap();
        attempt.decision.unwrap().ok_or("access_denied")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_slowdown_approval_and_replay() {
        let store = DeviceStore::default();
        let a = store.issue("Workshop".into(), 100).unwrap();
        assert_eq!(
            store.poll(&a.device_code, CLIENT_ID, 100),
            Err("authorization_pending")
        );
        assert_eq!(store.poll(&a.device_code, CLIENT_ID, 101), Err("slow_down"));
        store
            .decide(&a.user_code, Some("river".into()), 102)
            .unwrap();
        assert_eq!(store.poll(&a.device_code, CLIENT_ID, 106), Err("slow_down"));
        assert_eq!(
            store.poll(&a.device_code, CLIENT_ID, 121),
            Ok("river".into())
        );
        assert_eq!(
            store.poll(&a.device_code, CLIENT_ID, 126),
            Err("invalid_grant")
        );
    }
    #[test]
    fn denial_expiration_client_and_space_binding() {
        let store = DeviceStore::default();
        let a = store.issue("Workshop".into(), 100).unwrap();
        assert_eq!(
            store.poll(&a.device_code, "other", 100),
            Err("unauthorized_client")
        );
        assert_eq!(
            DeviceStore::default().poll(&a.device_code, CLIENT_ID, 100),
            Err("invalid_grant")
        );
        store.decide(&a.user_code, None, 100).unwrap();
        assert_eq!(
            store.poll(&a.device_code, CLIENT_ID, 100),
            Err("access_denied")
        );
        let a = store.issue("Workshop".into(), 100).unwrap();
        assert_eq!(
            store.poll(&a.device_code, CLIENT_ID, 400),
            Err("expired_token")
        );
    }
    #[test]
    fn parallel_polls_only_issue_one_grant() {
        let store = std::sync::Arc::new(DeviceStore::default());
        let attempt = store.issue("Workshop".into(), 100).unwrap();
        store
            .decide(&attempt.user_code, Some("river".into()), 100)
            .unwrap();
        let threads = (0..8)
            .map(|_| {
                let store = store.clone();
                let code = attempt.device_code.clone();
                std::thread::spawn(move || store.poll(&code, CLIENT_ID, 100).is_ok())
            })
            .collect::<Vec<_>>();
        assert_eq!(
            threads
                .into_iter()
                .filter_map(|t| t.join().unwrap().then_some(()))
                .count(),
            1
        );
    }

    #[test]
    fn issuance_and_guesses_are_bounded() {
        let store = DeviceStore::default();
        for _ in 0..30 {
            store.issue("Workshop".into(), 100).unwrap();
        }
        assert!(store.issue("Workshop".into(), 100).is_err());
        for _ in 0..60 {
            assert!(store.lookup("unknown", 100).is_err());
        }
        assert_eq!(store.lookup("unknown", 100).err(), Some("slow_down"));
        assert!(store.issue("Workshop".into(), 400).is_ok());
        assert_eq!(store.0.lock().unwrap().attempts.len(), 1);
    }
}
