//! The semantic index's caps (pages and chunks per space) as an apply
//! spends them.

use super::index::VectorIndex;
use crate::Change;

/// The caps (M2R17) as an apply spends them: chunked pages and chunks of
/// the space so far, page by page. Only pages with chunks count: a page
/// stored without chunks holds no place, so it never pushes an indexed page
/// out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Budget {
    pages: usize,
    chunks: usize,
    max_pages: usize,
    max_chunks: usize,
}

impl Budget {
    /// The budget of `index` with `caps` (pages, chunks), after the deletes
    /// in `changes`: they make room before the batch's upserts are counted.
    pub(crate) fn after_deletes(
        index: &VectorIndex,
        caps: (usize, usize),
        changes: &[Change],
    ) -> Budget {
        let mut budget = Budget {
            pages: index.iter().filter(|(_, p)| !p.chunks.is_empty()).count(),
            chunks: index.chunk_count(),
            max_pages: caps.0,
            max_chunks: caps.1,
        };
        for change in changes {
            if let Change::Delete { path } = change {
                if let Some(page) = index.get(path).filter(|p| !p.chunks.is_empty()) {
                    budget.pages -= 1;
                    budget.chunks -= page.chunks.len();
                }
            }
        }
        budget
    }

    /// How many of the `wanted` chunks of a page that has `old_chunks` now
    /// to keep, counted into the budget. A page inside the caps already
    /// keeps the chunks the chunk cap still has room for; a page beyond a
    /// cap keeps none (it is stamped without chunks).
    pub(crate) fn admit(&mut self, old_chunks: usize, wanted: usize) -> usize {
        // The space's chunks without this page's.
        let others = self.chunks.saturating_sub(old_chunks);
        let room = self.max_chunks.saturating_sub(others);
        let keep = if old_chunks > 0 {
            wanted.min(room)
        } else if wanted > 0 && (self.pages >= self.max_pages || wanted > room) {
            0
        } else {
            wanted
        };
        if old_chunks > 0 {
            self.pages -= 1;
        }
        if keep > 0 {
            self.pages += 1;
        }
        self.chunks = others + keep;
        keep
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::index::{Chunk, Page};
    use crate::semantic::sink::{MAX_CHUNKS, MAX_PAGES};
    use crate::FileStamp;

    fn budget(pages: usize, chunks: usize, max_pages: usize, max_chunks: usize) -> Budget {
        Budget {
            pages,
            chunks,
            max_pages,
            max_chunks,
        }
    }

    /// An index whose pages have these many chunks each.
    fn index_of(pages: &[(&str, usize)]) -> VectorIndex {
        let mut index = VectorIndex::new(2);
        for (path, chunks) in pages {
            let chunks = (0..*chunks)
                .map(|i| Chunk {
                    start: 0,
                    len: 1,
                    pos: 0,
                    line: 1,
                    heading: None,
                    hash: [i as u8; 32],
                    vector: vec![1.0, 0.0],
                })
                .collect();
            let stamp = FileStamp {
                modified: 1,
                size: 1,
            };
            index.insert(path.to_string(), Page::new(stamp, chunks));
        }
        index
    }

    fn delete(path: &str) -> Change {
        Change::Delete { path: path.into() }
    }

    #[test]
    fn the_page_cap_admits_new_pages_until_it_is_full() {
        let mut b = budget(0, 0, 2, MAX_CHUNKS);
        assert_eq!(b.admit(0, 1), 1);
        assert_eq!(b.admit(0, 1), 1);
        assert_eq!(b.admit(0, 1), 0, "a new page beyond the cap");
        assert_eq!(b.admit(0, 0), 0, "a page without chunks is no cap matter");
        assert_eq!(b, budget(2, 2, 2, MAX_CHUNKS));
    }

    #[test]
    fn at_the_page_cap_edits_keep_their_chunks_and_new_pages_get_none() {
        let mut b = budget(2, 2, 2, MAX_CHUNKS);
        assert_eq!(b.admit(1, 2), 2, "an edit inside the cap keeps its chunks");
        assert_eq!(b.admit(0, 1), 0, "a new page beyond the cap");
        assert_eq!(b.admit(1, 1), 1, "edits never wear the index away");
        assert_eq!(b, budget(2, 3, 2, MAX_CHUNKS));
    }

    #[test]
    fn deletes_in_the_batch_make_room_and_a_chunkless_page_gets_chunks_when_edited() {
        let index = index_of(&[("A.md", 1), ("B.md", 1), ("C.md", 0)]);
        let caps = (2, MAX_CHUNKS);
        assert_eq!(
            Budget::after_deletes(&index, caps, &[delete("C.md"), delete("Gone.md")]),
            budget(2, 2, 2, MAX_CHUNKS),
            "a page without chunks frees nothing"
        );
        let mut b = Budget::after_deletes(&index, caps, &[delete("A.md")]);
        assert_eq!(b, budget(1, 1, 2, MAX_CHUNKS));
        assert_eq!(b.admit(0, 1), 1, "the delete made room");
        assert_eq!(b.admit(0, 1), 0, "full again: the chunkless page stays so");
        let mut b = Budget::after_deletes(&index, caps, &[delete("A.md"), delete("B.md")]);
        assert_eq!(b.admit(0, 1), 1, "room again: its edit is chunked");
    }

    #[test]
    fn at_the_chunk_cap_an_edit_keeps_the_chunks_that_fit() {
        let index = index_of(&[("A.md", 2), ("B.md", 1)]);
        let mut b = Budget::after_deletes(&index, (MAX_PAGES, 3), &[]);
        assert_eq!(b, budget(2, 3, MAX_PAGES, 3));
        assert_eq!(b.admit(1, 2), 1, "only the chunks that fit");
        assert_eq!(b.admit(0, 1), 0, "a new page past the chunk cap");
        assert_eq!(b, budget(2, 3, MAX_PAGES, 3));
    }
}
