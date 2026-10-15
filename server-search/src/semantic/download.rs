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
use super::fs_private;

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

/// An offered model with a directory in the store.
#[derive(Debug, Clone)]
pub struct StoredModel {
    pub spec: &'static ModelSpec,
    /// The files in its directory, partial downloads included.
    pub bytes: u64,
    /// Every file is installed and verified ([`ModelStore::is_ready`]).
    pub complete: bool,
}

/// One model's download bookkeeping.
#[derive(Default)]
struct Slot {
    /// Serialises `ensure` and `remove` for the model.
    turn: tokio::sync::Mutex<()>,
    /// The running download's progress, or the last failure; `None` means
    /// "what is on disk".
    state: Mutex<Option<DownloadState>>,
    /// Cancels the running `ensure`, so `remove` can stop it first.
    cancel: Mutex<Option<CancellationToken>>,
}

impl Slot {
    fn set(&self, state: DownloadState) {
        *self.state.lock().unwrap() = Some(state);
    }
}

/// On any exit from `ensure` (also when its future is dropped): forgets the
/// cancel token and a leftover `Downloading` state. `Failed` stays for
/// `state` to report.
struct Running(Arc<Slot>);

impl Drop for Running {
    fn drop(&mut self) {
        self.0.cancel.lock().unwrap().take();
        let mut state = self.0.state.lock().unwrap();
        if matches!(*state, Some(DownloadState::Downloading { .. })) {
            *state = None;
        }
    }
}

