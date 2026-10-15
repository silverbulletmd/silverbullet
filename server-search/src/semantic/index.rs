//! One space's semantic index: per page, its chunks (where each sits in the
//! page, its hash and vector) and the page vector. Search is brute force, a
//! dot product per chunk (every vector is unit length).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::chunk::ChunkText;
use crate::FileStamp;

/// Passages a page contributes to a result.
pub const PASSAGES: usize = 3;
/// Reciprocal rank fusion constant.
pub const RRF_K: f32 = 60.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// Byte offset and length of the chunk's text in the page.
    pub start: u32,
    pub len: u32,
    /// UTF-16 offset and 1-based line of the chunk start, for `Match`.
    pub pos: u32,
    pub line: u32,
    pub heading: Option<String>,
    /// [`ChunkText::hash`] (heading and text): an unchanged hash keeps its vector.
    pub hash: [u8; 32],
    pub vector: Vec<f32>,
}

impl Chunk {
    pub fn new(text: &ChunkText, vector: Vec<f32>) -> Chunk {
        Chunk {
            start: text.start,
            len: text.text.len() as u32,
            pos: text.pos,
            line: text.line,
            heading: text.heading.clone(),
            hash: text.hash,
            vector,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub stamp: FileStamp,
    pub chunks: Vec<Chunk>,
    /// The normalised mean of the chunk vectors; `None` without chunks.
    pub vector: Option<Vec<f32>>,
}

impl Page {
    pub fn new(stamp: FileStamp, chunks: Vec<Chunk>) -> Page {
        let vector = mean(chunks.iter().map(|c| c.vector.as_slice()));
        Page {
            stamp,
            chunks,
            vector,
        }
    }
}

/// A page and how close it is.
#[derive(Debug, Clone, PartialEq)]
pub struct Scored {
    pub path: String,
    /// The best chunk's cosine (for related pages, the page vectors').
    pub score: f32,
    /// Chunk indexes with their cosine, best first, at most [`PASSAGES`].
    pub chunks: Vec<(usize, f32)>,
}

#[derive(Debug, Default)]
pub struct VectorIndex {
    dim: usize,
    pages: HashMap<String, Page>,
    chunks: usize,
    /// [`VectorIndex::centroid`], computed by the first damped
    /// [`VectorIndex::related`] after a change.
    centroid: OnceLock<Option<Vec<f32>>>,
}

impl VectorIndex {
    pub fn new(dim: usize) -> VectorIndex {
        VectorIndex {
            dim,
            ..VectorIndex::default()
        }
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub fn len(&self) -> usize {
        self.pages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.pages.is_empty()
    }

    pub fn chunk_count(&self) -> usize {
        self.chunks
    }

    pub fn get(&self, path: &str) -> Option<&Page> {
        self.pages.get(path)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &Page)> {
        self.pages.iter().map(|(path, page)| (path.as_str(), page))
    }

    pub fn stamps(&self) -> HashMap<String, FileStamp> {
        self.pages
            .iter()
            .map(|(path, page)| (path.clone(), page.stamp))
            .collect()
    }

    /// Replaces `path`'s page. Chunks whose vector doesn't have
    /// [`VectorIndex::dim`] values are dropped, and the page vector is
    /// recomputed from the rest.
    pub fn insert(&mut self, path: String, page: Page) {
        let dim = self.dim;
        let chunks: Vec<Chunk> = page
            .chunks
            .into_iter()
            .filter(|c| c.vector.len() == dim)
            .collect();
        self.chunks += chunks.len();
        self.centroid.take();
        if let Some(old) = self.pages.insert(path, Page::new(page.stamp, chunks)) {
            self.chunks -= old.chunks.len();
        }
    }

    pub fn remove(&mut self, path: &str) -> Option<Page> {
        let old = self.pages.remove(path)?;
        self.centroid.take();
        self.chunks -= old.chunks.len();
        Some(old)
    }

    /// The pages `admit` lets through that have a chunk at least `min`
    /// similar to `query`, best first (ties by path), at most `k`.
    pub fn nearest(
        &self,
        query: &[f32],
        admit: &dyn Fn(&str) -> bool,
        min: f32,
        k: usize,
    ) -> Vec<Scored> {
        let mut out: Vec<Scored> = self
            .pages
            .iter()
            .filter(|(path, _)| admit(path))
            .filter_map(|(path, page)| {
                let mut chunks: Vec<(usize, f32)> = page
                    .chunks
                    .iter()
                    .enumerate()
                    .map(|(i, c)| (i, cosine(query, &c.vector)))
                    .filter(|(_, score)| *score >= min)
                    .collect();
                chunks.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
                chunks.truncate(PASSAGES);
                let score = chunks.first()?.1;
                Some(Scored {
                    path: path.clone(),
                    score,
                    chunks,
                })
            })
            .collect();
        sort_scored(&mut out);
        out.truncate(k);
        out
    }

    /// The normalised mean of every page vector: the direction of the
    /// space's hubs (a page's mean cosine to all pages is its cosine to the
    /// unnormalised mean). `None` without page vectors. Summed in path
    /// order, so the same pages always give the same bits.
    pub fn centroid(&self) -> Option<Vec<f32>> {
        let mut pages: Vec<(&String, &[f32])> = self
            .pages
            .iter()
            .filter_map(|(path, p)| Some((path, p.vector.as_deref()?)))
            .collect();
        pages.sort_unstable_by(|a, b| a.0.cmp(b.0));
        mean(pages.into_iter().map(|(_, v)| v))
    }

    /// The pages related to `path`, `path` left out, best first, at most
    /// `k`; each with its chunk closest to `path`'s page vector. A page
    /// scores `cos(target, page) - damping * cos(page, centroid)`, which
    /// ranks hubs (pages close to everything) below specific neighbours,
    /// and must score at least `min`. `None` when `path` isn't indexed.
    pub fn related(
        &self,
        path: &str,
        admit: &dyn Fn(&str) -> bool,
        min: f32,
        damping: f32,
        k: usize,
    ) -> Option<Vec<Scored>> {
        let page = self.pages.get(path)?;
        let Some(target) = &page.vector else {
            return Some(Vec::new());
        };
        // Undamped, no centroid: O(pages * dim) saved.
        let centroid = if damping != 0.0 {
            self.centroid.get_or_init(|| self.centroid()).as_deref()
        } else {
            None
        };
        let mut out: Vec<Scored> = self
            .pages
            .iter()
            .filter(|(other, _)| other.as_str() != path && admit(other))
            .filter_map(|(other, page)| {
                let vector = page.vector.as_ref()?;
                let mut score = cosine(target, vector);
                if let Some(c) = centroid {
                    score -= damping * cosine(vector, c);
                }
                if score < min {
                    return None;
                }
                let best = page
                    .chunks
                    .iter()
                    .enumerate()
                    .map(|(i, c)| (i, cosine(target, &c.vector)))
                    .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))?;
                Some(Scored {
                    path: other.clone(),
                    score,
                    chunks: vec![best],
                })
            })
            .collect();
        sort_scored(&mut out);
        out.truncate(k);
        Some(out)
    }
}

fn sort_scored(hits: &mut [Scored]) {
    hits.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.path.cmp(&b.path))
    });
}

