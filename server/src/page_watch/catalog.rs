//! What `help` knows of a space's own pages without the runtime: the skills
//! among them, and which tags and attributes their frontmatter uses. Kept
//! current from the space's change events; built on first use with one read
//! of every page, then only of pages that change.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use silverbullet_server_search::limits::MAX_FILE_BYTES;
use silverbullet_server_search::{FeedEvent, FileStamp, SpaceView};
use space_tools::skills::{page_data, parse_skill, PageData, Skill};
use tokio::sync::watch;
use tokio::task::JoinHandle;

pub use space_tools::help::TagSummary;

use crate::search::PageSource;

/// Full rescan interval, for on-disk changes the events missed.
const RESCAN_EVERY: Duration = Duration::from_secs(10 * 60);
/// After a failed listing, the next attempt.
const RETRY_AFTER: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Pages {
    /// Stamp of every page as last listed; a page changed since is re-read.
    stamps: HashMap<String, FileStamp>,
    skills: HashMap<String, Skill>,
    data: HashMap<String, PageData>,
}

/// What one read of a page yields.
#[derive(Default)]
struct Scanned {
    skill: Option<Skill>,
    data: Option<PageData>,
}

impl Pages {
    fn store(&mut self, path: String, scanned: Scanned) {
        match scanned.skill {
            Some(skill) => self.skills.insert(path.clone(), skill),
            None => self.skills.remove(&path),
        };
        match scanned.data {
            Some(data) => self.data.insert(path, data),
            None => self.data.remove(&path),
        };
    }
}

pub struct PageCatalog {
    view: Arc<dyn SpaceView>,
    pages: Arc<Mutex<Pages>>,
    scanned: watch::Receiver<bool>,
    task: JoinHandle<()>,
}

impl Drop for PageCatalog {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl PageCatalog {
    /// Starts following `source` on the current tokio runtime.
    pub fn start(source: &PageSource) -> Self {
        // Subscribe before the first scan, so no change falls between them.
        let mut feed = source.feed();
        let view = source.view.clone();
        let pages = Arc::new(Mutex::new(Pages::default()));
        let (scanned_tx, scanned) = watch::channel(false);
        let task = {
            let (view, pages) = (view.clone(), pages.clone());
            tokio::spawn(async move {
                loop {
                    let listed = rescan(&view, &pages).await;
                    let _ = scanned_tx.send(true);
                    let wait = if listed { RESCAN_EVERY } else { RETRY_AFTER };
                    let deadline = tokio::time::sleep(wait);
                    tokio::pin!(deadline);
                    loop {
                        tokio::select! {
                            _ = &mut deadline => break,
                            event = feed.recv() => match event {
                                Some(FeedEvent::Changed(path)) => {
                                    refresh(&view, &pages, path).await;
                                }
                                Some(FeedEvent::Rescan) => break,
                                // The space was closed
                                None => return,
                            },
                        }
                    }
                }
            })
        };
        PageCatalog {
            view,
            pages,
            scanned,
            task,
        }
    }

    /// Whether this catalog follows `source` (an instance rebuild replaces it).
    pub fn follows(&self, source: &PageSource) -> bool {
        Arc::ptr_eq(&self.view, &source.view)
    }

    /// The skills, sorted by page, once the first scan finished; `None` when
    /// it hasn't within `wait`.
    pub async fn skills(&self, wait: Duration) -> Option<Vec<Skill>> {
        self.wait_scanned(wait).await?;
        let mut skills: Vec<Skill> = self
            .pages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .skills
            .values()
            .cloned()
            .collect();
        skills.sort_by(|a, b| a.page.cmp(&b.page));
        Some(skills)
    }

