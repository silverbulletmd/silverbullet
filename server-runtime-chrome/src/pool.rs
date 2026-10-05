//! Isolated browser transports sharing one execution runtime.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use chromiumoxide::page::Page;
use serde_json::Value;
use silverbullet_server::runtime::{CaptureRect, ClientTransport, LogBuffer, RuntimeError};
use tokio::runtime::Runtime;
use tokio::sync::{watch, Mutex, Notify};

use crate::config::{ChromeConfig, SpacePage};
use crate::supervisor::{
    capture_on_page, eval_on_page, launch_browser, supervise_space, OwnedBrowser,
};

struct Registration {
    supervisor: tokio::task::JoinHandle<()>,
}

type BrowserSlot<B> = Mutex<Option<(u64, Arc<B>)>>;

pub struct ChromePool {
    rt: Option<Runtime>,
    config: ChromeConfig,
    spaces: StdMutex<HashMap<u64, Registration>>,
    next_id: AtomicU64,
}

pub(crate) struct BrowserOwner<B = OwnedBrowser> {
    config: ChromeConfig,
    browser: BrowserSlot<B>,
    launch_lock: Mutex<()>,
    next_generation: AtomicU64,
    stopped: watch::Sender<bool>,
    profile: Mutex<Option<tempfile::TempDir>>,
    metrics: StdMutex<crate::metrics::Metrics>,
    status: AtomicU8,
    restartable: AtomicBool,
    transferred: AtomicBool,
    terminal: AtomicBool,
}

fn clear_if_generation<T>(slot: &mut Option<(u64, T)>, generation: u64) -> bool {
    match slot {
        Some((current, _)) if *current == generation => {
            *slot = None;
            true
        }
        _ => false,
    }
}

impl<B> BrowserOwner<B> {
    fn new(config: ChromeConfig) -> Arc<Self> {
        Arc::new(Self {
            config,
            browser: Mutex::new(None),
            launch_lock: Mutex::new(()),
            next_generation: AtomicU64::new(0),
            stopped: watch::channel(false).0,
            profile: Mutex::new(None),
            metrics: StdMutex::new(crate::metrics::Metrics::default()),
            status: AtomicU8::new(0),
            restartable: AtomicBool::new(false),
            transferred: AtomicBool::new(false),
            terminal: AtomicBool::new(false),
        })
    }

    pub(crate) fn is_stopped(&self) -> bool {
        *self.stopped.borrow()
    }

    pub(crate) async fn cancelled(&self) {
        let mut stopped = self.stopped.subscribe();
        let _ = stopped.wait_for(|stopped| *stopped).await;
    }

    pub(crate) fn config(&self) -> &ChromeConfig {
        &self.config
    }

    pub(crate) async fn discard_browser(&self, generation: u64) {
        let _guard = self.launch_lock.lock().await;
        let mut slot = self.browser.lock().await;
        clear_if_generation(&mut slot, generation);
    }
}

impl BrowserOwner {
    pub(crate) async fn ensure_browser(&self) -> Result<(u64, Arc<OwnedBrowser>), String> {
        const LAUNCH_TIMEOUT: Duration = Duration::from_secs(120);
        tokio::select! {
            biased;
            _ = self.cancelled() => Err("runtime shut down".into()),
            result = async {
                let _guard = self.launch_lock.lock().await;
                if let Some((generation, browser)) = self.browser.lock().await.as_ref() {
                    return Ok((*generation, browser.clone()));
                }
                tracing::info!("runtime API used; launching isolated headless Chrome ({})", self.config.chrome_path);
                let mut profile = self.profile.lock().await;
                if profile.is_none() {
                    std::fs::create_dir_all(&self.config.user_data_dir).map_err(|e| e.to_string())?;
                    *profile = Some(tempfile::Builder::new().prefix("runtime-").tempdir_in(&self.config.user_data_dir).map_err(|e| e.to_string())?);
                }
                let profile_path = profile.as_ref().unwrap().path().to_path_buf();
                drop(profile);
                let browser = tokio::time::timeout(LAUNCH_TIMEOUT, launch_browser(&self.config, &profile_path))
                    .await
                    .map_err(|_| format!("browser launch timed out after {}s", LAUNCH_TIMEOUT.as_secs()))??;
                let browser = Arc::new(browser);
                let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
                *self.browser.lock().await = Some((generation, browser.clone()));
                Ok((generation, browser))
            } => result,
        }
    }
}

