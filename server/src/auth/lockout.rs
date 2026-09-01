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
        self.is_locked_at(now_ms())
    }

    pub fn add_count(&self) {
        self.add_count_at(now_ms());
    }

    fn is_locked_at(&self, now_ms: i64) -> bool {
        if self.disabled {
            return false;
        }
        let mut b = self.state.lock().unwrap();
        self.roll(&mut b, now_ms);
        b.count >= self.limit
    }

    fn add_count_at(&self, now_ms: i64) {
        if self.disabled {
            return;
        }
        let mut b = self.state.lock().unwrap();
        self.roll(&mut b, now_ms);
        b.count = b.count.saturating_add(1);
    }

    fn roll(&self, b: &mut Bucket, now_ms: i64) {
        let bucket = now_ms / self.bucket_size_ms;
        if b.time != bucket {
            b.time = bucket;
            b.count = 0;
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locks_after_limit_within_a_bucket() {
        let t = LockoutTimer::new(1_000, 3);
        assert!(!t.is_locked_at(5_000));
        t.add_count_at(5_000);
        t.add_count_at(5_400);
        assert!(!t.is_locked_at(5_800), "2 < 3 attempts: not locked");
        t.add_count_at(5_900);
        assert!(t.is_locked_at(5_999), "3 >= 3 attempts: locked");
    }

    #[test]
    fn resets_when_the_bucket_changes() {
        let t = LockoutTimer::new(1_000, 1);
        t.add_count_at(5_000);
        assert!(t.is_locked_at(5_999), "same bucket still holds the count");
        assert!(!t.is_locked_at(6_000), "new time bucket resets the counter");
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