/// The dot product: the cosine of two unit vectors.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// The normalised mean of `vectors`; `None` for none (or a zero sum).
fn mean<'a>(vectors: impl Iterator<Item = &'a [f32]>) -> Option<Vec<f32>> {
    let mut sum: Option<Vec<f32>> = None;
    for v in vectors {
        match &mut sum {
            None => sum = Some(v.to_vec()),
            Some(s) => s.iter_mut().zip(v).for_each(|(a, b)| *a += b),
        }
    }
    let mut sum = sum?;
    let norm = sum.iter().map(|x| x * x).sum::<f32>().sqrt();
    if !norm.is_finite() || norm <= 0.0 {
        return None;
    }
    sum.iter_mut().for_each(|x| *x /= norm);
    Some(sum)
}

/// Keeps the hits (best first) whose score is within `gap` of the best one:
/// Desktop's rule against a long tail of weak matches.
pub fn within_gap(mut hits: Vec<Scored>, gap: f32) -> Vec<Scored> {
    if let Some(best) = hits.first().map(|h| h.score) {
        hits.retain(|h| h.score >= best - gap);
    }
    hits
}

/// Reciprocal rank fusion of the lexical ranking (paths, best first) and the
/// vector hits: a page scores the sum of `weight / (RRF_K + rank)` over the
/// lists it is in, ranks counting from 1. Vector hits weigh 1, lexical hits
/// `lexical_weight`; at 0 or below the lexical list is left out. Best first;
/// ties keep the order pages were first seen in (lexical list first).
pub fn fuse<'a>(
    lexical: impl IntoIterator<Item = &'a str>,
    lexical_weight: f32,
    vector: &'a [Scored],
) -> Vec<String> {
    fuse_scored(lexical, lexical_weight, vector)
        .into_iter()
        .map(|(path, _)| path)
        .collect()
}