impl ChromePool {
    pub fn new(config: ChromeConfig) -> Result<Arc<Self>, RuntimeError> {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| RuntimeError::Transport(format!("tokio runtime: {e}")))?;
        Ok(Arc::new(Self {
            rt: Some(rt),
            config,
            spaces: StdMutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
        }))
    }

    fn rt(&self) -> &Runtime {
        self.rt.as_ref().expect("runtime present until drop")
    }

    pub fn config(&self) -> &ChromeConfig {
        &self.config
    }

    pub fn registered_spaces(&self) -> usize {
        self.spaces.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    pub fn transport_for(
        self: &Arc<Self>,
        page: SpacePage,
        logs: LogBuffer,
    ) -> SharedChromeTransport {
        self.transport_with_owner(page, logs, BrowserOwner::new(self.config.clone()))
    }

    fn transport_with_owner(
        self: &Arc<Self>,
        page: SpacePage,
        logs: LogBuffer,
        owner: Arc<BrowserOwner>,
    ) -> SharedChromeTransport {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let live = Arc::new(Mutex::new(None));
        let ready = Arc::new(AtomicBool::new(false));
        let trigger = Arc::new(Notify::new());
        let supervisor = self.rt().spawn(supervise_space(
            owner.clone(),
            page.clone(),
            live.clone(),
            ready.clone(),
            logs,
            trigger.clone(),
        ));
        self.spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, Registration { supervisor });
        SharedChromeTransport {
            pool: self.clone(),
            owner,
            id,
            live,
            ready,
            trigger,
            page,
            management: StdMutex::new(()),
        }
    }
}

impl Drop for ChromePool {
    fn drop(&mut self) {
        for (_, reg) in self
            .spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
        {
            reg.supervisor.abort();
        }
        if let Some(rt) = self.rt.take() {
            // The last reference may be released by a cleanup task on this runtime.
            rt.shutdown_background();
        }
    }
}

pub struct SharedChromeTransport {
    pool: Arc<ChromePool>,
    owner: Arc<BrowserOwner>,
    id: u64,
    live: Arc<Mutex<Option<Page>>>,
    ready: Arc<AtomicBool>,
    trigger: Arc<Notify>,
    page: SpacePage,
    management: StdMutex<()>,
}

impl SharedChromeTransport {
    fn on_live_page<T, F, Fut>(&self, timeout: Duration, op: F) -> Result<T, RuntimeError>
    where
        F: FnOnce(Page) -> Fut,
        Fut: std::future::Future<Output = Result<T, RuntimeError>>,
    {
        self.ensure_started();
        self.pool.rt().block_on(async {
            tokio::select! {
                biased;
                _ = self.owner.cancelled() => Err(RuntimeError::NotReady),
                result = tokio::time::timeout(timeout, async {
                    let guard = self.live.lock().await;
                    let page = guard.as_ref().ok_or(RuntimeError::NotReady)?.clone();
                    op(page).await
                }) => result.unwrap_or(Err(RuntimeError::Timeout)),
            }
        })
    }
}

impl ClientTransport for SharedChromeTransport {
    fn eval_js(&self, js: &str, timeout: Duration) -> Result<Value, RuntimeError> {
        self.on_live_page(timeout, |page| async move { eval_on_page(&page, js).await })
    }

    fn capture(
        &self,
        clip: Option<CaptureRect>,
        timeout: Duration,
    ) -> Result<Vec<u8>, RuntimeError> {
        self.on_live_page(
            timeout,
            |page| async move { capture_on_page(&page, clip).await },
        )
    }