/// Model files on disk under `<data>/search/models` plus the in-memory download progress.
pub struct ModelStore {
    root: PathBuf,
    client: reqwest::Client,
    base: String,
    slots: Mutex<HashMap<String, Arc<Slot>>>,
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
            slots: Mutex::default(),
        }
    }

    /// Test-only: replaces `https://huggingface.co` in model URLs.
    #[cfg(any(test, debug_assertions, feature = "test-model"))]
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

    /// The offered models (see [`super::catalog::offered`]) that have a
    /// directory in the store, in offered order. Other directories (another
    /// revision, an unknown model) aren't listed.
    pub fn stored(&self) -> Vec<StoredModel> {
        super::catalog::offered()
            .into_iter()
            .filter_map(|spec| {
                let entries = std::fs::read_dir(self.dir(spec)).ok()?;
                let bytes = entries
                    .flatten()
                    .filter_map(|e| e.metadata().ok())
                    .filter(|m| m.is_file())
                    .map(|m| m.len())
                    .sum();
                Some(StoredModel {
                    spec,
                    bytes,
                    complete: self.is_ready(spec),
                })
            })
            .collect()
    }

    fn slot(&self, spec: &ModelSpec) -> Arc<Slot> {
        self.slots
            .lock()
            .unwrap()
            .entry(spec.dir_name())
            .or_default()
            .clone()
    }

    pub fn state(&self, spec: &ModelSpec) -> DownloadState {
        let tracked = self.slot(spec).state.lock().unwrap().clone();
        match tracked {
            Some(s @ (DownloadState::Downloading { .. } | DownloadState::Failed { .. })) => s,
            _ if self.is_ready(spec) => DownloadState::Ready,
            _ => DownloadState::Missing,
        }
    }

    /// Cancels an in-flight `ensure` for this model, waits for it to stop, then deletes the model
    /// directory (installed files and partials). The state ends `Missing`.
    pub async fn remove(&self, spec: &ModelSpec) -> std::io::Result<()> {
        let slot = self.slot(spec);
        if let Some(token) = slot.cancel.lock().unwrap().as_ref() {
            token.cancel();
        }
        let _turn = slot.turn.lock().await;
        let result = match tokio::fs::remove_dir_all(self.dir(spec)).await {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            other => other,
        };
        *slot.state.lock().unwrap() = None;
        result
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
        let slot = self.slot(spec);
        let _turn = tokio::select! {
            _ = cancel.cancelled() => return Err(DownloadError::Cancelled),
            turn = slot.turn.lock() => turn,
        };
        if self.is_ready(spec) {
            *slot.state.lock().unwrap() = None;
            return Ok(self.dir(spec));
        }
        // `remove` cancels this child token; the caller's token is honoured through it too.
        let cancel = cancel.child_token();
        *slot.cancel.lock().unwrap() = Some(cancel.clone());
        slot.set(DownloadState::Downloading {
            done: 0,
            total: spec.download_bytes(),
        });
        let _running = Running(slot.clone());
        match self.fetch_all(spec, &slot, &cancel).await {
            Ok(dir) => Ok(dir),
            Err(DownloadError::Cancelled) => Err(DownloadError::Cancelled),
            Err(e) => {
                slot.set(DownloadState::Failed {
                    message: e.to_string(),
                });
                Err(e)
            }
        }
    }

    async fn fetch_all(
        &self,
        spec: &ModelSpec,
        slot: &Slot,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, DownloadError> {
        let dir = self.dir(spec);
        fs_private::create_dir_async(&self.root).await?;
        fs_private::create_dir_async(&dir).await?;
        let total = spec.download_bytes();
        let mut base_done = 0u64;
        for file in &spec.files {
            let final_path = dir.join(file.name);
            let installed = tokio::fs::metadata(&final_path)
                .await
                .is_ok_and(|m| m.is_file() && m.len() == file.size);
            if !installed {
                self.fetch_file(spec, slot, file, &dir, base_done, total, cancel)
                    .await?;
            }
            base_done += file.size;
            slot.set(DownloadState::Downloading {
                done: base_done,
                total,
            });
        }
        write_manifest(spec, &dir).await?;
        Ok(dir)
    }

    /// Downloads one file into `<name>.partial` (resuming it when the server
    /// allows), verifies it and installs it.
    #[allow(clippy::too_many_arguments)]
    async fn fetch_file(
        &self,
        spec: &ModelSpec,
        slot: &Slot,
        file: &ModelFile,
        dir: &Path,
        base_done: u64,
        total: u64,
        cancel: &CancellationToken,
    ) -> Result<(), DownloadError> {
        let partial = dir.join(format!("{}.partial", file.name));
        let progress = |done: u64| {
            slot.set(DownloadState::Downloading {
                done: base_done + done,
                total,
            })
        };
        let (mut out, mut hasher, have, response) =
            self.open_partial(spec, file, &partial, cancel).await?;
        progress(have);
        let written = match response {
            None => have,
            Some(resp) => {
                match stream_into(resp, &mut out, &mut hasher, have, file, &progress, cancel).await
                {
                    Ok(written) => written,
                    Err(e @ DownloadError::Size(_)) => {
                        drop(out);
                        let _ = tokio::fs::remove_file(&partial).await;
                        return Err(e);
                    }
                    Err(e) => return Err(e),
                }
            }
        };
        install(out, hasher, written, file, &partial, dir).await
    }

    /// The partial file, opened for appending (its kept prefix re-hashed) or
    /// truncated, its length, and the response to stream into it; no response
    /// when the partial is already complete.
    async fn open_partial(
        &self,
        spec: &ModelSpec,
        file: &ModelFile,
        partial: &Path,
        cancel: &CancellationToken,
    ) -> Result<(tokio::fs::File, Sha256, u64, Option<reqwest::Response>), DownloadError> {
        let mut have = match tokio::fs::metadata(partial).await {
            Ok(m) if m.len() <= file.size => m.len(),
            _ => 0,
        };
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
        let mut hasher = Sha256::new();
        let out = if have > 0 {
            hash_prefix(partial, have, &mut hasher).await?;
            fs_private::open_async(partial, false).await?
        } else {
            fs_private::open_async(partial, true).await?
        };
        Ok((out, hasher, have, response))
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

/// Streams `resp` into `out`, which already holds `written` bytes, and
/// returns how many it holds after. A body longer than the file's size is a
/// `Size` error (the caller deletes the partial); a dropped connection or a
/// cancel keeps the partial for the next resume.
async fn stream_into(
    mut resp: reqwest::Response,
    out: &mut tokio::fs::File,
    hasher: &mut Sha256,
    mut written: u64,
    file: &ModelFile,
    progress: &(dyn Fn(u64) + Sync),
    cancel: &CancellationToken,
) -> Result<u64, DownloadError> {
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
                    "download of {} failed: {e}",
                    file.name
                )));
            }
        };
        written += chunk.len() as u64;
        if written > file.size {
            return Err(DownloadError::Size(file.name.to_string()));
        }
        hasher.update(&chunk);
        out.write_all(&chunk).await?;
        progress(written);
    }
    out.flush().await?;
    Ok(written)
}

/// Checks the complete partial's size and sha256, then fsyncs and renames it
/// into place. Bad bytes delete the partial (resuming would fail the same
/// way); a short file keeps it for the next resume.
async fn install(
    out: tokio::fs::File,
    hasher: Sha256,
    written: u64,
    file: &ModelFile,
    partial: &Path,
    dir: &Path,
) -> Result<(), DownloadError> {
    if written != file.size {
        return Err(DownloadError::Http(format!(
            "download of {} ended after {written} of {} bytes",
            file.name, file.size
        )));
    }
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if !digest.eq_ignore_ascii_case(&file.sha256) {
        drop(out);
        let _ = tokio::fs::remove_file(partial).await;
        return Err(DownloadError::Checksum(file.name.to_string()));
    }
    out.sync_all().await?;
    drop(out);
    tokio::fs::rename(partial, dir.join(file.name)).await?;
    sync_dir(dir).await;
    Ok(())
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
    let mut out = fs_private::open_async(&tmp, true).await?;
    out.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())
        .await?;
    out.sync_all().await?;
    drop(out);
    tokio::fs::rename(&tmp, dir.join(MANIFEST)).await?;
    sync_dir(dir).await;
    Ok(())
}

#[cfg(test)]
mod tests;
