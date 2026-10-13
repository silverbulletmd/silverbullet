//! Resumable, checksum-verified model downloads.
//!
//! # Install guarantee (relied on by the embedder's mmap SAFETY comment)
//!
//! A model file only ever appears at its final path through `temp file (<name>.partial) -> exact
//! size and sha256 check -> fsync -> atomic rename`, and an installed file is never opened for
//! writing, truncated or renamed over again by this store; the only way it disappears is
//! `remove`, which deletes the whole model directory. A reader that memory-maps an installed
//! file therefore never observes it changing underneath the mapping (on Unix, unlinking keeps
//! the mapped inode alive).
//!
//! A failed download leaves its `.partial` for the next `ensure` to resume, except when the
//! bytes are known bad (checksum or size mismatch): that partial is deleted, because resuming
//! it would fail the same way forever.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use super::catalog::{ModelFile, ModelSpec};

const HF_BASE: &str = "https://huggingface.co";
const MANIFEST: &str = "manifest.json";

/// Where a model is in its download life cycle.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum DownloadState {
    Missing,
    Downloading { done: u64, total: u64 },
    Ready,
    Failed { message: String },
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("checksum mismatch for {0}")]
    Checksum(String),
    #[error("size mismatch for {0}")]
    Size(String),
    #[error("download cancelled")]
    Cancelled,
    #[error("{0}")]
    Http(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// On any exit from `ensure` (including the future being dropped): unregister the cancel token
/// and clear a leftover `Downloading` state. `Failed` is kept for `state` to report.
struct Cleanup {
    states: Arc<Mutex<HashMap<String, DownloadState>>>,
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
    key: String,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        self.active.lock().unwrap().remove(&self.key);
        let mut states = self.states.lock().unwrap();
        if matches!(
            states.get(&self.key),
            Some(DownloadState::Downloading { .. })
        ) {
            states.remove(&self.key);
        }
    }
}

type Locks = Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;

/// Model files on disk under `<data>/search/models` plus the in-memory download progress.
pub struct ModelStore {
    root: PathBuf,
    client: reqwest::Client,
    base: String,
    states: Arc<Mutex<HashMap<String, DownloadState>>>,
    locks: Arc<Locks>,
    /// Cancellation of the in-flight `ensure` per model, so `remove` can stop it first.
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl ModelStore {
    pub fn new(root: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(60))
            .build()
            .expect("reqwest client");
        Self {
            root,
            client,
            base: HF_BASE.to_string(),
            states: Arc::default(),
            locks: Arc::default(),
            active: Arc::default(),
        }
    }

    /// Test-only: replaces `https://huggingface.co` in model URLs.
    #[cfg(any(test, debug_assertions))]
    pub fn with_base_url(mut self, base: String) -> Self {
        self.base = base.trim_end_matches('/').to_string();
        self
    }

    /// `root/<id>@<revision>`.
    pub fn dir(&self, spec: &ModelSpec) -> PathBuf {
        self.root.join(spec.dir_name())
    }

    /// The manifest matches the spec (id, revision, files) and every file exists with its
    /// pinned size.
    pub fn is_ready(&self, spec: &ModelSpec) -> bool {
        let dir = self.dir(spec);
        let Ok(raw) = std::fs::read(dir.join(MANIFEST)) else {
            return false;
        };
        let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(&raw) else {
            return false;
        };
        if manifest != manifest_json(spec) {
            return false;
        }
        spec.files.iter().all(|f| {
            std::fs::metadata(dir.join(f.name)).is_ok_and(|m| m.is_file() && m.len() == f.size)
        })
    }

    pub fn state(&self, spec: &ModelSpec) -> DownloadState {
        let tracked = self.states.lock().unwrap().get(&spec.dir_name()).cloned();
        match tracked {
            Some(s @ (DownloadState::Downloading { .. } | DownloadState::Failed { .. })) => s,
            _ if self.is_ready(spec) => DownloadState::Ready,
            _ => DownloadState::Missing,
        }
    }

