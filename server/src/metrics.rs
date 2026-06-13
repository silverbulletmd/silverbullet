//! Prometheus request counters and text exposition. Exposes the counters
//! `silverbullet_http_requests`, `silverbullet_shell_executions`, and
//! `silverbullet_proxy_requests`. Each `Metrics` owns its own `Registry`, so
//! constructing more than one (e.g. across tests) never double-registers a
//! global. The standalone binary serves `gather()` on a dedicated metrics port;
//! `ServerState` holds an `Option<Arc<Metrics>>` so metrics are off unless
//! explicitly enabled.

use prometheus::{IntCounter, Registry, TextEncoder};

/// Owns the registry and the request counters.
pub struct Metrics {
    registry: Registry,
    /// Total HTTP requests reaching the main router.
    pub http_requests: IntCounter,
    /// Total `/.shell` command executions.
    pub shell_executions: IntCounter,
    /// Total `/.proxy` requests forwarded.
    pub proxy_requests: IntCounter,
    /// Total `/.runtime/{lua,lua_script}` eval requests received.
    pub runtime_api_requests: IntCounter,
}

impl Metrics {
    /// Build a fresh registry with all counters registered at zero.
    pub fn new() -> Self {
        let registry = Registry::new();
        let http_requests = IntCounter::new(
            "silverbullet_http_requests",
            "Total number of HTTP requests to SilverBullet",
        )
        .expect("counter opts");
        let shell_executions = IntCounter::new(
            "silverbullet_shell_executions",
            "Total number of shell commands executions",
        )
        .expect("counter opts");
        let proxy_requests = IntCounter::new(
            "silverbullet_proxy_requests",
            "Total number of proxy requests in the SilverBullet space",
        )
        .expect("counter opts");
        registry
            .register(Box::new(http_requests.clone()))
            .expect("register http");
        registry
            .register(Box::new(shell_executions.clone()))
            .expect("register shell");
        let runtime_api_requests = IntCounter::new(
            "silverbullet_runtime_api_requests_total",
            "Total number of runtime API requests received",
        )
        .expect("counter opts");
        registry
            .register(Box::new(proxy_requests.clone()))
            .expect("register proxy");
        registry
            .register(Box::new(runtime_api_requests.clone()))
            .expect("register runtime");
        Self {
            registry,
            http_requests,
            shell_executions,
            proxy_requests,
            runtime_api_requests,
        }
    }

    /// Render the current metrics in Prometheus text exposition format.
    pub fn gather(&self) -> String {
        let encoder = TextEncoder::new();
        encoder
            .encode_to_string(&self.registry.gather())
            .unwrap_or_default()
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_start_at_zero_and_increment() {
        let m = Metrics::new();
        assert_eq!(m.http_requests.get(), 0);
        m.http_requests.inc();
        m.http_requests.inc();
        assert_eq!(m.http_requests.get(), 2);
    }

    #[test]
    fn gather_emits_all_counter_names() {
        let m = Metrics::new();
        m.shell_executions.inc();
        m.proxy_requests.inc();
        m.runtime_api_requests.inc();
        let text = m.gather();
        assert!(text.contains("silverbullet_http_requests"), "{text}");
        assert!(text.contains("silverbullet_shell_executions"), "{text}");
        assert!(text.contains("silverbullet_proxy_requests"), "{text}");
        assert!(
            text.contains("silverbullet_runtime_api_requests_total"),
            "{text}"
        );
    }

    #[test]
    fn two_instances_do_not_conflict() {
        // Per-instance registry → constructing twice must not panic.
        let _a = Metrics::new();
        let _b = Metrics::new();
    }
}