    /// The tags the space's own pages carry in frontmatter (not under
    /// `Library/`, not `meta` tags), most used first; `None` until scanned.
    pub async fn tags(&self, wait: Duration) -> Option<Vec<TagSummary>> {
        self.wait_scanned(wait).await?;
        let pages = self.pages.lock().unwrap_or_else(|e| e.into_inner());
        let mut tags: HashMap<&str, (usize, HashMap<&str, usize>)> = HashMap::new();
        for (path, data) in &pages.data {
            if path.starts_with("Library/") {
                continue;
            }
            for tag in &data.tags {
                if tag == "meta" || tag.starts_with("meta/") {
                    continue;
                }
                let (count, attributes) = tags.entry(tag.as_str()).or_default();
                *count += 1;
                for key in &data.attributes {
                    *attributes.entry(key.as_str()).or_default() += 1;
                }
            }
        }
        let mut summaries: Vec<TagSummary> = tags
            .into_iter()
            .map(|(tag, (pages, attributes))| {
                let mut attributes: Vec<(&str, usize)> = attributes.into_iter().collect();
                attributes.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
                TagSummary {
                    tag: tag.to_owned(),
                    pages,
                    attributes: attributes.into_iter().map(|(k, _)| k.to_owned()).collect(),
                }
            })
            .collect();
        summaries.sort_by(|a, b| b.pages.cmp(&a.pages).then(a.tag.cmp(&b.tag)));
        Some(summaries)
    }

    async fn wait_scanned(&self, wait: Duration) -> Option<()> {
        let mut scanned = self.scanned.clone();
        tokio::time::timeout(wait, scanned.wait_for(|done| *done))
            .await
            .ok()?
            .ok()?;
        Some(())
    }
}

fn is_page(path: &str) -> bool {
    path.ends_with(".md")
}

/// Page `path` as storage serves it now.
fn read_page(view: &dyn SpaceView, path: &str) -> Scanned {
    let Some(bytes) = view.read(path) else {
        return Scanned::default();
    };
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Scanned::default();
    }
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return Scanned::default();
    };
    Scanned {
        skill: parse_skill(path, text),
        data: page_data(text),
    }
}

/// Re-reads every page whose stamp changed and drops pages that are gone.
/// `false` when the listing failed (nothing is dropped then).
async fn rescan(view: &Arc<dyn SpaceView>, pages: &Arc<Mutex<Pages>>) -> bool {
    let (view, pages) = (view.clone(), pages.clone());
    tokio::task::spawn_blocking(move || {
        let Some(listing) = view.list_meta() else {
            return false;
        };
        let listing: HashMap<String, FileStamp> = listing
            .into_iter()
            .filter(|(path, _)| is_page(path))
            .collect();
        let changed: Vec<(String, FileStamp)> = {
            let pages = pages.lock().unwrap_or_else(|e| e.into_inner());
            listing
                .iter()
                .filter(|(path, stamp)| pages.stamps.get(*path) != Some(stamp))
                .map(|(path, stamp)| (path.clone(), *stamp))
                .collect()
        };
        let read: Vec<(String, FileStamp, Scanned)> = changed
            .into_iter()
            .map(|(path, stamp)| {
                let scanned = if stamp.size > MAX_FILE_BYTES {
                    Scanned::default()
                } else {
                    read_page(view.as_ref(), &path)
                };
                (path, stamp, scanned)
            })
            .collect();
        let mut pages = pages.lock().unwrap_or_else(|e| e.into_inner());
        pages.stamps.retain(|path, _| listing.contains_key(path));
        pages.skills.retain(|path, _| listing.contains_key(path));
        pages.data.retain(|path, _| listing.contains_key(path));
        for (path, stamp, scanned) in read {
            pages.stamps.insert(path.clone(), stamp);
            pages.store(path, scanned);
        }
        true
    })
    .await
    .unwrap_or(false)
}

/// Re-reads one changed (or deleted) page.
async fn refresh(view: &Arc<dyn SpaceView>, pages: &Arc<Mutex<Pages>>, path: String) {
    if !is_page(&path) {
        return;
    }
    let view = view.clone();
    let read_path = path.clone();
    let Ok(scanned) =
        tokio::task::spawn_blocking(move || read_page(view.as_ref(), &read_path)).await
    else {
        return;
    };
    let mut pages = pages.lock().unwrap_or_else(|e| e.into_inner());
    // Its stamp is unknown until the next listing, which re-reads it.
    pages.stamps.remove(&path);
    pages.store(path, scanned);
}