    /// Cancels an in-flight `ensure` for this model, waits for it to stop, then deletes the model
    /// directory (installed files and partials). The state ends `Missing`.
    pub async fn remove(&self, spec: &ModelSpec) -> std::io::Result<()> {
        let key = spec.dir_name();
        if let Some(token) = self.active.lock().unwrap().get(&key) {
            token.cancel();
        }
        let lock = self.lock_for(&key);
        let _guard = lock.lock().await;
        let result = match tokio::fs::remove_dir_all(self.dir(spec)).await {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        };
        self.states.lock().unwrap().remove(&key);
        result
    }

    fn lock_for(&self, key: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks
            .lock()
            .unwrap()
            .entry(key.to_string())
            .or_default()
            .clone()
    }

    fn set_state(&self, spec: &ModelSpec, state: DownloadState) {
        self.states.lock().unwrap().insert(spec.dir_name(), state);
    }

    fn url(&self, spec: &ModelSpec, file: &ModelFile) -> String {
        spec.url(file).replacen(HF_BASE, &self.base, 1)
    }

    /// Idempotent. Returns the model directory once every file is verified, or on error or
    /// cancel. Progress is readable through `state` meanwhile. Concurrent calls for the same
    /// model are serialised; later ones find it ready. If the future is dropped mid-download the
    /// state falls back to what is on disk.
    pub async fn ensure(
        &self,
        spec: &ModelSpec,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, DownloadError> {
        let key = spec.dir_name();
        let lock = self.lock_for(&key);
        let _lock = tokio::select! {
            _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
            guard = lock.lock() => guard,
        };
        if self.is_ready(spec) {
            self.states.lock().unwrap().remove(&key);
            return Ok(self.dir(spec));
        }
        // `remove` cancels this child token; the caller's token is honoured through it too.
        let cancel = cancel.child_token();
        self.active
            .lock()
            .unwrap()
            .insert(key.clone(), cancel.clone());
        self.set_state(
            spec,
            DownloadState::Downloading {
                done: 0,
                total: spec.download_bytes(),
            },
        );
        let _cleanup = Cleanup {
            states: self.states.clone(),
            active: self.active.clone(),
            key,
        };
        match self.fetch_all(spec, &cancel).await {
            Ok(dir) => Ok(dir),
            Err(DownloadError::Cancelled) => Err(DownloadError::Cancelled),
            Err(e) => {
                self.set_state(
                    spec,
                    DownloadState::Failed {
                        message: e.to_string(),
                    },
                );
                Err(e)
            }
        }
    }

    async fn fetch_all(
        &self,
        spec: &ModelSpec,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, DownloadError> {
        let dir = self.dir(spec);
        create_private_dir(&self.root).await?;
        create_private_dir(&dir).await?;
        let total = spec.download_bytes();
        let mut base_done = 0u64;
        for file in &spec.files {
            let final_path = dir.join(file.name);
            let installed = tokio::fs::metadata(&final_path)
                .await
                .is_ok_and(|m| m.is_file() && m.len() == file.size);
            if !installed {
                self.fetch_file(spec, file, &dir, base_done, total, cancel)
                    .await?;
            }
            base_done += file.size;
            self.set_state(
                spec,
                DownloadState::Downloading {
                    done: base_done,
                    total,
                },
            );
        }
        write_manifest(spec, &dir).await?;
        Ok(dir)
    }

    async fn fetch_file(
        &self,
        spec: &ModelSpec,
        file: &ModelFile,
        dir: &Path,
        base_done: u64,
        total: u64,
        cancel: &CancellationToken,
    ) -> Result<(), DownloadError> {
        let name = file.name;
        let partial = dir.join(format!("{name}.partial"));
        let progress = |done: u64| {
            self.set_state(
                spec,
                DownloadState::Downloading {
                    done: base_done + done,
                    total,
                },
            );
        };

        let mut have = match tokio::fs::metadata(&partial).await {
            Ok(m) if m.len() <= file.size => m.len(),
            Ok(_) => 0,
            Err(_) => 0,
        };
        let mut hasher = Sha256::new();
        let response = if have == file.size {
            // Complete prefix from an earlier run; only verification is left.
            None
        } else if have > 0 {
            match self.resume_request(spec, file, have, cancel).await? {
                Resumed::Append(resp) => Some(resp),
                Resumed::Fresh(resp) => {
                    have = 0;
                    Some(resp)
                }
                Resumed::Refetch => {
                    have = 0;
                    Some(self.fetch_full(spec, file, cancel).await?)
                }
            }
        } else {
            Some(self.fetch_full(spec, file, cancel).await?)
        };

        // Open (and re-hash the kept prefix) or start over.
        let mut out = if have > 0 {
            hash_prefix(&partial, have, &mut hasher).await?;
            open_private(&partial, false).await?
        } else {
            open_private(&partial, true).await?
        };
        let mut written = have;
        progress(written);

        if let Some(mut resp) = response {
            loop {
                let chunk = tokio::select! {
                    _ = cancel.cancelled() => {
                        out.flush().await?;
                        return Err(DownloadError::Cancelled);
                    }
                    chunk = resp.chunk() => chunk,
                };
                let chunk = match chunk {
                    Ok(Some(c)) => c,
                    Ok(None) => break,
                    Err(e) => {
                        out.flush().await?;
                        return Err(DownloadError::Http(format!(
                            "download of {name} failed: {e}"
                        )));
                    }
                };
                written += chunk.len() as u64;
                if written > file.size {
                    drop(out);
                    let _ = tokio::fs::remove_file(&partial).await;
                    return Err(DownloadError::Size(name.to_string()));
                }
                hasher.update(&chunk);
                out.write_all(&chunk).await?;
                progress(written);
            }
        }
        out.flush().await?;

        if written != file.size {
            // Stream ended early: keep the partial for the next resume.
            return Err(DownloadError::Http(format!(
                "download of {name} ended after {written} of {} bytes",
                file.size
            )));
        }
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if !digest.eq_ignore_ascii_case(file.sha256) {
            drop(out);
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(DownloadError::Checksum(name.to_string()));
        }
        out.sync_all().await?;
        drop(out);
        tokio::fs::rename(&partial, dir.join(name)).await?;
        sync_dir(dir).await;
        Ok(())
    }

    async fn get(
        &self,
        spec: &ModelSpec,
        file: &ModelFile,
        from: Option<u64>,
        cancel: &CancellationToken,
    ) -> Result<reqwest::Response, DownloadError> {
        let mut req = self.client.get(self.url(spec, file));
        if let Some(from) = from {
            req = req.header(reqwest::header::RANGE, format!("bytes={from}-"));
        }
        tokio::select! {
            _ = cancel.cancelled() => Err(DownloadError::Cancelled),
            sent = req.send() => sent.map_err(|e| {
                DownloadError::Http(format!("request for {} failed: {e}", file.name))
            }),
        }
    }

    async fn fetch_full(
        &self,
        spec: &ModelSpec,
        file: &ModelFile,
        cancel: &CancellationToken,
    ) -> Result<reqwest::Response, DownloadError> {
        let resp = self.get(spec, file, None, cancel).await?;
        if resp.status() != reqwest::StatusCode::OK {
            return Err(DownloadError::Http(format!(
                "unexpected status {} for {}",
                resp.status(),
                file.name
            )));
        }
        Ok(resp)
    }

    /// Ranged request. Only a 206 whose `Content-Range` starts at `have` may be appended; a plain
    /// 200 (Range ignored) is a full body to restart from; anything else is re-requested whole.
    async fn resume_request(
        &self,
        spec: &ModelSpec,
        file: &ModelFile,
        have: u64,
        cancel: &CancellationToken,
    ) -> Result<Resumed, DownloadError> {
        let resp = self.get(spec, file, Some(have), cancel).await?;
        let status = resp.status();
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            let start = resp
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("bytes "))
                .and_then(|v| v.split('-').next())
                .and_then(|v| v.trim().parse::<u64>().ok());
            return Ok(if start == Some(have) {
                Resumed::Append(resp)
            } else {
                Resumed::Refetch
            });
        }
        if status == reqwest::StatusCode::OK {
            return Ok(Resumed::Fresh(resp));
        }
        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            return Ok(Resumed::Refetch);
        }
        Err(DownloadError::Http(format!(
            "unexpected status {status} for {}",
            file.name
        )))
    }
}