/// [`fuse`] with each page's RRF score.
pub fn fuse_scored<'a>(
    lexical: impl IntoIterator<Item = &'a str>,
    lexical_weight: f32,
    vector: &'a [Scored],
) -> Vec<(String, f32)> {
    let mut scores: HashMap<&'a str, (f32, usize)> = HashMap::new();
    let lexical = lexical
        .into_iter()
        .take_while(|_| lexical_weight > 0.0)
        .enumerate()
        .map(|(rank, path)| (rank, path, lexical_weight));
    let vector = vector
        .iter()
        .map(|h| h.path.as_str())
        .enumerate()
        .map(|(rank, path)| (rank, path, 1.0));
    for (rank, path, weight) in lexical.chain(vector) {
        let seen = scores.len();
        let entry = scores.entry(path).or_insert((0.0, seen));
        entry.0 += weight / (RRF_K + rank as f32 + 1.0);
    }
    let mut out: Vec<(&str, f32, usize)> = scores
        .into_iter()
        .map(|(path, (score, seen))| (path, score, seen))
        .collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.2.cmp(&b.2)));
    out.into_iter()
        .map(|(path, score, _)| (path.to_string(), score))
        .collect()
}

/// One page of Natural's hybrid ranking.
#[derive(Debug, Clone, PartialEq)]
pub struct Ranked {
    pub path: String,
    pub score: f32,
    /// The lexical half placed it: it counted in the fusion (the lexical
    /// list weighs above 0), or it follows the fused pages. Its passages
    /// come from the full-text index first, else from its best chunks.
    pub lexical_first: bool,
}

