//! The semantic index as an [`IndexSink`]: the crate's sync worker hands it
//! changed pages, it chunks them with the model's token budget, embeds only
//! chunks it hasn't seen, and checkpoints its file.

use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(any(test, feature = "test-model"))]
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard};
use std::time::{Duration, Instant};

use tokio::sync::Semaphore;

use super::budget::Budget;
use super::chunk::{chunk_fitting, floor_char_boundary, ChunkText};
use super::embed::EmbedKind;
use super::index::{Chunk, Page, VectorIndex};
use super::inference::{Inference, INDEX_TEXTS};
#[cfg(test)]
use super::lease::writers;
use super::lease::Owner;
use super::store::{self, Header, StoreError};
use crate::{
    Change, FileStamp, IndexKind, IndexSink, Location, Opened, SinkError, SinkLimits,
    WhileReconciling,
};

/// Pages per apply: what a query sees changes this often.
pub const BATCH_PAGES: usize = 32;
pub const BATCH_BYTES: u64 = 4 * 1024 * 1024;
/// While an apply embeds, the pages it finished are reported this often
/// (between embed jobs), however slow a batch is.
pub const PROGRESS_EVERY: Duration = Duration::from_secs(2);
/// The index file is written at most this often while it changes, and when
/// the worker goes idle.
pub const CHECKPOINT_EVERY: Duration = Duration::from_secs(30);
/// Per space: pages past these are kept without chunks (one warning).
pub const MAX_PAGES: usize = 30_000;
pub const MAX_CHUNKS: usize = 150_000;
/// Text per page that is chunked; the rest isn't searched by meaning.
pub const MAX_PAGE_TEXT: usize = 256 * 1024;

/// Semantic builds that may run at once, server-wide (M2R11).
pub(crate) static BUILDS: Semaphore = Semaphore::const_new(1);

/// What is embedded before a chunk's text: the page name and a newline.
pub fn passage_head(path: &str) -> String {
    format!("{}\n", path.strip_suffix(".md").unwrap_or(path))
}

/// A page an apply is writing.
struct Pending {
    path: String,
    stamp: FileStamp,
    chunks: Vec<ChunkText>,
    /// One per chunk: `None` until embedded.
    vectors: Vec<Option<Vec<f32>>>,
}

struct Saved {
    dirty: bool,
    last: Instant,
}

pub struct SemanticSink {
    inference: Arc<Inference>,
    header: Header,
    /// `None` for an index in memory.
    file: Option<PathBuf>,
    /// How the file looked at open.
    opened: Opened,
    /// The first build finished (recorded in the file at its next save).
    complete: AtomicBool,
    index: RwLock<VectorIndex>,
    /// Serialises applies and checkpoints. Every worker of a space (two
    /// while an instance rebuilds) applies through this one sink, so its
    /// file has one writer.
    saved: Mutex<Saved>,
    caps: (usize, usize),
    capped: AtomicBool,
    /// This sink's hold on its file (none in RAM). Locked while the file is
    /// written; [`SemanticSink::close`] takes it, so once `close` returns no
    /// write of this sink is in flight or will start, and a deleted space's
    /// directory isn't recreated by a late checkpoint.
    owner: Mutex<Option<Owner>>,
    /// What [`PROGRESS_EVERY`] is measured with (tests use a fake clock).
    clock: Box<dyn Fn() -> Instant + Send + Sync>,
    /// Tests: how long each checkpoint takes at least.
    #[cfg(test)]
    save_delay: Duration,
    /// Tests: how often [`IndexSink::reset`] ran.
    #[cfg(any(test, feature = "test-model"))]
    resets: AtomicUsize,
}