enum Resumed {
    Append(reqwest::Response),
    Fresh(reqwest::Response),
    Refetch,
}

async fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = tokio::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(dir).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).await?;
    }
    Ok(())
}

async fn open_private(path: &Path, truncate: bool) -> std::io::Result<tokio::fs::File> {
    let mut opts = tokio::fs::OpenOptions::new();
    opts.write(true);
    if truncate {
        opts.create(true).truncate(true);
    } else {
        opts.append(true);
    }
    #[cfg(unix)]
    opts.mode(0o600);
    opts.open(path).await
}

async fn hash_prefix(path: &Path, len: u64, hasher: &mut Sha256) -> std::io::Result<()> {
    let mut file = tokio::fs::File::open(path).await?.take(len);
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        hasher.update(&buf[..n]);
    }
}

/// Best effort: make the rename durable.
async fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = tokio::fs::File::open(dir).await {
        let _ = d.sync_all().await;
    }
    #[cfg(not(unix))]
    let _ = dir;
}

fn manifest_json(spec: &ModelSpec) -> serde_json::Value {
    serde_json::json!({
        "id": spec.id,
        "revision": spec.revision,
        "files": spec.files.iter().map(|f| serde_json::json!({
            "name": f.name, "size": f.size, "sha256": f.sha256,
        })).collect::<Vec<_>>(),
    })
}