/// Natural mode's hybrid ranking: [`fuse_scored`] with the
/// lexical list at weight 1, or at `similar_weight` when `similar` (the
/// full-text similar tier answered). Then, when `similar`, the lexical
/// pages the fusion doesn't hold follow in the similar tier's own order,
/// each scoring strictly below every fused page (the `i`-th, from 0, gets
/// the lowest fused score, or `1 / (RRF_K + 1)` when nothing fused, divided
/// by `i + 2`).
pub fn rank_hybrid<'a>(
    lexical: &[&'a str],
    similar: bool,
    similar_weight: f32,
    vector: &'a [Scored],
) -> Vec<Ranked> {
    let weight = if similar { similar_weight } else { 1.0 };
    let mut ranked: Vec<Ranked> = fuse_scored(lexical.iter().copied(), weight, vector)
        .into_iter()
        .map(|(path, score)| Ranked {
            path,
            score,
            lexical_first: weight > 0.0,
        })
        .collect();
    if similar {
        let floor = ranked.last().map_or(1.0 / (RRF_K + 1.0), |r| r.score);
        let held: HashSet<String> = ranked.iter().map(|r| r.path.clone()).collect();
        let appended = lexical
            .iter()
            .filter(|path| !held.contains(**path))
            .enumerate()
            .map(|(i, path)| Ranked {
                path: path.to_string(),
                score: floor / (i as f32 + 2.0),
                lexical_first: true,
            })
            .collect::<Vec<_>>();
        ranked.extend(appended);
    }
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAMP: FileStamp = FileStamp {
        modified: 1,
        size: 10,
    };

    /// A unit vector in 4 dimensions, normalised from `v`.
    fn unit(v: [f32; 4]) -> Vec<f32> {
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter().map(|x| x / n).collect()
    }

    fn chunk(vector: Vec<f32>, start: u32) -> Chunk {
        Chunk {
            start,
            len: 5,
            pos: start,
            line: 1,
            heading: None,
            hash: [start as u8; 32],
            vector,
        }
    }

    fn page(vectors: &[[f32; 4]]) -> Page {
        let chunks = vectors
            .iter()
            .enumerate()
            .map(|(i, v)| chunk(unit(*v), i as u32 * 10))
            .collect();
        Page::new(STAMP, chunks)
    }

    fn index() -> VectorIndex {
        let mut index = VectorIndex::new(4);
        index.insert(
            "Bike/Puncture.md".into(),
            page(&[[1., 0., 0., 0.], [0.9, 0.1, 0., 0.]]),
        );
        index.insert("Bike/Chain.md".into(), page(&[[0.7, 0.7, 0., 0.]]));
        index.insert("Kitchen/Coffee.md".into(), page(&[[0., 0., 1., 0.]]));
        index
    }

    fn paths(hits: &[Scored]) -> Vec<&str> {
        hits.iter().map(|h| h.path.as_str()).collect()
    }

    #[test]
    fn a_page_vector_is_the_normalised_mean_of_its_chunks() {
        let p = page(&[[1., 0., 0., 0.], [0., 1., 0., 0.]]);
        let v = p.vector.unwrap();
        assert!((v[0] - 0.70710677).abs() < 1e-6 && (v[1] - 0.70710677).abs() < 1e-6);
        assert_eq!(Page::new(STAMP, vec![]).vector, None);
    }

    #[test]
    fn nearest_ranks_pages_by_their_best_chunk() {
        let index = index();
        let q = unit([1., 0., 0., 0.]);
        let hits = index.nearest(&q, &|_| true, 0.5, 10);
        assert_eq!(paths(&hits), ["Bike/Puncture.md", "Bike/Chain.md"]);
        assert_eq!(
            hits[0].chunks.len(),
            2,
            "both chunks pass the minimum, best first"
        );
        assert_eq!(hits[0].chunks[0].0, 0);
        assert!((hits[0].score - 1.0).abs() < 1e-6);
        assert_eq!(
            paths(&index.nearest(&q, &|_| true, 0.5, 1)),
            ["Bike/Puncture.md"]
        );
        let not_puncture = |p: &str| p != "Bike/Puncture.md";
        assert_eq!(
            paths(&index.nearest(&q, &not_puncture, 0.5, 10)),
            ["Bike/Chain.md"]
        );
        assert!(index
            .nearest(&unit([0., 0., 0., 1.]), &|_| true, 0.5, 10)
            .is_empty());
    }

    #[test]
    fn at_most_three_passages_per_page() {
        let mut index = VectorIndex::new(4);
        index.insert("Long.md".into(), page(&[[1., 0., 0., 0.]; 5]));
        let hits = index.nearest(&unit([1., 0., 0., 0.]), &|_| true, 0.0, 10);
        assert_eq!(
            hits[0].chunks.iter().map(|c| c.0).collect::<Vec<_>>(),
            [0, 1, 2]
        );
    }

    #[test]
    fn related_compares_page_vectors_and_leaves_the_page_out() {
        let index = index();
        let related = index
            .related("Bike/Puncture.md", &|_| true, 0.5, 0.0, 10)
            .unwrap();
        assert_eq!(paths(&related), ["Bike/Chain.md"]);
        assert_eq!(related[0].chunks.len(), 1);
        assert!(index
            .related("Bike/Puncture.md", &|_| true, 0.99, 0.0, 10)
            .unwrap()
            .is_empty());
        assert_eq!(index.related("Missing.md", &|_| true, 0.0, 0.0, 10), None);
    }

    #[test]
    fn damping_ranks_a_hub_below_a_specific_neighbour() {
        // Invented vectors: the hub is close to everything, the neighbour
        // only to the target.
        let mut index = VectorIndex::new(4);
        for (path, v) in [
            ("Basil.md", [1.0, 0.2, 0.0, 0.0]),
            ("Pesto.md", [0.95, 0.0, 0.3, 0.0]),
            ("Inbox.md", [0.7, 0.7, 0.1, 0.0]),
            ("Bikes.md", [0.0, 1.0, 0.0, 0.0]),
            ("Tires.md", [0.1, 0.9, 0.4, 0.0]),
        ] {
            index.insert(path.into(), page(&[v]));
        }
        let undamped = index.related("Basil.md", &|_| true, -1.0, 0.0, 2).unwrap();
        let damped = index.related("Basil.md", &|_| true, -1.0, 0.8, 2).unwrap();
        assert_eq!(paths(&undamped), ["Pesto.md", "Inbox.md"]);
        assert_eq!(damped[0].path, "Pesto.md");
        let hub_gone = damped.iter().all(|s| s.path != "Inbox.md");
        assert!(hub_gone || damped[1].score < undamped[1].score);
        // The score is the cosine less the damped hub term; `min` applies to it.
        let c = index.centroid().unwrap();
        let inbox = index.get("Inbox.md").unwrap().vector.clone().unwrap();
        assert_eq!(
            damped[1].score,
            undamped[1].score - 0.8 * cosine(&inbox, &c)
        );
        let strict = index.related("Basil.md", &|_| true, 0.3, 0.8, 10).unwrap();
        assert_eq!(paths(&strict), ["Pesto.md"]);
        assert_eq!(VectorIndex::new(4).centroid(), None);
    }

    #[test]
    fn the_damping_centroid_follows_inserts_and_removes() {
        let mut index = VectorIndex::new(4);
        index.insert("Basil.md".into(), page(&[[1.0, 0.2, 0.0, 0.0]]));
        index.insert("Pesto.md".into(), page(&[[0.95, 0.0, 0.3, 0.0]]));
        let damped = |index: &VectorIndex| {
            let hits = index.related("Basil.md", &|_| true, -1.0, 0.8, 1).unwrap();
            let pesto = index.get("Pesto.md").unwrap().vector.clone().unwrap();
            let target = index.get("Basil.md").unwrap().vector.clone().unwrap();
            let expected =
                cosine(&target, &pesto) - 0.8 * cosine(&pesto, &index.centroid().unwrap());
            (hits[0].score, expected)
        };
        let (score, expected) = damped(&index);
        assert_eq!(score, expected);
        index.insert("Bikes.md".into(), page(&[[0.0, 1.0, 0.0, 0.0]]));
        let (moved, expected) = damped(&index);
        assert_eq!(moved, expected, "an insert moves the centroid");
        assert_ne!(moved, score);
        index.remove("Bikes.md");
        assert_eq!(damped(&index), (score, score), "a remove moves it back");
    }

    #[test]
    fn insert_replaces_and_remove_forgets() {
        let mut index = index();
        assert_eq!((index.len(), index.chunk_count()), (3, 4));
        index.insert("Bike/Chain.md".into(), page(&[[0., 1., 0., 0.]; 3]));
        assert_eq!((index.len(), index.chunk_count()), (3, 6));
        assert!(index.remove("Bike/Chain.md").is_some());
        assert_eq!((index.len(), index.chunk_count()), (2, 3));
        assert!(index.remove("Bike/Chain.md").is_none());
        assert_eq!(index.stamps().len(), 2);
        // A chunk of another dimension never enters the index.
        index.insert(
            "Odd.md".into(),
            Page::new(STAMP, vec![chunk(vec![1.0; 8], 0)]),
        );
        assert_eq!(index.get("Odd.md").unwrap().chunks.len(), 0);
    }

    #[test]
    fn within_gap_keeps_the_hits_close_to_the_best() {
        let index = index();
        let hits = index.nearest(&unit([1., 0., 0., 0.]), &|_| true, 0.0, 10);
        assert_eq!(paths(&within_gap(hits.clone(), 0.1)), ["Bike/Puncture.md"]);
        assert_eq!(within_gap(hits, 0.5).len(), 2);
        assert!(within_gap(Vec::new(), 0.1).is_empty());
    }

    #[test]
    fn fusion_puts_pages_in_both_lists_first() {
        let index = index();
        let vector = index.nearest(&unit([0.7, 0.7, 0., 0.]), &|_| true, 0.5, 10);
        assert_eq!(paths(&vector), ["Bike/Chain.md", "Bike/Puncture.md"]);
        let fused = fuse(["Bike/Puncture.md", "Notes/Tyres.md"], 1.0, &vector);
        assert_eq!(
            fused,
            ["Bike/Puncture.md", "Bike/Chain.md", "Notes/Tyres.md"]
        );
        assert_eq!(
            fuse(std::iter::empty(), 1.0, &vector),
            ["Bike/Chain.md", "Bike/Puncture.md"]
        );
        assert_eq!(fuse(["A.md", "B.md"], 1.0, &[]), ["A.md", "B.md"]);
    }

    #[test]
    fn fused_scores_are_the_rrf_sums() {
        let index = index();
        let vector = index.nearest(&unit([0.7, 0.7, 0., 0.]), &|_| true, 0.5, 10);
        let fused = fuse_scored(["Bike/Puncture.md"], 1.0, &vector);
        let rrf = |rank: f32| 1.0 / (RRF_K + rank);
        assert_eq!(
            fused[0],
            ("Bike/Puncture.md".to_string(), rrf(1.) + rrf(2.))
        );
        assert_eq!(fused[1], ("Bike/Chain.md".to_string(), rrf(1.)));
    }

    /// A lexical hit weighs `lexical_weight`, a vector hit 1.
    #[test]
    fn a_weighted_lexical_hit_at_rank_one_scores_its_weight_over_k_plus_one() {
        let index = index();
        let vector = index.nearest(&unit([0.7, 0.7, 0., 0.]), &|_| true, 0.5, 10);
        assert_eq!(paths(&vector), ["Bike/Chain.md", "Bike/Puncture.md"]);
        let rrf = |weight: f32, rank: f32| weight / (RRF_K + rank);
        for w in [0.1, 0.25, 0.5, 1.0] {
            let fused = fuse_scored(["Notes/Tyres.md", "Bike/Puncture.md"], w, &[]);
            assert_eq!(fused[0], ("Notes/Tyres.md".to_string(), rrf(w, 1.)));
            let fused = fuse_scored(["Notes/Tyres.md", "Bike/Puncture.md"], w, &vector);
            let score = |path: &str| fused.iter().find(|(p, _)| p == path).unwrap().1;
            assert_eq!(score("Notes/Tyres.md"), rrf(w, 1.));
            assert_eq!(score("Bike/Puncture.md"), rrf(w, 2.) + rrf(1.0, 2.));
            assert_eq!(score("Bike/Chain.md"), rrf(1.0, 1.));
        }
        // A small weight lets the vector ranking lead.
        let fused = fuse(["Notes/Tyres.md"], 0.25, &vector);
        assert_eq!(
            fused,
            ["Bike/Chain.md", "Bike/Puncture.md", "Notes/Tyres.md"]
        );
        // Weight 0 leaves the lexical list out, as if it were empty.
        assert_eq!(
            fuse(["Notes/Tyres.md", "Bike/Puncture.md"], 0.0, &vector),
            ["Bike/Chain.md", "Bike/Puncture.md"]
        );
        assert!(fuse(["Notes/Tyres.md"], 0.0, &[]).is_empty());
    }

    /// Similar-tier pages the fusion leaves out follow it, in their
    /// own order, below every fused page; alone when nothing fused.
    #[test]
    fn similar_pages_follow_the_fused_ranking() {
        let index = index();
        let vector = index.nearest(&unit([0.7, 0.7, 0., 0.]), &|_| true, 0.5, 10);
        assert_eq!(paths(&vector), ["Bike/Chain.md", "Bike/Puncture.md"]);
        let lexical = ["Notes/Tyres.md", "Bike/Puncture.md", "Notes/Pump.md"];
        let ranked = rank_hybrid(&lexical, true, 0.0, &vector);
        let order: Vec<&str> = ranked.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(
            order,
            [
                "Bike/Chain.md",
                "Bike/Puncture.md",
                "Notes/Tyres.md",
                "Notes/Pump.md"
            ]
        );
        let firsts: Vec<bool> = ranked.iter().map(|r| r.lexical_first).collect();
        assert_eq!(
            firsts,
            [false, false, true, true],
            "fused at weight 0: by meaning"
        );
        assert!(
            ranked.windows(2).all(|w| w[0].score > w[1].score),
            "{ranked:?}"
        );
        // Nothing fused: the similar pages alone, in their order.
        let ranked = rank_hybrid(&lexical, true, 0.0, &[]);
        let order: Vec<&str> = ranked.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(order, lexical);
        assert!(ranked.iter().all(|r| r.score > 0.0 && r.lexical_first));
        let scored = |ranked: Vec<Ranked>| -> Vec<(String, f32)> {
            ranked.into_iter().map(|r| (r.path, r.score)).collect()
        };
        // At a weight above 0 every similar page is fused already.
        let ranked = rank_hybrid(&lexical, true, 0.5, &vector);
        assert!(ranked.iter().all(|r| r.lexical_first));
        assert_eq!(scored(ranked), fuse_scored(lexical, 0.5, &vector));
        // The exact tier is plain fusion at weight 1.
        let ranked = rank_hybrid(&lexical, false, 0.0, &vector);
        assert!(ranked.iter().all(|r| r.lexical_first));
        assert_eq!(scored(ranked), fuse_scored(lexical, 1.0, &vector));
    }
}