impl SemanticSink {
    /// Blocking. First waits until no other sink in this process holds the
    /// file (one closing still finishes its save), and holds it until
    /// [`SemanticSink::close`]. Loads `<dir>/semantic-v1/<model>.bin` when it
    /// holds this model's index; a missing, damaged or other model's file
    /// starts empty (and is overwritten at the first checkpoint).
    pub fn open(location: &Location, inference: Arc<Inference>) -> SemanticSink {
        let spec = inference.spec().clone();
        let header = Header::of(&spec);
        let empty = || VectorIndex::new(spec.dim);
        let mut owner = None;
        let (file, index, opened) = match location {
            Location::Memory => (None, empty(), Opened::Memory),
            Location::Disk(dir) => {
                let file = store::file_path(dir, &spec);
                owner = Some(Owner::acquire(&file));
                match store::load_state(&file, &header) {
                    Ok((index, true)) => (Some(file), index, Opened::Reused),
                    // Saved during a first build: its vectors are kept, and
                    // the build goes on as a first build.
                    Ok((index, false)) => (Some(file), index, Opened::Resumed),
                    Err(StoreError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                        (Some(file), empty(), Opened::Fresh)
                    }
                    Err(e) => {
                        tracing::warn!("Semantic index {}: {e}; rebuilding it", file.display());
                        (Some(file), empty(), Opened::Fresh)
                    }
                }
            }
        };
        SemanticSink {
            inference,
            header,
            file,
            opened,
            complete: AtomicBool::new(opened == Opened::Reused),
            index: RwLock::new(index),
            saved: Mutex::new(Saved {
                dirty: false,
                last: Instant::now(),
            }),
            caps: (MAX_PAGES, MAX_CHUNKS),
            capped: AtomicBool::new(false),
            owner: Mutex::new(owner),
            clock: Box::new(Instant::now),
            #[cfg(test)]
            save_delay: Duration::ZERO,
            #[cfg(any(test, feature = "test-model"))]
            resets: AtomicUsize::new(0),
        }
    }

    /// Tests: how often a rebuild reset this sink.
    #[cfg(any(test, feature = "test-model"))]
    pub fn resets(&self) -> usize {
        self.resets.load(Ordering::SeqCst)
    }

    /// How the file looked at open.
    pub fn opened(&self) -> Opened {
        self.opened
    }

    /// Stops all further checkpoints (the service forgot this space). Waits
    /// for a write in flight, then lets go of the file, so a sink opened on
    /// it afterwards never writes it at the same time.
    pub(crate) fn close(&self) {
        drop(self.owner.lock().unwrap_or_else(|e| e.into_inner()).take());
    }

    #[cfg(test)]
    pub(crate) fn with_save_delay(mut self, delay: Duration) -> SemanticSink {
        self.save_delay = delay;
        self
    }

    #[cfg(test)]
    fn with_clock(mut self, clock: impl Fn() -> Instant + Send + Sync + 'static) -> SemanticSink {
        self.clock = Box::new(clock);
        self
    }

    #[cfg(test)]
    fn with_caps(mut self, pages: usize, chunks: usize) -> SemanticSink {
        self.caps = (pages, chunks);
        self
    }

