use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Brute-force lockout via a time-bucketed counter: at most `limit` attempts are
/// allowed per `bucket_size_ms` window. When the wall-clock bucket advances, the
/// count resets. A non-positive limit or period disables the timer entirely.
pub struct LockoutTimer {
    bucket_size_ms: i64,
    limit: u32,
    disabled: bool,
    state: Mutex<Bucket>,
}

#[derive(Default)]
struct Bucket {
    time: i64,
    count: u32,
}

impl LockoutTimer {
    pub fn new(bucket_size_ms: i64, limit: u32) -> Self {
        let disabled = bucket_size_ms < 1 || limit < 1;
        Self {
            bucket_size_ms: bucket_size_ms.max(1),
            limit,
            disabled,
            state: Mutex::new(Bucket::default()),
        }
    }

    /// Construct from an `AuthConfig`'s lockout fields (period in seconds).
    pub fn from_config(lockout_time_secs: u64, lockout_limit: u32) -> Self {
        let ms = (lockout_time_secs as i64).saturating_mul(1000);
        Self::new(ms, lockout_limit)
    }

    pub fn is_locked(&self) -> bool {
        if self.disabled {
            return false;
        }
        let mut b = self.state.lock().unwrap();
        self.roll(&mut b);
        b.count >= self.limit
    }

    pub fn add_count(&self) {
        if self.disabled {
            return;
        }
        let mut b = self.state.lock().unwrap();
        self.roll(&mut b);
        b.count = b.count.saturating_add(1);
    }

    fn roll(&self, b: &mut Bucket) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let bucket = now_ms / self.bucket_size_ms;
        if b.time != bucket {
            b.time = bucket;
            b.count = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_after_limit_within_a_bucket() {
        // Huge bucket so all attempts land in one window.
        let t = LockoutTimer::new(10_000_000, 3);
        assert!(!t.is_locked());
        t.add_count();
        t.add_count();
        assert!(!t.is_locked(), "2 < 3 attempts: not locked");
        t.add_count();
        assert!(t.is_locked(), "3 >= 3 attempts: locked");
    }

    #[test]
    fn resets_when_the_bucket_changes() {
        // 1ms buckets: a tiny sleep moves to a new bucket and resets the count.
        let t = LockoutTimer::new(1, 1);
        t.add_count();
        assert!(t.is_locked());
        std::thread::sleep(std::time::Duration::from_millis(3));
        assert!(!t.is_locked(), "new time bucket resets the counter");
    }

    #[test]
    fn disabled_when_limit_or_period_below_one() {
        assert!(!LockoutTimer::new(0, 5).is_locked());
        let t = LockoutTimer::new(0, 5);
        for _ in 0..100 {
            t.add_count();
        }
        assert!(!t.is_locked(), "disabled timer never locks");
    }
}