async fn write_manifest(spec: &ModelSpec, dir: &Path) -> std::io::Result<()> {
    let manifest = manifest_json(spec);
    let tmp = dir.join(format!("{MANIFEST}.partial"));
    let mut out = open_private(&tmp, true).await?;
    out.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())
        .await?;
    out.sync_all().await?;
    drop(out);
    tokio::fs::rename(&tmp, dir.join(MANIFEST)).await?;
    sync_dir(dir).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use tokio::io::AsyncReadExt;
    use tokio::net::{TcpListener, TcpStream};

    use super::super::test_model::write_tiny_model;
    use super::*;

    /// Minimal HTTP/1.1 file server: honours `Range: bytes=N-`, counts requests, and can ignore
    /// ranges, drop the connection part-way, corrupt or lengthen bodies, and send slowly.
    /// (Raw sockets rather than axum: a mid-body connection kill needs a streamed body, and the
    /// crate has no futures stream dependency to build one.)
    #[derive(Default)]
    struct Server {
        files: HashMap<String, Vec<u8>>,
        requests: AtomicUsize,
        ranges: Mutex<Vec<Option<u64>>>,
        ignore_range: AtomicBool,
        cut_next: AtomicBool,
        delay_ms: AtomicUsize,
        wrong_range: AtomicBool,
    }

    async fn serve(conn: TcpStream, server: Arc<Server>) {
        let mut conn = conn;
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            if conn.read_exact(&mut byte).await.is_err() {
                return;
            }
            head.push(byte[0]);
        }
        let head = String::from_utf8_lossy(&head).to_string();
        let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
        let name = path.rsplit('/').next().unwrap_or("").to_string();
        let range = head.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.eq_ignore_ascii_case("range").then(|| {
                v.trim()
                    .strip_prefix("bytes=")?
                    .strip_suffix('-')?
                    .parse::<u64>()
                    .ok()
            })?
        });
        server.requests.fetch_add(1, Ordering::SeqCst);
        server.ranges.lock().unwrap().push(range);
        let Some(body) = server.files.get(&name) else {
            let _ = conn
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            return;
        };
        let ignore = server.ignore_range.load(Ordering::SeqCst);
        let (status, start) = match range {
            Some(r) if !ignore => ("206 Partial Content", r as usize),
            _ => ("200 OK", 0),
        };
        let slice = &body[start..];
        let mut resp = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            slice.len()
        );
        if status.starts_with("206") {
            let claimed = start + usize::from(server.wrong_range.load(Ordering::SeqCst));
            resp += &format!(
                "Content-Range: bytes {claimed}-{}/{}\r\n",
                body.len() - 1,
                body.len()
            );
        }
        resp += "\r\n";
        let _ = conn.write_all(resp.as_bytes()).await;
        let cut = range.is_none() && server.cut_next.swap(false, Ordering::SeqCst);
        let end = if cut {
            slice.len() * 4 / 10
        } else {
            slice.len()
        };
        let delay = server.delay_ms.load(Ordering::SeqCst) as u64;
        for piece in slice[..end].chunks(512) {
            if conn.write_all(piece).await.is_err() {
                return;
            }
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }
        let _ = conn.shutdown().await;
    }

    async fn start(server: Arc<Server>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((conn, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(serve(conn, server.clone()));
            }
        });
        format!("http://{addr}")
    }

    struct Fixture {
        _tmp: tempfile::TempDir,
        server: Arc<Server>,
        store: ModelStore,
        spec: ModelSpec,
    }

    /// `edit` can tamper with the served bytes before the server starts.
    async fn fixture(edit: impl FnOnce(&mut HashMap<String, Vec<u8>>)) -> Fixture {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let spec = write_tiny_model(&src, 7);
        let mut files = HashMap::new();
        for f in &spec.files {
            files.insert(f.name.to_string(), std::fs::read(src.join(f.name)).unwrap());
        }
        edit(&mut files);
        let server = Arc::new(Server {
            files,
            ..Server::default()
        });
        let base = start(server.clone()).await;
        let store = ModelStore::new(tmp.path().join("models")).with_base_url(base);
        Fixture {
            _tmp: tmp,
            server,
            store,
            spec,
        }
    }

    fn assert_installed(fx: &Fixture) {
        let dir = fx.store.dir(&fx.spec);
        for f in &fx.spec.files {
            let bytes = std::fs::read(dir.join(f.name)).unwrap();
            assert_eq!(bytes.len() as u64, f.size);
            let src = fx._tmp.path().join("src").join(f.name);
            assert_eq!(bytes, std::fs::read(src).unwrap());
        }
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join(MANIFEST)).unwrap()).unwrap();
        assert_eq!(manifest["id"], fx.spec.id);
        assert_eq!(manifest["revision"], fx.spec.revision);
        assert_eq!(
            manifest["files"].as_array().unwrap().len(),
            fx.spec.files.len()
        );
        assert!(fx.store.is_ready(&fx.spec));
        assert_eq!(fx.store.state(&fx.spec), DownloadState::Ready);
    }

    fn partial(fx: &Fixture, name: &str) -> PathBuf {
        fx.store.dir(&fx.spec).join(format!("{name}.partial"))
    }

    #[tokio::test]
    async fn fresh_download_installs_files_and_manifest() {
        let fx = fixture(|_| {}).await;
        assert_eq!(fx.store.state(&fx.spec), DownloadState::Missing);
        let dir = fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(dir, fx.store.dir(&fx.spec));
        assert_installed(&fx);
        assert!(!partial(&fx, "model.safetensors").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: PathBuf| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(dir.clone()), 0o700);
            assert_eq!(mode(dir.join("model.safetensors")), 0o600);
            assert_eq!(mode(dir.join(MANIFEST)), 0o600);
        }
    }

    #[tokio::test]
    async fn resumes_with_range_after_dropped_connection() {
        let fx = fixture(|_| {}).await;
        fx.server.cut_next.store(true, Ordering::SeqCst);
        let err = fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(matches!(err, DownloadError::Http(_)), "{err:?}");
        assert!(matches!(
            fx.store.state(&fx.spec),
            DownloadState::Failed { .. }
        ));
        let kept = std::fs::metadata(partial(&fx, "model.safetensors"))
            .unwrap()
            .len();
        assert!(kept > 0 && kept < fx.spec.files[0].size);
        assert!(!fx.store.dir(&fx.spec).join("model.safetensors").exists());

        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert!(fx.server.ranges.lock().unwrap().contains(&Some(kept)));
        assert_installed(&fx);
    }

    #[tokio::test]
    async fn server_ignoring_range_still_ends_correct() {
        let fx = fixture(|_| {}).await;
        fx.server.cut_next.store(true, Ordering::SeqCst);
        assert!(fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .is_err());
        fx.server.ignore_range.store(true, Ordering::SeqCst);
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert_installed(&fx);
    }

    #[tokio::test]
    async fn corrupted_byte_is_checksum_error() {
        let fx = fixture(|files| files.get_mut("tokenizer.json").unwrap()[3] ^= 0xff).await;
        let err = fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(
            matches!(&err, DownloadError::Checksum(n) if n == "tokenizer.json"),
            "{err:?}"
        );
        let dir = fx.store.dir(&fx.spec);
        assert!(!dir.join("tokenizer.json").exists());
        assert!(!partial(&fx, "tokenizer.json").exists());
        assert!(!dir.join(MANIFEST).exists());
        assert!(!fx.store.is_ready(&fx.spec));
        assert!(matches!(
            fx.store.state(&fx.spec),
            DownloadState::Failed { .. }
        ));
    }

    #[tokio::test]
    async fn too_long_body_is_size_error() {
        let fx = fixture(|files| files.get_mut("config.json").unwrap().push(b' ')).await;
        let err = fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(
            matches!(&err, DownloadError::Size(n) if n == "config.json"),
            "{err:?}"
        );
        assert!(!fx.store.dir(&fx.spec).join("config.json").exists());
    }

    #[tokio::test]
    async fn cancel_mid_file_leaves_resumable_partial() {
        let fx = fixture(|_| {}).await;
        fx.server.delay_ms.store(10, Ordering::SeqCst);
        let cancel = CancellationToken::new();
        let canceller = cancel.clone();
        let spec = fx.spec.clone();
        let progress = async {
            loop {
                if let DownloadState::Downloading { done, .. } = fx.store.state(&spec) {
                    if done > 0 {
                        canceller.cancel();
                        return;
                    }
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        };
        let (res, _) = tokio::join!(fx.store.ensure(&fx.spec, &cancel), progress);
        assert!(matches!(res, Err(DownloadError::Cancelled)), "{res:?}");
        assert_ne!(fx.store.state(&fx.spec), DownloadState::Ready);
        let kept = std::fs::metadata(partial(&fx, "model.safetensors"))
            .unwrap()
            .len();
        assert!(kept > 0 && kept < fx.spec.files[0].size);

        fx.server.delay_ms.store(0, Ordering::SeqCst);
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert!(fx.server.ranges.lock().unwrap().contains(&Some(kept)));
        assert_installed(&fx);
    }

    #[tokio::test]
    async fn ready_model_makes_no_requests() {
        let fx = fixture(|_| {}).await;
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        let before = fx.server.requests.load(Ordering::SeqCst);
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(fx.server.requests.load(Ordering::SeqCst), before);
    }

    #[tokio::test]
    async fn remove_deletes_the_directory() {
        let fx = fixture(|_| {}).await;
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        fx.store.remove(&fx.spec).await.unwrap();
        assert!(!fx.store.dir(&fx.spec).exists());
        assert_eq!(fx.store.state(&fx.spec), DownloadState::Missing);
        fx.store.remove(&fx.spec).await.unwrap();
    }

    #[tokio::test]
    async fn wrong_content_range_start_refetches_whole_file() {
        let fx = fixture(|_| {}).await;
        fx.server.cut_next.store(true, Ordering::SeqCst);
        assert!(fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .is_err());
        fx.server.wrong_range.store(true, Ordering::SeqCst);
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        let ranges = fx.server.ranges.lock().unwrap().clone();
        assert!(ranges[1].is_some(), "{ranges:?}");
        assert_eq!(ranges[2], None, "{ranges:?}");
        assert_installed(&fx);
    }

    #[tokio::test]
    async fn corrupt_partial_prefix_fails_then_retries_clean() {
        let fx = fixture(|_| {}).await;
        fx.server.cut_next.store(true, Ordering::SeqCst);
        assert!(fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .is_err());
        let p = partial(&fx, "model.safetensors");
        let mut bytes = std::fs::read(&p).unwrap();
        bytes[0] ^= 0xff;
        std::fs::write(&p, bytes).unwrap();
        let err = fx
            .store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap_err();
        assert!(matches!(err, DownloadError::Checksum(_)), "{err:?}");
        assert!(!p.exists());
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert_installed(&fx);
    }

    /// A partial that already has every byte is verified and installed without any request for
    /// that file (no zero-length Range, no HEAD).
    #[tokio::test]
    async fn complete_partial_is_verified_without_fetching() {
        let fx = fixture(|_| {}).await;
        std::fs::create_dir_all(fx.store.dir(&fx.spec)).unwrap();
        let src = fx._tmp.path().join("src/model.safetensors");
        std::fs::copy(src, partial(&fx, "model.safetensors")).unwrap();
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(
            fx.server.requests.load(Ordering::SeqCst),
            fx.spec.files.len() - 1
        );
        assert_installed(&fx);
    }

    #[tokio::test]
    async fn concurrent_ensure_downloads_once() {
        let fx = fixture(|_| {}).await;
        fx.server.delay_ms.store(1, Ordering::SeqCst);
        let t = CancellationToken::new();
        let (a, b) = tokio::join!(fx.store.ensure(&fx.spec, &t), fx.store.ensure(&fx.spec, &t));
        a.unwrap();
        b.unwrap();
        assert_eq!(
            fx.server.requests.load(Ordering::SeqCst),
            fx.spec.files.len()
        );
        assert_installed(&fx);
    }

    #[tokio::test]
    async fn remove_during_ensure_cancels_and_ends_missing() {
        let fx = fixture(|_| {}).await;
        fx.server.delay_ms.store(10, Ordering::SeqCst);
        let t = CancellationToken::new();
        let remover = async {
            loop {
                if matches!(fx.store.state(&fx.spec), DownloadState::Downloading { done, .. } if done > 0)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
            fx.store.remove(&fx.spec).await.unwrap();
        };
        let (res, ()) = tokio::join!(fx.store.ensure(&fx.spec, &t), remover);
        assert!(matches!(res, Err(DownloadError::Cancelled)), "{res:?}");
        assert!(!fx.store.dir(&fx.spec).exists());
        assert_eq!(fx.store.state(&fx.spec), DownloadState::Missing);
    }

    #[tokio::test]
    async fn dropped_ensure_does_not_stick_at_downloading() {
        let fx = fixture(|_| {}).await;
        fx.server.delay_ms.store(10, Ordering::SeqCst);
        let t = CancellationToken::new();
        let r =
            tokio::time::timeout(Duration::from_millis(80), fx.store.ensure(&fx.spec, &t)).await;
        assert!(r.is_err());
        assert_eq!(fx.store.state(&fx.spec), DownloadState::Missing);
    }

    #[tokio::test]
    async fn stale_manifest_is_not_ready() {
        let fx = fixture(|_| {}).await;
        fx.store
            .ensure(&fx.spec, &CancellationToken::new())
            .await
            .unwrap();
        std::fs::write(fx.store.dir(&fx.spec).join(MANIFEST), b"{}").unwrap();
        assert!(!fx.store.is_ready(&fx.spec));
    }
}