    pub fn read(&self) -> RwLockReadGuard<'_, VectorIndex> {
        self.index.read().unwrap_or_else(|e| e.into_inner())
    }

    fn checkpoint(&self, saved: &mut Saved) {
        let Some(file) = &self.file else {
            saved.dirty = false;
            return;
        };
        // Held for the write, so `close` waits for it.
        let owner = self.owner.lock().unwrap_or_else(|e| e.into_inner());
        if owner.is_none() {
            // Closed: never written again.
            saved.dirty = false;
            return;
        }
        #[cfg(test)]
        let _writer = writers::enter(file);
        #[cfg(test)]
        std::thread::sleep(self.save_delay);
        let complete = self.complete.load(Ordering::SeqCst);
        match store::save_state(file, &self.header, &self.read(), complete) {
            Ok(()) => {
                saved.dirty = false;
                saved.last = Instant::now();
            }
            Err(e) => {
                // Retried at the next checkpoint, not after every batch.
                saved.last = Instant::now();
                tracing::warn!("Can't save the semantic index {}: {e}", file.display());
            }
        }
    }

    /// Warns once per space that pages are past a cap.
    fn warn_capped(&self) {
        if !self.capped.swap(true, Ordering::Relaxed) {
            let (max_pages, max_chunks) = self.caps;
            tracing::warn!(
                "Semantic index: this space has more than {max_pages} pages or {max_chunks} passages; the rest aren't searched by meaning"
            );
        }
    }

    /// Chunks of each upsert's text (capped at [`MAX_PAGE_TEXT`]), cut so
    /// every passage fits one window. One job per page, so a query waits
    /// behind at most one page's chunking.
    fn chunk_all(
        &self,
        pages: &[(&str, &str, FileStamp)],
    ) -> Result<Vec<Vec<ChunkText>>, SinkError> {
        pages
            .iter()
            .map(|(path, text, _)| {
                let head = passage_head(path);
                let text = text[..floor_char_boundary(text, MAX_PAGE_TEXT)].to_string();
                self.inference
                    .run_index(move |model| {
                        let fit =
                            |s: &str| model.fit(&format!("{head}{s}")).saturating_sub(head.len());
                        chunk_fitting(&text, &fit)
                    })
                    .map_err(SinkError::Failed)
            })
            .collect()
    }

    /// Vectors for `texts`, [`INDEX_TEXTS`] per job so queries never wait
    /// long. The texts are embedded shortest first, so each job (one forward
    /// batch) holds texts of similar length and little padding: in apply
    /// order about half of every batch was padding, sorted about a fifth.
    /// The vectors come back in `texts` order; `embedded(slots)` after each
    /// job, with the indexes in `texts` of the texts it embedded.
    fn embed_all(
        &self,
        texts: Vec<String>,
        mut embedded: impl FnMut(&[usize]),
    ) -> Result<Vec<Vec<f32>>, SinkError> {
        let mut order: Vec<usize> = (0..texts.len()).collect();
        // Bytes stand in for tokens: close enough to group similar lengths.
        order.sort_by_key(|&i| texts[i].len());
        let mut out = vec![Vec::new(); texts.len()];
        for slots in order.chunks(INDEX_TEXTS) {
            let batch: Vec<String> = slots.iter().map(|&i| texts[i].clone()).collect();
            let vectors = self
                .inference
                .run_index(move |model| {
                    let refs: Vec<&str> = batch.iter().map(String::as_str).collect();
                    model.embed(&refs, EmbedKind::Passage)
                })
                .map_err(SinkError::Failed)?
                .map_err(|e| SinkError::Failed(e.to_string()))?;
            for (&slot, vector) in slots.iter().zip(vectors) {
                out[slot] = vector;
            }
            embedded(slots);
        }
        Ok(out)
    }
}

impl IndexSink for SemanticSink {
    fn kind(&self) -> IndexKind {
        IndexKind::Semantic
    }

    /// Shared by every worker of this sink, so an instance rebuild after a
    /// finished first build catches up (M2P16).
    fn built_once(&self) -> bool {
        self.complete.load(Ordering::SeqCst)
    }

    fn stamps(&self) -> HashMap<String, FileStamp> {
        self.read().stamps()
    }

    fn apply(&self, changes: &[Change]) -> Result<(), SinkError> {
        self.apply_with_progress(changes, &|_| {})
    }

