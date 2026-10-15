use std::sync::atomic::Ordering;

use super::super::test_model::write_tiny_model;
use super::super::test_server::{serve_files as start, FileServer as Server};
use super::*;

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
    let r = tokio::time::timeout(Duration::from_millis(80), fx.store.ensure(&fx.spec, &t)).await;
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

#[tokio::test]
async fn stored_lists_offered_models_with_their_size() {
    let dir = tempfile::tempdir().unwrap();
    let store = ModelStore::new(dir.path().to_path_buf());
    let spec = crate::semantic::catalog::find("multilingual-e5-small").unwrap();
    std::fs::create_dir_all(store.dir(spec)).unwrap();
    std::fs::write(
        store.dir(spec).join("model.safetensors.partial"),
        vec![0u8; 1_000],
    )
    .unwrap();
    std::fs::create_dir_all(dir.path().join("unrelated@1")).unwrap();
    let stored = store.stored();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (stored[0].spec.id, stored[0].bytes, stored[0].complete),
        ("multilingual-e5-small", 1_000, false)
    );
}
