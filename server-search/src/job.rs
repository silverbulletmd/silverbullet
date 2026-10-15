//! What every backend's queries share: validating the text, the
//! client-facing notices and failure message, and [`run_blocking`], which
//! runs one query's blocking work in its query slot within the request's
//! deadline and cancellation.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::{limits, IndexState, Match, QuerySlot, RequestCx, SearchError};

/// Client-facing text of a failed index read. Index errors can name index
/// files and directories, so the detail goes only to the server log.
pub(crate) const FAILED_MESSAGE: &str = "try again in a moment";
/// Query notice when the deadline cut the work short.
pub(crate) const SLOW_NOTICE: &str = "Search took too long; results may be incomplete";
/// What a query gets before its index is open.
pub(crate) const STARTING: &str = "Search index is starting";

/// The query notice of an index in `state` that isn't ready yet: starting,
/// queued, downloading its model, or building. `None` when it is ready, and
/// when it failed (each backend says what that means for its answers).
pub(crate) fn notice(state: &IndexState) -> Option<String> {
    let building = |done: u64, total: u64| {
        // With nothing counted yet (the store is opening, or a fresh start
        // can't list the space) there is no progress to show.
        if total == 0 {
            STARTING.to_string()
        } else {
            format!("Search index building: {done} of {total} pages")
        }
    };
    match state {
        IndexState::Starting => Some(STARTING.to_string()),
        IndexState::Waiting { total } => Some(building(0, *total)),
        IndexState::Downloading { done, total } => Some(format!(
            "Search index building: downloading the search model, {} %",
            done.saturating_mul(100).checked_div(*total).unwrap_or(0)
        )),
        IndexState::Building { done, total } => Some(building(*done, *total)),
        IndexState::Ready { .. } | IndexState::Failed { .. } => None,
    }
}

/// `query` trimmed, or the error `limits` give for it; the mode-independent
/// half of every backend's validation.
pub(crate) fn validate_text(query: &str) -> Result<String, SearchError> {
    let trimmed = query.trim();
    if trimmed.len() > limits::MAX_QUERY_BYTES {
        return Err(SearchError::Invalid("Search query is too long".into()));
    }
    let chars = trimmed.chars().count();
    // One Chinese, Japanese or Korean letter is a word; a CJK punctuation
    // mark or symbol alone (`・`, `゛`) is not.
    let lone_cjk = chars == 1 && trimmed.chars().all(crate::fulltext::is_cjk_letter);
    if chars < limits::MIN_QUERY_CHARS && !lone_cjk {
        return Err(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS));
    }
    Ok(trimmed.to_string())
}

/// What a query has found so far; read when it finishes or at the deadline.
#[derive(Default)]
pub(crate) struct Acc {
    pub items: Vec<Match>,
    /// Matching pages, less those found unreadable.
    pub total: usize,
}

/// What a job sees of its query: whether to stop, and where to put what it
/// found so far.
pub(crate) struct JobCx<A> {
    stop: Arc<AtomicBool>,
    acc: Arc<Mutex<A>>,
}