    /// Reports, at most every [`PROGRESS_EVERY`], the upserts whose chunks
    /// are all embedded; the index changes only at the end, as in `apply`.
    fn apply_with_progress(
        &self,
        changes: &[Change],
        progress: &dyn Fn(usize),
    ) -> Result<(), SinkError> {
        let mut reported = (self.clock)();
        let mut saved = self.saved.lock().unwrap_or_else(|e| e.into_inner());
        let upserts: Vec<(&str, &str, FileStamp)> = changes
            .iter()
            .filter_map(|c| match c {
                Change::Upsert { path, text, stamp } => {
                    Some((path.as_str(), text.as_str(), *stamp))
                }
                Change::Delete { .. } => None,
            })
            .collect();
        let chunked = self.chunk_all(&upserts)?;
        // Keep the vectors of chunks whose hash this page already has; embed the rest.
        let mut pages: Vec<Pending> = Vec::new();
        let mut todo: Vec<String> = Vec::new();
        let mut slots: Vec<(usize, usize)> = Vec::new();
        // Per page: how many of its chunks are still to embed.
        let mut missing: Vec<usize> = Vec::new();
        {
            let index = self.read();
            let mut budget = Budget::after_deletes(&index, self.caps, changes);
            for ((path, _, stamp), mut chunks) in upserts.iter().zip(chunked) {
                let old = index.get(path);
                let keep = budget.admit(old.map_or(0, |p| p.chunks.len()), chunks.len());
                if keep < chunks.len() {
                    chunks.truncate(keep);
                    self.warn_capped();
                }
                let known: HashMap<[u8; 32], &Vec<f32>> = old
                    .map(|p| p.chunks.iter().map(|c| (c.hash, &c.vector)).collect())
                    .unwrap_or_default();
                let (i, before) = (pages.len(), todo.len());
                let vectors = chunks
                    .iter()
                    .enumerate()
                    .map(|(j, c)| match known.get(&c.hash) {
                        Some(v) => Some((*v).clone()),
                        None => {
                            todo.push(format!("{}{}", passage_head(path), c.text));
                            slots.push((i, j));
                            None
                        }
                    })
                    .collect();
                pages.push(Pending {
                    path: path.to_string(),
                    stamp: *stamp,
                    chunks,
                    vectors,
                });
                missing.push(todo.len() - before);
            }
        }
        // Texts are embedded shortest first, so pages finish in any order.
        let mut done = missing.iter().filter(|&&n| n == 0).count();
        let vectors = self.embed_all(todo, |embedded| {
            for &t in embedded {
                let page = slots[t].0;
                missing[page] -= 1;
                if missing[page] == 0 {
                    done += 1;
                }
            }
            let now = (self.clock)();
            if now.saturating_duration_since(reported) >= PROGRESS_EVERY {
                reported = now;
                progress(done);
            }
        })?;
        for ((i, j), vector) in slots.into_iter().zip(vectors) {
            pages[i].vectors[j] = Some(vector);
        }
        {
            let mut index = self.index.write().unwrap_or_else(|e| e.into_inner());
            for Pending {
                path,
                stamp,
                chunks,
                vectors,
            } in pages
            {
                let chunks = chunks
                    .iter()
                    .zip(vectors)
                    .filter_map(|(c, v)| Some(Chunk::new(c, v?)))
                    .collect();
                index.insert(path, Page::new(stamp, chunks));
            }
            for change in changes {
                if let Change::Delete { path } = change {
                    index.remove(path);
                }
            }
        }
        saved.dirty = true;
        if saved.last.elapsed() >= CHECKPOINT_EVERY {
            self.checkpoint(&mut saved);
        }
        Ok(())
    }

    fn measure(&self) -> (u64, u64) {
        let index = self.read();
        let in_memory = (index.chunk_count() * index.dim() * 4) as u64;
        let bytes = match &self.file {
            // Right after a first build the file isn't saved yet (the
            // worker's settle saves it): report the vectors' size instead.
            Some(file) => std::fs::metadata(file)
                .map(|m| m.len())
                .ok()
                .filter(|&n| n > 0)
                .unwrap_or(in_memory),
            None => in_memory,
        };
        (index.len() as u64, bytes)
    }

    fn is_memory(&self) -> bool {
        self.file.is_none()
    }

    fn settle(&self) {
        let mut saved = self.saved.lock().unwrap_or_else(|e| e.into_inner());
        if saved.dirty {
            self.checkpoint(&mut saved);
        }
    }

    /// Records the finished first build: at the save the worker's settle
    /// makes for changes not saved yet, else right away.
    fn built(&self) {
        if self.complete.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut saved = self.saved.lock().unwrap_or_else(|e| e.into_inner());
        if !saved.dirty {
            self.checkpoint(&mut saved);
        }
    }

