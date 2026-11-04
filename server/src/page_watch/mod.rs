//! What a space's own files tell readers outside the editor, kept current
//! from the space's change events: the skill and tag catalog behind
//! `GET /.help`, the space's bundled skills, and the change count behind
//! `X-Await-Index`.

pub mod catalog;
pub mod catch_up;

use std::sync::{Arc, OnceLock};

use silverbullet_server_common::SpacePrimitives;
use space_tools::skills::{bundled_skills, Skill};

use crate::search::PageSource;
use catalog::PageCatalog;
use catch_up::ChangeCounter;

const STD_PREFIX: &str = "Library/Std/";

pub struct PageWatch {
    pages: Option<PageSource>,
    catalog: OnceLock<Arc<PageCatalog>>,
    changes: OnceLock<Arc<ChangeCounter>>,
    bundled: OnceLock<Vec<Skill>>,
    /// The read-only layer the space's bundled files come from.
    base: Option<Arc<dyn SpacePrimitives>>,
}

impl PageWatch {
    pub fn new(pages: Option<PageSource>) -> Self {
        Self {
            pages,
            catalog: OnceLock::new(),
            changes: OnceLock::new(),
            bundled: OnceLock::new(),
            base: None,
        }
    }

    /// Reads the bundled skills from `base`, the layer under the space's own
    /// files, so a space's copy of a bundled page cannot hide the original.
    pub fn with_base(mut self, base: Arc<dyn SpacePrimitives>) -> Self {
        self.base = Some(base);
        self
    }

    /// For a space whose pages nothing follows (tests, embedders without a
    /// change feed).
    pub fn none() -> Self {
        Self::new(None)
    }

    pub fn pages(&self) -> Option<&PageSource> {
        self.pages.as_ref()
    }

    /// The catalog following this space's pages, started on the first call.
    /// Must be called inside a tokio runtime.
    pub fn catalog(&self) -> Option<Arc<PageCatalog>> {
        let pages = self.pages.as_ref()?;
        Some(
            self.catalog
                .get_or_init(|| Arc::new(PageCatalog::start(pages)))
                .clone(),
        )
    }

    /// Whether this space's pages changed since the runtime last caught up,
    /// counted from the first call. Must be called inside a tokio runtime.
    pub fn changes(&self) -> Option<Arc<ChangeCounter>> {
        let pages = self.pages.as_ref()?;
        Some(
            self.changes
                .get_or_init(|| Arc::new(ChangeCounter::start(pages)))
                .clone(),
        )
    }

    /// The skills among the bundled `Library/Std` files, read on the first
    /// call that can list them: the base layer's when one is set, otherwise
    /// `space`'s read-only ones. Blocking: reads storage.
    pub fn bundled_skills(&self, space: &dyn SpacePrimitives) -> Vec<Skill> {
        if let Some(skills) = self.bundled.get() {
            return skills.clone();
        }
        let space = self.base.as_deref().unwrap_or(space);
        let Ok(files) = space.fetch_file_list() else {
            return Vec::new();
        };
        let skills = bundled_skills(
            files
                .into_iter()
                .filter(|f| is_bundled(&f.name, &f.perm) && f.name.ends_with(".md"))
                .filter_map(|f| Some((f.name.clone(), space.read_file(&f.name).ok()?.0))),
        );
        self.bundled.get_or_init(|| skills).clone()
    }
}

/// A file of the space's read-only base layer under `Library/Std/`.
pub(crate) fn is_bundled(path: &str, perm: &str) -> bool {
    perm == "ro" && path.starts_with(STD_PREFIX)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use silverbullet_server_common::space::MemorySpacePrimitives;
    use silverbullet_server_common::{FileMeta, SpaceError};

    use super::*;

    /// Std files served read-only, whose listing fails while `failing` is set.
    struct Flaky {
        inner: MemorySpacePrimitives,
        failing: AtomicBool,
    }

    impl SpacePrimitives for Flaky {
        fn fetch_file_list(&self) -> Result<Vec<FileMeta>, SpaceError> {
            if self.failing.load(Ordering::SeqCst) {
                return Err(SpaceError::Io(std::io::Error::other("listing failed")));
            }
            Ok(self
                .inner
                .fetch_file_list()?
                .into_iter()
                .map(|mut f| {
                    f.perm = "ro".into();
                    f
                })
                .collect())
        }
        fn get_file_meta(&self, path: &str) -> Result<FileMeta, SpaceError> {
            self.inner.get_file_meta(path)
        }
        fn read_file(&self, path: &str) -> Result<(Vec<u8>, FileMeta), SpaceError> {
            self.inner.read_file(path)
        }
        fn write_file(
            &self,
            path: &str,
            data: &[u8],
            meta: Option<&FileMeta>,
        ) -> Result<FileMeta, SpaceError> {
            self.inner.write_file(path, data, meta)
        }
        fn delete_file(&self, path: &str) -> Result<(), SpaceError> {
            self.inner.delete_file(path)
        }
    }

    #[test]
    fn a_failed_listing_is_retried_on_the_next_call() {
        let space = Flaky {
            inner: MemorySpacePrimitives::new(),
            failing: AtomicBool::new(true),
        };
        space
            .write_file(
                "Library/Std/Docs/Querying.md",
                b"---\ntags: meta/skill\ndescription: Use when querying.\n---\n",
                None,
            )
            .unwrap();
        let watch = PageWatch::none();
        assert!(watch.bundled_skills(&space).is_empty());
        space.failing.store(false, Ordering::SeqCst);
        let pages: Vec<String> = watch
            .bundled_skills(&space)
            .into_iter()
            .map(|s| s.page)
            .collect();
        assert_eq!(pages, vec!["Library/Std/Docs/Querying".to_string()]);
    }
}