impl<A> JobCx<A> {
    /// The query was cancelled or ran past its deadline: stop between pages.
    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    pub fn acc(&self) -> MutexGuard<'_, A> {
        self.acc.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// What a job left in its accumulator, and whether the deadline cut it short.
pub(crate) struct Finished<A> {
    pub acc: A,
    pub timed_out: bool,
}

/// Runs `job` in `spawn_blocking` with `slot`, until it finishes, the request
/// is cancelled (`Cancelled`) or its deadline passes (`timed_out`, with what
/// the job found so far). A job error is returned as is; a panic is logged as
/// "`what` failed" and answers `Failed`.
///
/// The slot goes with the work and is held until the work stops, also after a
/// cancel or the deadline. A storage read that hangs therefore keeps its slot
/// (eight such reads make every query `Busy` until they return); releasing it
/// early would let stuck blocking threads pile up past `MAX_QUERIES`, and the
/// slot is the only thing that bounds them.
pub(crate) async fn run_blocking<A: Default + Send + 'static>(
    cx: &RequestCx,
    slot: QuerySlot,
    what: &'static str,
    job: impl FnOnce(&JobCx<A>) -> Result<(), SearchError> + Send + 'static,
) -> Result<Finished<A>, SearchError> {
    let stop = Arc::new(AtomicBool::new(false));
    let acc = Arc::new(Mutex::new(A::default()));
    let job_cx = JobCx {
        stop: stop.clone(),
        acc: acc.clone(),
    };
    let mut task = tokio::task::spawn_blocking(move || {
        let _slot = slot;
        job(&job_cx)
    });
    let timed_out = tokio::select! {
        biased;
        _ = cx.cancel.cancelled() => {
            stop.store(true, Ordering::Relaxed);
            return Err(SearchError::Cancelled);
        }
        done = &mut task => match done {
            Ok(result) => {
                result?;
                false
            }
            Err(e) => {
                tracing::warn!("{what} failed (task): {e}");
                return Err(SearchError::Failed(FAILED_MESSAGE.into()));
            }
        },
        _ = tokio::time::sleep_until(cx.deadline) => {
            stop.store(true, Ordering::Relaxed);
            true
        }
    };
    let acc = std::mem::take(&mut *acc.lock().unwrap_or_else(|e| e.into_inner()));
    Ok(Finished { acc, timed_out })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gate::pool::Pool;
    use std::sync::mpsc;
    use std::time::Duration;
    use tokio_util::sync::CancellationToken;

    /// A request on a pool of one slot (a second request is `Busy` after
    /// 50 ms), with `deadline`.
    fn request(pool: &Arc<Pool>, deadline: Duration) -> RequestCx {
        RequestCx::admitted(deadline, CancellationToken::new(), pool.clone(), None)
    }

    fn one_slot() -> Arc<Pool> {
        Arc::new(Pool::new(1, Duration::from_millis(50)))
    }

    #[test]
    fn one_character_is_too_short_unless_it_is_cjk() {
        for q in ["猫", " 집 ", "の"] {
            assert!(validate_text(q).is_ok(), "{q}");
        }
        for q in ["a", "é", "ا", "7", "、", "・", "゠", "゛"] {
            assert_eq!(
                validate_text(q),
                Err(SearchError::QueryTooShort(limits::MIN_QUERY_CHARS)),
                "{q}"
            );
        }
    }

    #[tokio::test]
    async fn a_finished_job_hands_over_what_it_found() {
        let pool = one_slot();
        let cx = request(&pool, Duration::from_secs(5));
        let slot = cx.query_slot().await.unwrap();
        let finished = run_blocking(&cx, slot, "test", |work: &JobCx<Vec<u32>>| {
            work.acc().extend([1, 2]);
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!((finished.acc, finished.timed_out), (vec![1, 2], false));
        let cx = request(&pool, Duration::from_secs(5));
        assert!(cx.query_slot().await.is_ok(), "the slot came back");
    }

    #[tokio::test]
    async fn a_job_error_is_returned_as_is() {
        let pool = one_slot();
        let cx = request(&pool, Duration::from_secs(5));
        let slot = cx.query_slot().await.unwrap();
        let r = run_blocking(&cx, slot, "test", |_: &JobCx<Vec<u32>>| {
            Err(SearchError::Unavailable("not yet".into()))
        })
        .await;
        assert_eq!(r.err(), Some(SearchError::Unavailable("not yet".into())));
    }

    #[tokio::test]
    async fn a_panicking_job_fails_without_detail() {
        let pool = one_slot();
        let cx = request(&pool, Duration::from_secs(5));
        let slot = cx.query_slot().await.unwrap();
        let r = run_blocking(&cx, slot, "test", |_: &JobCx<Vec<u32>>| {
            panic!("index file /data/x is broken")
        })
        .await;
        assert_eq!(r.err(), Some(SearchError::Failed(FAILED_MESSAGE.into())));
    }

    #[tokio::test]
    async fn at_the_deadline_the_job_is_stopped_and_its_partial_result_kept() {
        let pool = one_slot();
        let cx = request(&pool, Duration::from_millis(100));
        let slot = cx.query_slot().await.unwrap();
        let (release, released) = mpsc::channel::<()>();
        let (saw_stop, stop_seen) = mpsc::channel();
        let finished = run_blocking(&cx, slot, "test", move |work: &JobCx<Vec<u32>>| {
            work.acc().push(1);
            let _ = released.recv();
            let _ = saw_stop.send(work.stopped());
            work.acc().push(2);
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!((finished.acc, finished.timed_out), (vec![1], true));
        // The work is still running, so it still holds the slot.
        let other = request(&pool, Duration::from_secs(5));
        assert_eq!(other.query_slot().await.err(), Some(SearchError::Busy));
        release.send(()).unwrap();
        let stopped = tokio::task::spawn_blocking(move || stop_seen.recv().unwrap());
        assert!(stopped.await.unwrap(), "the job sees it should stop");
        let other = request(&pool, Duration::from_secs(5));
        let freed = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if other.query_slot().await.is_ok() {
                    break;
                }
            }
        });
        assert!(freed.await.is_ok(), "the slot is freed once the work ends");
    }

    #[tokio::test]
    async fn a_cancelled_request_is_cancelled_but_its_slot_stays_with_the_work() {
        let pool = one_slot();
        let cx = request(&pool, Duration::from_secs(5));
        let slot = cx.query_slot().await.unwrap();
        let (release, released) = mpsc::channel::<()>();
        let (saw_stop, stop_seen) = mpsc::channel();
        let cancel = cx.cancel.clone();
        let running = run_blocking(&cx, slot, "test", move |work: &JobCx<Vec<u32>>| {
            let _ = released.recv();
            let _ = saw_stop.send(work.stopped());
            Ok(())
        });
        cancel.cancel();
        assert_eq!(running.await.err(), Some(SearchError::Cancelled));
        let other = request(&pool, Duration::from_secs(5));
        assert_eq!(other.query_slot().await.err(), Some(SearchError::Busy));
        release.send(()).unwrap();
        let stopped = tokio::task::spawn_blocking(move || stop_seen.recv().unwrap());
        assert!(stopped.await.unwrap(), "the job sees it should stop");
        let freed = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if other.query_slot().await.is_ok() {
                    break;
                }
            }
        });
        assert!(freed.await.is_ok(), "the slot is freed once the work ends");
    }

    #[test]
    fn a_build_with_nothing_counted_is_starting() {
        let building = |done, total| notice(&IndexState::Building { done, total });
        assert_eq!(building(0, 0).as_deref(), Some(STARTING));
        assert_eq!(
            building(3, 10).as_deref(),
            Some("Search index building: 3 of 10 pages")
        );
        assert_eq!(
            notice(&IndexState::Waiting { total: 10 }).as_deref(),
            Some("Search index building: 0 of 10 pages")
        );
        assert_eq!(
            notice(&IndexState::Downloading { done: 1, total: 4 }).as_deref(),
            Some("Search index building: downloading the search model, 25 %")
        );
        assert_eq!(notice(&IndexState::Ready { catch_up: None }), None);
        assert_eq!(notice(&IndexState::Failed { reason: "x".into() }), None);
    }
}