    fn wait_ready(&self, timeout: Duration) -> Result<(), RuntimeError> {
        self.ensure_started();
        self.pool.rt().block_on(async {
            tokio::select! {
                biased;
                _ = self.owner.cancelled() => Err(RuntimeError::NotReady),
                result = tokio::time::timeout(timeout, async {
                    while !self.ready.load(Ordering::Relaxed) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }) => result.map_err(|_| RuntimeError::NotReady),
            }
        })
    }

    fn is_ready(&self) -> bool {
        !self.owner.is_stopped() && self.ready.load(Ordering::Relaxed)
    }

    fn ensure_started(&self) {
        if !self.owner.is_stopped() {
            self.trigger.notify_one();
        }
    }

    fn snapshot(&self) -> Option<silverbullet_server::runtime::RuntimeSnapshot> {
        let status = match self.owner.status.load(Ordering::Acquire) {
            1 => "stopping",
            2 => "stopped",
            3 => "stop_failed",
            _ if self.is_ready() => "running",
            _ => "starting",
        };
        let identity = self
            .owner
            .browser
            .blocking_lock()
            .as_ref()
            .and_then(|(_, browser)| browser.identity);
        let profile = self
            .owner
            .profile
            .blocking_lock()
            .as_ref()
            .map(|profile| profile.path().to_path_buf());
        Some(
            self.owner
                .metrics
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .snapshot(status, identity, profile.as_deref()),
        )
    }

    fn stop(&self, retain_profile: bool) -> Result<(), RuntimeError> {
        let _guard = self.management.lock().unwrap_or_else(|e| e.into_inner());
        self.owner.status.store(1, Ordering::Release);
        self.owner.restartable.store(false, Ordering::Release);
        self.owner.stopped.send_replace(true);
        self.ready.store(false, Ordering::Relaxed);
        let reg = self
            .pool
            .spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
        let result = self.pool.rt().block_on(async {
            if let Some(reg) = reg {
                reg.supervisor.abort();
                let _ = reg.supervisor.await;
            }
            self.live.lock().await.take();
            let _guard = self.owner.launch_lock.lock().await;
            let browser = self.owner.browser.lock().await.take();
            if let Some((generation, browser)) = browser {
                match Arc::try_unwrap(browser) {
                    Ok(mut browser) => {
                        if let Err(error) = browser.shutdown(retain_profile).await {
                            *self.owner.browser.lock().await =
                                Some((generation, Arc::new(browser)));
                            return Err(RuntimeError::Transport(error));
                        }
                    }
                    Err(browser) => {
                        *self.owner.browser.lock().await = Some((generation, browser));
                        return Err(RuntimeError::Transport("browser still in use".into()));
                    }
                }
            }
            if !retain_profile {
                let mut profile = self.owner.profile.lock().await;
                if let Some(owned) = profile.as_ref() {
                    std::fs::remove_dir_all(owned.path()).map_err(|e| {
                        RuntimeError::Transport(format!("remove browser profile: {e}"))
                    })?;
                }
                profile.take();
            }
            Ok(())
        });
        self.owner
            .status
            .store(if result.is_ok() { 2 } else { 3 }, Ordering::Release);
        self.owner.restartable.store(
            result.is_ok() && retain_profile && !self.owner.terminal.load(Ordering::Acquire),
            Ordering::Release,
        );
        result
    }

    fn restart(
        &self,
        token: &str,
        logs: LogBuffer,
    ) -> Result<Option<Box<dyn ClientTransport>>, RuntimeError> {
        let _guard = self.management.lock().unwrap_or_else(|e| e.into_inner());
        if self.owner.terminal.load(Ordering::Acquire)
            || !self.owner.restartable.load(Ordering::Acquire)
            || self.owner.transferred.load(Ordering::Acquire)
            || self.owner.browser.blocking_lock().is_some()
        {
            return Err(RuntimeError::Transport(
                "runtime must be stopped before restart".into(),
            ));
        }
        self.owner.transferred.store(true, Ordering::Release);
        let owner = BrowserOwner::new(self.pool.config.clone());
        *owner.profile.blocking_lock() = self.owner.profile.blocking_lock().take();
        let mut page = self.page.clone();
        page.headless_token = token.into();
        Ok(Some(Box::new(
            self.pool.transport_with_owner(page, logs, owner),
        )))
    }