    /// A rebuild starts from no vectors (so no chunk's vector is reused) and
    /// is a first build again: the next checkpoint overwrites the file as
    /// unfinished, until the rebuild's reconcile calls [`IndexSink::built`].
    fn reset(&self) -> Result<(), SinkError> {
        let mut saved = self.saved.lock().unwrap_or_else(|e| e.into_inner());
        {
            let mut index = self.index.write().unwrap_or_else(|e| e.into_inner());
            *index = VectorIndex::new(index.dim());
        }
        self.complete.store(false, Ordering::SeqCst);
        self.capped.store(false, Ordering::Relaxed);
        saved.dirty = true;
        #[cfg(any(test, feature = "test-model"))]
        self.resets.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn limits(&self) -> SinkLimits {
        SinkLimits {
            batch_pages: BATCH_PAGES,
            batch_bytes: BATCH_BYTES,
            builds: &BUILDS,
            // Natural and Related keep answering from the vectors while a
            // later reconcile catches up (M2P13); only the first build waits
            // for `BUILDS`.
            while_reconciling: WhileReconciling::StayReady,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::embed::Embedder;
    use crate::semantic::test_model::FakeEmbedder;

    fn upsert(path: &str, text: &str) -> Change {
        Change::Upsert {
            path: path.into(),
            text: text.into(),
            stamp: FileStamp {
                modified: 1,
                size: text.len() as u64,
            },
        }
    }

    #[test]
    fn pages_past_the_page_cap_are_kept_without_chunks() {
        let inference = Inference::with_embedder(std::sync::Arc::new(FakeEmbedder::new()));
        let sink = SemanticSink::open(&Location::Memory, inference).with_caps(2, MAX_CHUNKS);
        sink.apply(&[
            upsert("A.md", "alpha"),
            upsert("B.md", "beta"),
            upsert("C.md", "gamma"),
        ])
        .unwrap();
        let index = sink.read();
        assert_eq!(index.len(), 3, "every page is stamped, so none is retried");
        assert_eq!(index.get("C.md").unwrap().chunks.len(), 0);
        assert_eq!(index.chunk_count(), 2);
    }

    fn delete(path: &str) -> Change {
        Change::Delete { path: path.into() }
    }

    /// At a full page cap, a delete in the same batch makes room for its
    /// upsert.
    #[test]
    fn an_apply_with_a_delete_makes_room_at_the_page_cap() {
        let inference = Inference::with_embedder(std::sync::Arc::new(FakeEmbedder::new()));
        let sink = SemanticSink::open(&Location::Memory, inference).with_caps(2, MAX_CHUNKS);
        sink.apply(&[upsert("A.md", "alpha"), upsert("B.md", "beta")])
            .unwrap();
        sink.apply(&[delete("A.md"), upsert("E.md", "epsilon")])
            .unwrap();
        let index = sink.read();
        assert!(index.get("A.md").is_none());
        assert_eq!(
            index.get("E.md").unwrap().chunks.len(),
            1,
            "the delete made room"
        );
    }

    /// The caps through a whole apply: every page is stamped, the edit keeps
    /// only the chunks that fit.
    #[test]
    fn an_apply_spends_the_budget() {
        let inference = Inference::with_embedder(std::sync::Arc::new(FakeEmbedder::new()));
        let sink = SemanticSink::open(&Location::Memory, inference).with_caps(MAX_PAGES, 3);
        sink.apply(&[
            upsert("A.md", "# One\nfern\n\n# Two\nmoss"),
            upsert("B.md", "# One\nreed"),
        ])
        .unwrap();
        sink.apply(&[
            upsert("B.md", "# One\nreed\n\n# Two\nrush"),
            upsert("C.md", "sedge"),
        ])
        .unwrap();
        let index = sink.read();
        assert_eq!(index.len(), 3);
        assert_eq!(index.get("A.md").unwrap().chunks.len(), 2);
        assert_eq!(index.get("B.md").unwrap().chunks.len(), 1);
        assert_eq!(index.get("C.md").unwrap().chunks.len(), 0);
    }

    #[test]
    fn long_pages_are_chunked_up_to_the_text_cap_and_every_chunk_fits() {
        let fake = std::sync::Arc::new(FakeEmbedder {
            budget: 8,
            ..FakeEmbedder::new()
        });
        let inference = Inference::with_embedder(fake.clone());
        let sink = SemanticSink::open(&Location::Memory, inference);
        let text = "word ".repeat(MAX_PAGE_TEXT / 5 + 1000);
        sink.apply(&[upsert("Long.md", &text)]).unwrap();
        let index = sink.read();
        let chunks = &index.get("Long.md").unwrap().chunks;
        let last = chunks.last().unwrap();
        assert!((last.start + last.len) as usize <= MAX_PAGE_TEXT);
        for c in chunks {
            let passage = format!(
                "{}{}",
                passage_head("Long.md"),
                &text[c.start as usize..(c.start + c.len) as usize]
            );
            assert_eq!(
                fake.fit(&passage),
                passage.len(),
                "each chunk is one window"
            );
        }
    }

    /// Records the byte length of every passage of every embed job.
    struct Jobs {
        fake: FakeEmbedder,
        lengths: Mutex<Vec<Vec<usize>>>,
    }

    impl Embedder for Jobs {
        fn spec(&self) -> &crate::semantic::catalog::ModelSpec {
            self.fake.spec()
        }

        fn fit(&self, text: &str) -> usize {
            self.fake.fit(text)
        }

        fn embed(
            &self,
            texts: &[&str],
            kind: EmbedKind,
        ) -> Result<Vec<Vec<f32>>, crate::semantic::embed::EmbedError> {
            let lengths = texts.iter().map(|t| t.len()).collect();
            self.lengths.lock().unwrap().push(lengths);
            self.fake.embed(texts, kind)
        }
    }

    /// An apply embeds its passages shortest first, so a job (one forward
    /// batch) holds passages of similar length, and every vector still
    /// lands on its own chunk.
    #[test]
    fn an_apply_embeds_shortest_first_and_maps_every_vector_back() {
        let jobs = std::sync::Arc::new(Jobs {
            fake: FakeEmbedder {
                budget: 8,
                ..FakeEmbedder::new()
            },
            lengths: Mutex::new(Vec::new()),
        });
        let sink = SemanticSink::open(&Location::Memory, Inference::with_embedder(jobs.clone()));
        let pages: Vec<(String, String)> = (0..6)
            .map(|i| {
                let text: String = (0..3 + i * 9)
                    .map(|w| format!("fern{i} moss{w} "))
                    .collect();
                (format!("Bed {i}.md"), text)
            })
            .collect();
        let changes: Vec<Change> = pages.iter().map(|(p, t)| upsert(p, t)).collect();
        sink.apply(&changes).unwrap();
        let lengths = jobs.lengths.lock().unwrap().clone();
        assert!(lengths.len() > 1, "several jobs: {lengths:?}");
        let flat = lengths.concat();
        assert!(flat.windows(2).all(|w| w[0] <= w[1]), "{lengths:?}");
        let index = sink.read();
        for (path, text) in &pages {
            for c in &index.get(path).unwrap().chunks {
                let range = c.start as usize..(c.start + c.len) as usize;
                let passage = format!("{}{}", passage_head(path), &text[range]);
                assert_eq!(
                    c.vector,
                    jobs.fake.vector(&passage),
                    "{path} at {}",
                    c.start
                );
            }
        }
    }

    /// A slow batch reports progress on the clock while it embeds, at most
    /// every `PROGRESS_EVERY`, counting the pages whose chunks are all
    /// embedded; a query sees none of them before the apply returns.
    #[test]
    fn a_slow_batch_reports_progress_on_the_clock_while_it_embeds() {
        let fake = std::sync::Arc::new(FakeEmbedder {
            budget: 8,
            ..FakeEmbedder::new()
        });
        let inference = Inference::with_embedder(fake.clone());
        // Each embedded text takes 100 ms of fake time: a job of
        // `INDEX_TEXTS` takes 1.6 s, so progress comes every other job.
        let (clock, start) = (fake.clone(), Instant::now());
        let sink = SemanticSink::open(&Location::Memory, inference).with_clock(move || {
            start + Duration::from_millis(100 * clock.texts.load(Ordering::SeqCst) as u64)
        });
        let pages: Vec<Change> = (0..4)
            .map(|i| {
                let text: String = (0..100).map(|w| format!("fern{i} moss{w} ")).collect();
                upsert(&format!("Garden {i}.md"), &text)
            })
            .collect();
        let reports = Mutex::new(Vec::new());
        sink.apply_with_progress(&pages, &|done| {
            assert_eq!(sink.read().len(), 0, "nothing searchable mid-batch");
            reports.lock().unwrap().push(done);
        })
        .unwrap();
        let reports = reports.into_inner().unwrap();
        let jobs = fake.calls.load(Ordering::SeqCst);
        assert!(jobs >= 4, "several embed jobs, got {jobs}");
        assert!(!reports.is_empty(), "progress before the batch was applied");
        assert!(
            reports.len() <= jobs / 2,
            "throttled: {reports:?} of {jobs} jobs"
        );
        assert!(reports.windows(2).all(|w| w[0] <= w[1]), "{reports:?}");
        assert!(
            reports.iter().any(|&n| 0 < n && n < pages.len()),
            "{reports:?}"
        );
        assert_eq!(sink.read().len(), pages.len());
    }

    /// Measured before the first save, a disk index reports its vectors'
    /// size, not 0; once saved, the file's size.
    #[test]
    fn an_unsaved_disk_index_measures_its_vectors() {
        let tmp = tempfile::tempdir().unwrap();
        let location = Location::Disk(tmp.path().to_path_buf());
        let inference = Inference::with_embedder(std::sync::Arc::new(FakeEmbedder::new()));
        let sink = SemanticSink::open(&location, inference);
        sink.apply(&[upsert("Basil.md", "Water the basil every morning.")])
            .unwrap();
        let file = sink.file.clone().unwrap();
        assert!(!file.exists(), "nothing saved yet");
        let vectors = {
            let index = sink.read();
            (index.chunk_count() * index.dim() * 4) as u64
        };
        assert!(vectors > 0);
        assert_eq!(sink.measure(), (1, vectors));
        sink.settle();
        let saved = std::fs::metadata(&file).unwrap().len();
        assert_eq!(sink.measure(), (1, saved));
    }

    /// R1: a file saved during a first build reopens `Resumed` with its
    /// pages; once a first build finished it reopens `Reused`.
    #[test]
    fn a_checkpoint_of_an_unfinished_build_reopens_resumed() {
        let tmp = tempfile::tempdir().unwrap();
        let location = Location::Disk(tmp.path().to_path_buf());
        let fake = std::sync::Arc::new(FakeEmbedder::new());
        let open = || {
            let sink = SemanticSink::open(&location, Inference::with_embedder(fake.clone()));
            (sink.opened(), sink)
        };
        let (opened, sink) = open();
        assert_eq!(opened, Opened::Fresh);
        sink.apply(&[upsert("A.md", "alpha"), upsert("B.md", "beta")])
            .unwrap();
        sink.settle();
        drop(sink);

        let (opened, sink) = open();
        assert_eq!(opened, Opened::Resumed);
        assert_eq!(sink.read().len(), 2, "the vectors are kept");
        let embedded = fake.texts.load(Ordering::SeqCst);
        // Nothing changed since the last save: built() saves right away.
        sink.built();
        drop(sink);

        let (opened, sink) = open();
        assert_eq!(opened, Opened::Reused);
        assert_eq!(sink.read().len(), 2);
        assert_eq!(
            fake.texts.load(Ordering::SeqCst),
            embedded,
            "nothing re-embedded"
        );
    }
}
