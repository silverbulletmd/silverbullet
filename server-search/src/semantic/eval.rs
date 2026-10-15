//! What the search eval (`crates/search-eval`) measures beyond what
//! production serves: Natural with vectors alone, each page's score, and
//! Natural's candidates before any threshold (for its calibration). Built
//! with the `eval` feature (and in tests); production Natural always fuses
//! both halves.

use std::collections::HashMap;

use super::backend::{
    near, rank_natural as rank_hybrid_natural, NaturalCandidates, RELATED_BUILDING,
};
use super::catalog::Thresholds;
use super::index::{rank_hybrid, Ranked};
use super::SemanticBackend;
use crate::job::{run_blocking, validate_text, JobCx, STARTING};
use crate::{PageFilter, QueryRequest, RelatedRequest, RequestCx, SearchError};

/// How Natural ranks: both halves fused (production), or vectors alone
/// (the eval's `vector:` systems).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fusion {
    Hybrid,
    VectorOnly,
}

/// Natural's ranking of `c` under `th` with `fusion`, pure: production's
/// ranking for `Hybrid`; for `VectorOnly` the vector hits at least
/// `search_min` and within `max_gap` of the best alone. The calibration
/// replays it over a threshold grid.
pub fn rank_natural(c: &NaturalCandidates, fusion: Fusion, th: &Thresholds) -> Vec<Ranked> {
    match fusion {
        Fusion::Hybrid => rank_hybrid_natural(c, th),
        Fusion::VectorOnly => rank_hybrid(&[], false, th.similar_weight, &near(c, th)),
    }
}

/// The pages a query answered with, best first, each with its score.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ScoredPages {
    /// Page names (without `.md`) and scores.
    pub pages: Vec<(String, f32)>,
    /// The deadline cut the work short, or (hybrid) the full-text half
    /// wasn't open yet.
    pub partial: bool,
}

impl SemanticBackend {
    /// A Natural query ranked with `fusion`: the pages it answers with (at
    /// most the request's limit, only those whose passages can be read
    /// now), each with its score: the fused score for hybrid, the best
    /// chunk's cosine for vectors alone. `Unavailable` while the semantic
    /// index isn't ready (production answers from Words instead).
    pub async fn scored_natural(
        &self,
        req: QueryRequest,
        cx: RequestCx,
        fusion: Fusion,
    ) -> Result<ScoredPages, SearchError> {
        let text = validate_text(&req.query)?;
        if !self.space.state().is_ready() {
            return Err(SearchError::Unavailable(RELATED_BUILDING.into()));
        }
        let vector = self.space.inference().embed_query(&text, &cx).await?;
        let slot = cx.query_slot().await?;
        let job = self.job(text, vector, req.filter(), req.limit());
        let hybrid = fusion == Fusion::Hybrid;
        let finished = run_blocking(
            &cx,
            slot,
            "semantic search",
            move |work: &JobCx<ScoredPages>| {
                let gathered = job.gather(job.thresholds.search_min, hybrid)?;
                let ranked = rank_natural(&gathered.candidates, fusion, &job.thresholds);
                let cosines: HashMap<String, f32> = gathered
                    .candidates
                    .vector
                    .iter()
                    .map(|h| (h.path.clone(), h.score))
                    .collect();
                work.acc().partial = gathered.starting;
                job.passages(gathered, &ranked, work, |acc, r, found| {
                    if found.is_empty() {
                        return;
                    }
                    let score = match fusion {
                        Fusion::VectorOnly => cosines.get(&r.path).copied().unwrap_or(r.score),
                        Fusion::Hybrid => r.score,
                    };
                    acc.pages.push((page_name(&r.path), score));
                });
                Ok(())
            },
        )
        .await?;
        let mut scored = finished.acc;
        scored.partial |= finished.timed_out;
        Ok(scored)
    }

    /// Natural's candidates for `query` before any threshold: the query
    /// embedded, then the full-text ranking (no filter) and the nearest
    /// pages without a vector minimum. [`rank_natural`] ranks them exactly
    /// as Natural mode does. `Unavailable` until both indexes are open,
    /// `Busy` past the deadline.
    pub async fn candidates(
        &self,
        query: &str,
        cx: RequestCx,
    ) -> Result<NaturalCandidates, SearchError> {
        let text = validate_text(query)?;
        if !self.space.state().is_ready() {
            return Err(SearchError::Unavailable(RELATED_BUILDING.into()));
        }
        let vector = self.space.inference().embed_query(&text, &cx).await?;
        let slot = cx.query_slot().await?;
        let job = self.job(text, vector, PageFilter::default(), 0);
        let finished = run_blocking(
            &cx,
            slot,
            "semantic candidates",
            move |work: &JobCx<Option<NaturalCandidates>>| {
                let gathered = job.gather(f32::NEG_INFINITY, true)?;
                if gathered.starting {
                    return Err(SearchError::Unavailable(STARTING.into()));
                }
                *work.acc() = Some(gathered.candidates);
                Ok(())
            },
        )
        .await?;
        finished.acc.ok_or(SearchError::Busy)
    }

    /// Related Pages with each page's cosine to `req.page` (damped as
    /// Related ranks); nothing, partial, at the deadline.
    pub async fn scored_related(
        &self,
        req: RelatedRequest,
        cx: RequestCx,
    ) -> Result<ScoredPages, SearchError> {
        let finished = self
            .related_pages(
                req,
                cx,
                |_: &mut ScoredPages, _| {},
                |acc, path, score, found| {
                    if !found.is_empty() {
                        acc.pages.push((page_name(path), score));
                    }
                },
            )
            .await?;
        if finished.timed_out {
            return Ok(ScoredPages {
                pages: Vec::new(),
                partial: true,
            });
        }
        Ok(finished.acc)
    }
}

fn page_name(path: &str) -> String {
    path.strip_suffix(".md").unwrap_or(path).to_string()
}
