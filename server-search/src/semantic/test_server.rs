//! Local model servers for tests (and other crates' tests, through the
//! `test-model` feature): a raw HTTP/1.1 file server, and the tiny model
//! served from it with a store pointed at it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::catalog::ModelSpec;
use super::download::ModelStore;
use super::service::SemanticService;
use super::test_model::write_tiny_model;

/// Minimal HTTP/1.1 file server: honours `Range: bytes=N-`, counts requests, and can ignore
/// ranges, drop the connection part-way, corrupt or lengthen bodies, send slowly, and stall.
/// (Raw sockets rather than axum: a mid-body connection kill needs a streamed body, and the
/// crate has no futures stream dependency to build one.)
#[derive(Default)]
pub struct FileServer {
    /// File name (the URL's last segment) → its bytes.
    pub files: HashMap<String, Vec<u8>>,
    pub requests: AtomicUsize,
    /// Each request's `Range` start, in order.
    pub ranges: Mutex<Vec<Option<u64>>>,
    pub ignore_range: AtomicBool,
    /// The next full (unranged) request ends after 40 % of its body.
    pub cut_next: AtomicBool,
    /// Pause after each 512-byte piece of a body.
    pub delay_ms: AtomicUsize,
    /// Claim a `Content-Range` start one past the asked one.
    pub wrong_range: AtomicBool,
    /// Send every body but its last byte, then hold the connection open
    /// until the client hangs up.
    pub stall: AtomicBool,
}

async fn serve(conn: TcpStream, server: Arc<FileServer>) {
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
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
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
    let stall = server.stall.load(Ordering::SeqCst);
    let end = if cut {
        slice.len() * 4 / 10
    } else if stall {
        slice.len().saturating_sub(1)
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
    if stall {
        // Returns when the client hangs up (a cancelled download).
        let _ = conn.read(&mut [0u8; 1]).await;
        return;
    }
    let _ = conn.shutdown().await;
}

/// Serves `server` on a free localhost port until the runtime ends; returns
/// its base URL.
pub async fn serve_files(server: Arc<FileServer>) -> String {
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

/// The tiny model (`test-tiny`) served on localhost, its files and model
/// store in a private temporary directory removed on drop.
pub struct TestModelServer {
    dir: PathBuf,
    spec: ModelSpec,
    base: String,
    pub files: Arc<FileServer>,
}

impl TestModelServer {
    /// Serves the model at full speed. Must be called inside a tokio runtime.
    pub async fn start() -> TestModelServer {
        TestModelServer::serving(false).await
    }

    /// Serves every file of the model but its last byte, then stalls: a
    /// download never finishes, and stays in its first file (and its
    /// `.partial`) until it is cancelled. Wait for `Downloading` with
    /// `done > 0` before cancelling: the `.partial` exists from then on.
    pub async fn stalled() -> TestModelServer {
        TestModelServer::serving(true).await
    }

    async fn serving(stall: bool) -> TestModelServer {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sb-test-model-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let src = dir.join("src");
        let spec = write_tiny_model(&src, 7);
        let files = spec
            .files
            .iter()
            .map(|f| {
                let bytes = std::fs::read(src.join(f.name)).expect("read the tiny model");
                (f.name.to_string(), bytes)
            })
            .collect();
        let files = Arc::new(FileServer {
            files,
            stall: AtomicBool::new(stall),
            ..FileServer::default()
        });
        let base = serve_files(files.clone()).await;
        TestModelServer {
            dir,
            spec,
            base,
            files,
        }
    }

    /// The served model's spec (exact sizes and hashes).
    pub fn spec(&self) -> ModelSpec {
        self.spec.clone()
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }

    /// The model store's root (`<data>/search/models` of a server).
    pub fn models_dir(&self) -> PathBuf {
        self.dir.join("models")
    }

    /// A store under [`TestModelServer::models_dir`] downloading from this server.
    pub fn store(&self) -> ModelStore {
        ModelStore::new(self.models_dir()).with_base_url(self.base.clone())
    }

    /// A semantic service for the model, downloading it from this server
    /// into [`TestModelServer::models_dir`].
    pub fn service(&self) -> Arc<SemanticService> {
        SemanticService::start_with_store(self.spec(), self.store())
    }

    /// Whether a download left a `.partial` file in the model's directory.
    pub fn partial_exists(&self) -> bool {
        let dir = self.models_dir().join(self.spec.dir_name());
        std::fs::read_dir(dir).is_ok_and(|entries| {
            entries
                .flatten()
                .any(|e| e.file_name().to_string_lossy().ends_with(".partial"))
        })
    }
}

impl Drop for TestModelServer {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