    fn shutdown(&self) {
        self.owner.terminal.store(true, Ordering::Release);
        self.owner.restartable.store(false, Ordering::Release);
        self.owner.status.store(1, Ordering::Release);
        self.owner.stopped.send_replace(true);
        self.ready.store(false, Ordering::Relaxed);
        let reg = self
            .pool
            .spaces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
        let live = self.live.clone();
        let owner = self.owner.clone();
        let pool = self.pool.clone();
        self.pool.rt().spawn(async move {
            if let Some(reg) = reg {
                reg.supervisor.abort();
                let _ = reg.supervisor.await;
            }
            live.lock().await.take();
            let _guard = owner.launch_lock.lock().await;
            if let Some((_, browser)) = owner.browser.lock().await.take() {
                if let Ok(mut browser) = Arc::try_unwrap(browser) {
                    if let Err(error) = browser.shutdown(false).await {
                        owner.status.store(3, Ordering::Release);
                        tracing::error!("{error}");
                        if let Some(profile) = owner.profile.lock().await.take() {
                            let _ = profile.keep();
                        }
                        return;
                    }
                }
            }
            owner.profile.lock().await.take();
            owner.status.store(2, Ordering::Release);
            drop(pool);
        });
    }
}

impl Drop for SharedChromeTransport {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ChromeConfig {
        ChromeConfig {
            chrome_path: "/nonexistent/chrome".into(),
            user_data_dir: "/tmp/sb-pool-test".into(),
            show: false,
            log_console: false,
        }
    }

    fn page(name: &str, url: &str) -> SpacePage {
        SpacePage {
            server_url: url.into(),
            headless_token: "secret".into(),
            cookie_name: format!("silverbullet_headless_{name}"),
        }
    }

    #[test]
    fn terminal_shutdown_cannot_be_undone_by_concurrent_stop() {
        let pool = ChromePool::new(config()).unwrap();
        let transport =
            Arc::new(pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new()));
        let locked = transport.owner.launch_lock.blocking_lock();
        let stopping = transport.clone();
        let task = std::thread::spawn(move || stopping.stop(true));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !transport.owner.is_stopped() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        transport.shutdown();
        drop(locked);
        task.join().unwrap().unwrap();
        assert!(transport.restart("fresh", LogBuffer::new()).is_err());
    }

    #[test]
    fn management_snapshot_does_not_launch_and_stop_is_terminal() {
        let pool = ChromePool::new(config()).unwrap();
        let transport = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        assert_eq!(transport.snapshot().unwrap().status, "starting");
        assert!(transport.owner.browser.blocking_lock().is_none());
        transport.stop(true).unwrap();
        assert_eq!(transport.snapshot().unwrap().status, "stopped");
        assert!(transport.wait_ready(Duration::from_millis(20)).is_err());
        let replacement = transport
            .restart("fresh", LogBuffer::new())
            .unwrap()
            .unwrap();
        assert!(transport.restart("duplicate", LogBuffer::new()).is_err());
        drop(transport);
        assert_eq!(replacement.snapshot().unwrap().status, "starting");
        replacement.stop(false).unwrap();
    }

    #[test]
    fn registers_and_deregisters_each_space() {
        let pool = ChromePool::new(config()).unwrap();
        assert_eq!(pool.registered_spaces(), 0);

        let a = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let b = pool.transport_for(page("b", "http://127.0.0.1:3000/notes"), LogBuffer::new());
        assert_eq!(pool.registered_spaces(), 2);

        drop(a);
        assert_eq!(pool.registered_spaces(), 1);
        drop(b);
        assert_eq!(pool.registered_spaces(), 0);
    }

    #[test]
    fn shutdown_cancels_waiters_and_prevents_relaunch() {
        let pool = ChromePool::new(config()).unwrap();
        let transport =
            Arc::new(pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new()));
        let waiting = transport.clone();
        let waiter = std::thread::spawn(move || waiting.wait_ready(Duration::from_secs(30)));
        let locked = transport.live.blocking_lock();
        let evaluating = transport.clone();
        let eval = std::thread::spawn(move || evaluating.eval_js("1", Duration::from_secs(30)));
        std::thread::sleep(Duration::from_millis(50));
        let start = std::time::Instant::now();
        transport.shutdown();
        transport.shutdown();
        assert!(matches!(
            waiter.join().unwrap(),
            Err(RuntimeError::NotReady)
        ));
        assert!(matches!(eval.join().unwrap(), Err(RuntimeError::NotReady)));
        assert!(start.elapsed() < Duration::from_secs(2));
        drop(locked);
        assert!(!transport.is_ready());
        assert_eq!(pool.registered_spaces(), 0);
        transport.ensure_started();
        assert!(pool
            .rt()
            .block_on(transport.owner.ensure_browser())
            .is_err());
    }

    #[tokio::test]
    async fn shutdown_cancels_a_launch_waiting_for_the_launch_lock() {
        let pool = ChromePool::new(config()).unwrap();
        let transport = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let _guard = transport.owner.launch_lock.lock().await;
        let owner = transport.owner.clone();
        let launch = tokio::spawn(async move { owner.ensure_browser().await });
        tokio::task::yield_now().await;
        transport.shutdown();
        assert!(tokio::time::timeout(Duration::from_secs(1), launch)
            .await
            .unwrap()
            .unwrap()
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn shutdown_kills_a_process_that_has_not_finished_launching() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let pid_file = root.path().join("pid");
        let executable = root.path().join("chrome");
        std::fs::write(
            &executable,
            format!(
                "#!/bin/sh\nprintf '%s' $$ > '{}'\nexec sleep 120\n",
                pid_file.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut config = config();
        config.chrome_path = executable.to_string_lossy().into_owned();
        config.user_data_dir = root.path().join("profiles").to_string_lossy().into_owned();
        let pool = ChromePool::new(config).unwrap();
        let transport = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        transport.ensure_started();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !pid_file.exists() {
            assert!(std::time::Instant::now() < deadline, "launch did not start");
            std::thread::sleep(Duration::from_millis(10));
        }
        let pid = std::fs::read_to_string(pid_file).unwrap();
        transport.shutdown();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::process::Command::new("kill")
            .args(["-0", &pid])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success()
        {
            assert!(
                std::time::Instant::now() < deadline,
                "cancelled launch left process {pid} alive"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            std::fs::read_dir(&pool.config.user_data_dir)
                .unwrap()
                .count(),
            0
        );
        transport.ensure_started();
        assert!(pool
            .rt()
            .block_on(transport.owner.ensure_browser())
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn stop_finishes_cancelling_an_unfinished_launch_before_returning() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let pid_file = root.path().join("pid");
        let executable = root.path().join("chrome");
        std::fs::write(
            &executable,
            format!(
                "#!/bin/sh\nprintf '%s' $$ > '{}'\nexec sleep 120\n",
                pid_file.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut config = config();
        config.chrome_path = executable.to_string_lossy().into_owned();
        config.user_data_dir = root.path().join("profiles").to_string_lossy().into_owned();
        let pool = ChromePool::new(config).unwrap();
        let transport = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        transport.ensure_started();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !pid_file.exists() {
            assert!(std::time::Instant::now() < deadline, "launch did not start");
            std::thread::sleep(Duration::from_millis(10));
        }
        let pid = std::fs::read_to_string(pid_file).unwrap();
        transport.stop(false).unwrap();
        assert!(
            !std::process::Command::new("kill")
                .args(["-0", &pid])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success(),
            "stop returned before launching process exited"
        );
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::process::Command::new("kill")
            .args(["-0", &pid])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success()
        {
            assert!(
                std::time::Instant::now() < deadline,
                "cancelled launch left process {pid} alive"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            std::fs::read_dir(&pool.config.user_data_dir)
                .unwrap()
                .count(),
            0
        );
        transport.ensure_started();
        assert!(pool
            .rt()
            .block_on(transport.owner.ensure_browser())
            .is_err());
    }

    #[test]
    #[ignore = "requires an installed Chrome browser"]
    fn real_chrome_transports_isolate_storage_processes_and_shutdown() {
        use chromiumoxide::cdp::browser_protocol::system_info::GetProcessInfoParams;
        use chromiumoxide::cdp::browser_protocol::target::GetTargetsParams;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let root = tempfile::tempdir().unwrap();
        let mut config = config();
        config.chrome_path = std::env::var("SB_CHROME_PATH")
            .ok()
            .or_else(crate::config::find_chrome)
            .expect("Chrome installed");
        config.user_data_dir = root.path().to_string_lossy().into_owned();
        let pool = ChromePool::new(config).unwrap();
        let listener = pool
            .rt()
            .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
            .unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = pool.rt().spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buffer = [0; 4096];
                    let count = socket.read(&mut buffer).await.unwrap();
                    let request = String::from_utf8_lossy(&buffer[..count]);
                    let cookie = request.lines().find(|line| line.to_ascii_lowercase().starts_with("cookie:")).unwrap_or("");
                    let body = format!("<script>globalThis.sbRuntime = {{ready: true}}; globalThis.receivedCookie = {}</script>", serde_json::to_string(cookie).unwrap());
                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        let logs_a = LogBuffer::new();
        let logs_b = LogBuffer::new();
        let a = Arc::new(pool.transport_for(page("a", &url), logs_a.clone()));
        let b = pool.transport_for(page("a", &url), logs_b.clone());
        pool.rt().block_on(async {
            let (first, second) = tokio::join!(a.owner.ensure_browser(), a.owner.ensure_browser());
            let first = first.unwrap();
            let second = second.unwrap();
            assert_eq!(first.0, second.0);
            assert!(Arc::ptr_eq(&first.1, &second.1));
        });
        a.wait_ready(Duration::from_secs(30)).unwrap();
        b.wait_ready(Duration::from_secs(30)).unwrap();
        pool.rt().block_on(async {
            let slot = a.owner.browser.lock().await;
            let targets = slot
                .as_ref()
                .unwrap()
                .1
                .execute(GetTargetsParams::default())
                .await
                .unwrap();
            assert!(
                targets
                    .result
                    .target_infos
                    .iter()
                    .all(|target| { !target.url.starts_with("chrome://omnibox-popup.") }),
                "headless runtimes must not create unused address-bar renderers"
            );
        });
        let snapshot = b.snapshot().unwrap();
        assert_eq!(snapshot.status, "running");
        assert!(snapshot.memory_bytes.unwrap() > 0);
        assert!(snapshot.disk_bytes.unwrap() > 0);
        assert!(snapshot.cpu_percent.is_none());
        let process_and_profile = |transport: &SharedChromeTransport| {
            pool.rt().block_on(async {
                let slot = transport.owner.browser.lock().await;
                let browser = &slot.as_ref().unwrap().1;
                let processes = browser
                    .execute(GetProcessInfoParams::default())
                    .await
                    .unwrap();
                let pid = processes
                    .result
                    .process_info
                    .iter()
                    .find(|p| p.r#type == "browser")
                    .unwrap()
                    .id;
                (
                    pid,
                    transport
                        .owner
                        .profile
                        .lock()
                        .await
                        .as_ref()
                        .unwrap()
                        .path()
                        .to_path_buf(),
                )
            })
        };
        let (pid_a, profile_a) = process_and_profile(&a);
        let (pid_b, profile_b) = process_and_profile(&b);
        assert_ne!(pid_a, pid_b);
        assert_ne!(profile_a, profile_b);
        a.eval_js("document.cookie = 'session=alpha'; localStorage.setItem('value', 'alpha'); console.log('alpha-runtime'); true", Duration::from_secs(5)).unwrap();
        assert_eq!(
            b.eval_js(
                "[document.cookie, localStorage.getItem('value')]",
                Duration::from_secs(5)
            )
            .unwrap(),
            serde_json::json!(["", null])
        );
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !logs_a
            .query(100, None)
            .iter()
            .any(|entry| entry.text == "alpha-runtime")
        {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!logs_b
            .query(100, None)
            .iter()
            .any(|entry| entry.text == "alpha-runtime"));
        let evaluating = a.clone();
        let eval = std::thread::spawn(move || {
            evaluating.eval_js("new Promise(() => {})", Duration::from_secs(30))
        });
        std::thread::sleep(Duration::from_millis(100));
        let start = std::time::Instant::now();
        a.shutdown();
        assert!(matches!(eval.join().unwrap(), Err(RuntimeError::NotReady)));
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(
            b.eval_js("1 + 1", Duration::from_secs(5)).unwrap(),
            serde_json::json!(2)
        );
        assert_eq!(process_and_profile(&b).0, pid_b);
        assert!(a.wait_ready(Duration::from_secs(5)).is_err());
        a.ensure_started();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while profile_a.exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "shutdown did not remove profile"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        #[cfg(unix)]
        assert!(!std::process::Command::new("kill")
            .args(["-0", &pid_a.to_string()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
        let replacement = pool.transport_for(page("a", &url), LogBuffer::new());
        replacement.wait_ready(Duration::from_secs(30)).unwrap();
        assert_ne!(process_and_profile(&replacement).1, profile_a);
        assert_eq!(
            replacement
                .eval_js(
                    "[document.cookie, localStorage.getItem('value')]",
                    Duration::from_secs(5)
                )
                .unwrap(),
            serde_json::json!(["", null])
        );
        replacement
            .eval_js(
                r#"(async () => {
                    localStorage.setItem('retained', 'yes');
                    const key = await crypto.subtle.generateKey(
                        {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
                    const db = await new Promise((resolve, reject) => {
                        const request = indexedDB.open('retained', 1);
                        request.onupgradeneeded = () => request.result.createObjectStore('values');
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                    await new Promise((resolve, reject) => {
                        const tx = db.transaction('values', 'readwrite');
                        tx.objectStore('values').put({key, bytes: new Uint8Array([1, 2, 3])}, 'state');
                        tx.oncomplete = resolve;
                        tx.onerror = () => reject(tx.error);
                    });
                    db.close();
                    const cache = await caches.open('retained');
                    await cache.put('/retained', new Response('cached'));
                    const root = await navigator.storage.getDirectory();
                    const file = await root.getFileHandle('retained.txt', {create: true});
                    const writer = await file.createWritable();
                    await writer.write('file');
                    await writer.close();
                    return true;
                })()"#,
                Duration::from_secs(5),
            )
            .unwrap();
        let (old_pid, retained_profile) = process_and_profile(&replacement);
        replacement.stop(true).unwrap();
        assert!(retained_profile.exists());
        #[cfg(unix)]
        assert!(!std::process::Command::new("kill")
            .args(["-0", &old_pid.to_string()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
        let resumed = replacement
            .restart("fresh-credential", LogBuffer::new())
            .unwrap()
            .unwrap();
        drop(replacement);
        resumed.wait_ready(Duration::from_secs(30)).unwrap();
        assert_eq!(
            resumed
                .eval_js("localStorage.getItem('retained')", Duration::from_secs(5))
                .unwrap(),
            serde_json::json!("yes")
        );
        assert_eq!(
            resumed.eval_js(r#"(async () => {
                const db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('retained', 1);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                const state = await new Promise((resolve, reject) => {
                    const request = db.transaction('values').objectStore('values').get('state');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
                db.close();
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, state.key, state.bytes);
                const decrypted = await crypto.subtle.decrypt({name: 'AES-GCM', iv}, state.key, encrypted);
                const cache = await caches.open('retained');
                const cached = await (await cache.match('/retained')).text();
                const root = await navigator.storage.getDirectory();
                const file = await (await root.getFileHandle('retained.txt')).getFile();
                return [Array.from(new Uint8Array(decrypted)), state.key.extractable, cached, await file.text()];
            })()"#, Duration::from_secs(5)).unwrap(),
            serde_json::json!([[1, 2, 3], false, "cached", "file"])
        );
        let cookie = resumed
            .eval_js("globalThis.receivedCookie", Duration::from_secs(5))
            .unwrap();
        assert!(cookie
            .as_str()
            .unwrap()
            .contains("silverbullet_headless_a=fresh-credential"));
        assert!(!cookie.as_str().unwrap().contains("secret"));
        resumed.stop(false).unwrap();
        assert!(!retained_profile.exists());
        let held_browser = pool
            .rt()
            .block_on(async { b.owner.browser.lock().await.as_ref().unwrap().1.clone() });
        assert!(b.stop(true).is_err());
        assert_eq!(b.snapshot().unwrap().status, "stop_failed");
        drop(held_browser);
        b.stop(false).unwrap();
        assert_eq!(b.snapshot().unwrap().status, "stopped");
        server.abort();
    }

    #[test]
    fn transports_do_not_share_browser_ownership() {
        let pool = ChromePool::new(config()).unwrap();
        let a = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let b = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        assert!(!Arc::ptr_eq(&a.owner, &b.owner));
    }

    #[test]
    fn rebuilding_a_space_does_not_deregister_its_replacement() {
        let pool = ChromePool::new(config()).unwrap();
        let old = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let new = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        assert_eq!(pool.registered_spaces(), 2);

        drop(old);
        assert_eq!(pool.registered_spaces(), 1);
        drop(new);
        assert_eq!(pool.registered_spaces(), 0);
    }

    #[tokio::test]
    async fn no_browser_is_launched_before_any_runtime_request() {
        let pool = ChromePool::new(config()).unwrap();
        let t = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(t.owner.browser.lock().await.is_none());
        assert!(!t.is_ready());
    }

    #[test]
    fn a_stale_discard_leaves_a_newer_browser_alone() {
        let mut slot = Some((1u64, "browser-1"));
        assert!(!clear_if_generation(&mut slot, 0));
        assert_eq!(slot, Some((1, "browser-1")));
    }

    #[test]
    fn discarding_the_current_generation_clears_the_slot() {
        let mut slot = Some((1u64, "browser-1"));
        assert!(clear_if_generation(&mut slot, 1));
        assert_eq!(slot, None);
    }

    #[tokio::test]
    async fn discard_browser_retires_only_the_generation_it_was_given() {
        let owner = BrowserOwner::<&'static str>::new(config());
        *owner.browser.lock().await = Some((1, Arc::new("browser-1")));

        // A supervisor that watched generation 0 die, arriving after somebody
        // else already launched generation 1, must leave it alone.
        owner.discard_browser(0).await;
        assert!(
            owner.browser.lock().await.is_some(),
            "a stale generation must not retire the live browser"
        );

        owner.discard_browser(1).await;
        assert!(
            owner.browser.lock().await.is_none(),
            "the current generation must clear the slot"
        );
    }

    #[test]
    fn discarding_an_empty_slot_is_a_no_op() {
        let mut slot: Option<(u64, &str)> = None;
        assert!(!clear_if_generation(&mut slot, 0));
        assert_eq!(slot, None);
    }

    #[test]
    fn generations_are_monotonic() {
        let owner = BrowserOwner::<&'static str>::new(config());
        let first = owner.next_generation.fetch_add(1, Ordering::Relaxed);
        let second = owner.next_generation.fetch_add(1, Ordering::Relaxed);
        assert_eq!((first, second), (0, 1));
    }

    #[tokio::test]
    async fn a_failed_launch_leaves_the_slot_empty() {
        let owner = BrowserOwner::new(config());
        assert!(owner.ensure_browser().await.is_err());
        assert!(owner.browser.lock().await.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dropping_the_pool_inside_an_async_context_does_not_panic() {
        let pool = ChromePool::new(config()).unwrap();
        let t = pool.transport_for(page("a", "http://127.0.0.1:3000"), LogBuffer::new());
        let weak = Arc::downgrade(&pool);
        drop(t);
        drop(pool);
        tokio::time::timeout(Duration::from_secs(2), async {
            while weak.upgrade().is_some() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("cleanup must release the pool");
    }
}
