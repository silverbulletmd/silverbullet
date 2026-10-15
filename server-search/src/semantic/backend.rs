//! [`SemanticBackend`]: a space's full-text index plus its semantic index.
//! Words and Phrase go to the full-text index. Natural fuses the full-text
//! ranking (Words mode's: the exact tier, else similar pages, which weigh
//! the model's `similar_weight`) with vector similarity (RRF), and answers
//! from Words with a notice while the semantic index isn't ready.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::catalog::{ModelSpec, Thresholds};
use super::chunk;
use super::index::{rank_hybrid, within_gap, Ranked, Scored, VectorIndex};
use super::service::SemanticSpace;
use super::size;
use crate::backend::{BoxFut, SearchBackend, SpaceView};
use crate::fulltext;
use crate::index::page_text;
use crate::job::{self, run_blocking, validate_text, Acc, Finished, JobCx, SLOW_NOTICE, STARTING};
use crate::{
    limits, Capabilities, FullTextBackend, IndexReport, IndexState, Match, PageFilter, QueryMode,
    QueryRequest, QueryResult, RelatedRequest, RequestCx, SearchError, StatusResponse,
};
use silverbullet_server_common::page::parse_page;

const ID: &str = "semantic";
/// The modes queries support; the first is the default.
const MODES: [QueryMode; 3] = [QueryMode::Natural, QueryMode::Words, QueryMode::Phrase];
/// What public visitors may use while the semantic index isn't ready.
const BUILDING_MODES: [QueryMode; 2] = [QueryMode::Words, QueryMode::Phrase];
/// Pages each half ranks before fusion.
const CANDIDATES: usize = 50;
/// Characters of a chunk shown as a meaning match's excerpt.
const EXCERPT_CHARS: usize = 240;
const UNAVAILABLE_NOTICE: &str =
    "Semantic search isn't available right now; showing pages with all words";
pub(super) const RELATED_BUILDING: &str = "The semantic index is still building";
const NOT_INDEXED: &str = "This page isn't in the semantic index yet";
/// Related pages a request without a `limit` gets.
const RELATED_LIMIT: usize = 10;

pub struct SemanticBackend {
    pub(super) fulltext: Arc<FullTextBackend>,
    pub(super) space: Arc<SemanticSpace>,
    pub(super) view: Arc<dyn SpaceView>,
    /// The model's catalog thresholds.
    thresholds: Thresholds,
}

/// A chunk's excerpt: its first [`EXCERPT_CHARS`] characters, starting
/// after the page's frontmatter (which the first chunk embeds, for its tags,
/// but which reads as noise), unless the chunk is nothing but frontmatter.
fn excerpt(chunk: &str, frontmatter_left: usize) -> String {
    let body = match chunk.get(frontmatter_left..).map(str::trim_start) {
        Some(rest) if !rest.is_empty() => rest,
        _ => chunk,
    };
    let cut = body
        .char_indices()
        .nth(EXCERPT_CHARS)
        .map_or(body.len(), |(i, _)| i);
    body[..cut].trim_end().to_string()
}

/// Where one of a vector hit's best chunks sits in its page, copied out of
/// the index so its read guard isn't held while pages are read.
pub(super) struct Spot {
    start: u32,
    len: u32,
    pos: u32,
    line: u32,
    heading: Option<String>,
    hash: [u8; 32],
}

/// The spots of `hit`'s best chunks (none when its page left the index).
pub(super) fn spots(index: &VectorIndex, hit: &Scored) -> Vec<Spot> {
    let Some(page) = index.get(&hit.path) else {
        return Vec::new();
    };
    hit.chunks
        .iter()
        .filter_map(|(i, _)| page.chunks.get(*i))
        .map(|c| Spot {
            start: c.start,
            len: c.len,
            pos: c.pos,
            line: c.line,
            heading: c.heading.clone(),
            hash: c.hash,
        })
        .collect()
}

/// The passages of a vector hit: its best chunks, read from the page as
/// storage serves it now. A chunk whose text changed since it was indexed
/// (its hash no longer matches) is left out.
pub(super) fn chunk_passages(view: &dyn SpaceView, path: &str, spots: &[Spot]) -> Vec<Match> {
    if spots.is_empty() {
        return Vec::new();
    }
    let Ok(text) = page_text(view, path, None) else {
        return Vec::new();
    };
    let name = path.strip_suffix(".md").unwrap_or(path);
    let body_start = text.len() - parse_page(&text).body.len();
    spots
        .iter()
        .filter_map(|c| {
            let body = text.get(c.start as usize..(c.start + c.len) as usize)?;
            (chunk::hash(c.heading.as_deref(), body) == c.hash).then(|| Match {
                page: name.to_string(),
                pos: c.pos,
                line: c.line,
                heading: c.heading.clone(),
                excerpt: excerpt(body, body_start.saturating_sub(c.start as usize)),
                highlights: Vec::new(),
            })
        })
        .collect()
}

/// What Natural's two halves found for one query, best first, each at
/// most [`CANDIDATES`]: the input of [`rank_natural`].
#[derive(Debug, Clone, Default)]
pub struct NaturalCandidates {
    /// The full-text ranking's page paths (with `.md`): the exact tier,
    /// else similar pages.
    pub lexical: Vec<String>,
    /// The similar tier answered `lexical` (no page has every word).
    pub similar: bool,
    /// The nearest pages by meaning, with their best chunk's cosine.
    pub vector: Vec<Scored>,
}

/// Natural mode's ranking of `c` under `th`, pure: the vector hits at
/// least `search_min` and within `max_gap` of the best, fused with the
/// lexical half ([`rank_hybrid`], which also picks the similar tier's
/// weight). Natural answers its first pages, up to the request's limit.
pub(crate) fn rank_natural(c: &NaturalCandidates, th: &Thresholds) -> Vec<Ranked> {
    let lexical: Vec<&str> = c.lexical.iter().map(String::as_str).collect();
    rank_hybrid(&lexical, c.similar, th.similar_weight, &near(c, th))
}

/// The vector hits of `c` that count under `th`: at least `search_min`
/// and within `max_gap` of the best.
pub(super) fn near(c: &NaturalCandidates, th: &Thresholds) -> Vec<Scored> {
    let near: Vec<Scored> = c
        .vector
        .iter()
        .filter(|hit| hit.score >= th.search_min)
        .cloned()
        .collect();
    within_gap(near, th.max_gap)
}

/// What a Natural query has found so far.
#[derive(Default)]
struct NaturalAcc {
    found: Acc,
    /// Hybrid ranked by vectors alone: the full-text store isn't open yet.
    starting: bool,
}

/// A Natural query's candidates with what its passages are read from.
pub(super) struct Gathered {
    pub(super) candidates: NaturalCandidates,
    /// The lexical half (`None` when not asked for, or before the full-text
    /// store opens).
    pub(super) ranking: Option<fulltext::Ranking>,
    /// The vector hits' best chunks, by path.
    pub(super) spots: HashMap<String, Vec<Spot>>,
    /// No lexical half: the full-text store isn't open yet.
    pub(super) starting: bool,
}

/// Which half a page's passages come from.
enum Half {
    FullText,
    Chunks,
}

/// One Natural query's blocking work, stopping between pages once the query is stopped.
pub(super) struct NaturalJob {
    fulltext: Arc<FullTextBackend>,
    space: Arc<SemanticSpace>,
    view: Arc<dyn SpaceView>,
    text: String,
    vector: Vec<f32>,
    filter: PageFilter,
    limit: usize,
    pub(super) thresholds: Thresholds,
}

impl NaturalJob {
    /// Blocking. The candidates of the vector half (the hits at least
    /// `min`) and, when `lexical`, of the full-text half. `Unavailable`
    /// when the semantic index isn't open, or the full-text store isn't for
    /// a restricted filter.
    pub(super) fn gather(&self, min: f32, lexical: bool) -> Result<Gathered, SearchError> {
        let admitted = self.fulltext.admitted(&self.filter)?;
        let admit = |path: &str| admitted.as_ref().is_none_or(|set| set.contains(path));
        let mut starting = false;
        let ranking = if !lexical {
            None
        } else {
            match self.fulltext.rank(&self.text, &self.filter, CANDIDATES) {
                Ok(ranking) => Some(ranking),
                Err(SearchError::Unavailable(_)) => {
                    starting = true;
                    None
                }
                Err(e) => return Err(e),
            }
        };
        let (vector, spots) = {
            let Some(index) = self.space.index() else {
                return Err(SearchError::Unavailable(RELATED_BUILDING.into()));
            };
            let vector = index.nearest(&self.vector, &admit, min, CANDIDATES);
            let spots: HashMap<String, Vec<Spot>> = vector
                .iter()
                .map(|hit| (hit.path.clone(), spots(&index, hit)))
                .collect();
            (vector, spots)
        };
        let candidates = NaturalCandidates {
            lexical: ranking
                .iter()
                .flat_map(|r| r.paths())
                .map(str::to_string)
                .collect(),
            similar: ranking.as_ref().is_some_and(|r| r.is_similar()),
            vector,
        };
        Ok(Gathered {
            candidates,
            ranking,
            spots,
            starting,
        })
    }

    /// Gathers at the model's `search_min` (a page scores its best chunk,
    /// so this is the minimum [`rank_natural`] applies, also to the chunks
    /// shown), ranks with [`rank_natural`] and reads passages page by page.
    fn run(self, work: &JobCx<NaturalAcc>) -> Result<(), SearchError> {
        let gathered = self.gather(self.thresholds.search_min, true)?;
        let ranked = rank_natural(&gathered.candidates, &self.thresholds);
        {
            let mut acc = work.acc();
            acc.found.total = ranked.len();
            acc.starting = gathered.starting;
        }
        self.passages(gathered, &ranked, work, |acc, _, found| {
            if found.is_empty() {
                // Gone, hidden or changed since it was indexed.
                acc.found.total = acc.found.total.saturating_sub(1);
            } else {
                acc.found.items.extend(found);
            }
        });
        Ok(())
    }

    /// Reads the passages of `ranked`'s first pages (up to the limit), one
    /// page at a time until the query is stopped, and hands each page's to
    /// `on_page` (none when it is gone, hidden or changed since it was
    /// indexed).
    pub(super) fn passages<A>(
        &self,
        gathered: Gathered,
        ranked: &[Ranked],
        work: &JobCx<A>,
        mut on_page: impl FnMut(&mut A, &Ranked, Vec<Match>),
    ) {
        let Gathered {
            candidates,
            ranking,
            mut spots,
            ..
        } = gathered;
        // Only the hits that count may lend a page their chunks: a lexical
        // page outside the gap whose full text changed is left out.
        let counted: HashSet<String> = near(&candidates, &self.thresholds)
            .into_iter()
            .map(|hit| hit.path)
            .collect();
        spots.retain(|path, _| counted.contains(path));
        for r in ranked.iter().take(self.limit) {
            if work.stopped() {
                break;
            }
            // Full-text passages for pages the lexical half placed; best
            // chunks for pages found by meaning, also when they are
            // in a similar ranking that weighs nothing. When the first half
            // has none (its page changed since it was ranked or indexed),
            // the other half's.
            let order = if r.lexical_first {
                [Half::FullText, Half::Chunks]
            } else {
                [Half::Chunks, Half::FullText]
            };
            let found = order
                .into_iter()
                .map(|half| match half {
                    Half::FullText => ranking
                        .as_ref()
                        .filter(|ranking| ranking.contains(&r.path))
                        .map_or_else(Vec::new, |ranking| self.fulltext.passages(ranking, &r.path)),
                    Half::Chunks => spots.remove(&r.path).map_or_else(Vec::new, |spots| {
                        chunk_passages(self.view.as_ref(), &r.path, &spots)
                    }),
                })
                .find(|found| !found.is_empty())
                .unwrap_or_default();
            on_page(&mut work.acc(), r, found);
        }
    }
}

impl SemanticBackend {
    pub fn new(
        fulltext: Arc<FullTextBackend>,
        space: SemanticSpace,
        view: Arc<dyn SpaceView>,
    ) -> SemanticBackend {
        let thresholds = space.inference().spec().thresholds;
        SemanticBackend {
            fulltext,
            space: Arc::new(space),
            view,
            thresholds,
        }
    }

    pub fn thresholds(&self) -> Thresholds {
        self.thresholds
    }

    pub fn space(&self) -> &SemanticSpace {
        &self.space
    }

    fn spec(&self) -> &ModelSpec {
        self.space.inference().spec()
    }

    pub(super) async fn words_instead(
        &self,
        req: QueryRequest,
        cx: RequestCx,
        notice: String,
    ) -> Result<QueryResult, SearchError> {
        let words = QueryRequest {
            mode: Some(QueryMode::Words),
            ..req
        };
        let mut result = self.fulltext.query(words, cx).await?;
        result.partial = true;
        result.notice = Some(notice);
        Ok(result)
    }

    /// Natural mode: the query embedded (bounded semantic queue), then both
    /// halves ranked, fused and given passages in one query slot, within the
    /// deadline. Before the semantic index is ready, or when the model fails,
    /// Words answers with a notice.
    async fn natural(&self, req: QueryRequest, cx: RequestCx) -> Result<QueryResult, SearchError> {
        let text = validate_text(&req.query)?;
        let state = self.space.state();
        if !state.is_ready() {
            // The semantic index isn't ready yet, or failed.
            let notice = job::notice(&state).unwrap_or_else(|| UNAVAILABLE_NOTICE.to_string());
            return self.words_instead(req, cx, notice).await;
        }
        let vector = match self.space.inference().embed_query(&text, &cx).await {
            Ok(vector) => vector,
            Err(SearchError::Unavailable(_)) => {
                return self.words_instead(req, cx, UNAVAILABLE_NOTICE.into()).await
            }
            Err(e) => return Err(e),
        };
        let slot = cx.query_slot().await?;
        let job = self.job(text, vector, req.filter(), req.limit());
        let finished = run_blocking(&cx, slot, "semantic search", move |work| job.run(work)).await;
        let Finished { acc, timed_out } = match finished {
            Ok(finished) => finished,
            // An index isn't open yet: Words answers instead.
            Err(SearchError::Unavailable(_)) => {
                return self.words_instead(req, cx, STARTING.into()).await
            }
            Err(e) => return Err(e),
        };
        let notice = if timed_out {
            Some(SLOW_NOTICE)
        } else {
            acc.starting.then_some(STARTING)
        };
        Ok(QueryResult {
            items: acc.found.items,
            total: acc.found.total,
            partial: notice.is_some(),
            notice: notice.map(str::to_string),
        })
    }

    pub(super) fn job(
        &self,
        text: String,
        vector: Vec<f32>,
        filter: PageFilter,
        limit: usize,
    ) -> NaturalJob {
        NaturalJob {
            fulltext: self.fulltext.clone(),
            space: self.space.clone(),
            view: self.view.clone(),
            text,
            vector,
            filter,
            limit,
            thresholds: self.thresholds,
        }
    }

    async fn run_related(
        &self,
        req: RelatedRequest,
        cx: RequestCx,
    ) -> Result<QueryResult, SearchError> {
        let finished = self
            .related_pages(
                req,
                cx,
                |acc: &mut Acc, hits| acc.total = hits,
                |acc, _, _, found| acc.items.extend(found),
            )
            .await?;
        // At the deadline, nothing of what was found so far.
        if finished.timed_out {
            return Ok(QueryResult {
                partial: true,
                notice: Some(SLOW_NOTICE.to_string()),
                ..QueryResult::default()
            });
        }
        Ok(QueryResult {
            items: finished.acc.items,
            total: finished.acc.total,
            partial: false,
            notice: None,
        })
    }

    /// Related's work in one query slot, within the deadline: the pages
    /// related to `req.page` (their count handed to `on_hits`), then each
    /// one's best chunks as passages, handed to `on_page` with its path and
    /// page cosine, until the query is stopped.
    pub(super) async fn related_pages<A: Default + Send + 'static>(
        &self,
        req: RelatedRequest,
        cx: RequestCx,
        on_hits: fn(&mut A, usize),
        on_page: fn(&mut A, &str, f32, Vec<Match>),
    ) -> Result<Finished<A>, SearchError> {
        if !self.space.state().is_ready() {
            return Err(SearchError::Unavailable(RELATED_BUILDING.into()));
        }
        let slot = cx.query_slot().await?;
        let (space, view) = (self.space.clone(), self.view.clone());
        let (min, damping) = (self.thresholds.related_min, self.thresholds.related_damping);
        let limit = req.limit.unwrap_or(RELATED_LIMIT).min(limits::MAX_RESULTS);
        let path = format!("{}.md", req.page);
        let excluded: HashSet<String> =
            req.exclude.into_iter().map(|p| format!("{p}.md")).collect();
        let filter = PageFilter {
            scope: req.scope.unwrap_or_default(),
            ..PageFilter::default()
        };
        let fulltext = self.fulltext.clone();
        run_blocking(&cx, slot, "related pages", move |work: &JobCx<A>| {
            // Unavailable while the full-text index can't answer.
            let admitted = fulltext.admitted(&filter)?;
            // A page outside the scope (a Meta page for "pages") relates to
            // nothing in it.
            if admitted.as_ref().is_some_and(|set| !set.contains(&path)) {
                return Ok(());
            }
            let hits: Vec<(String, Vec<Spot>, f32)> = {
                let index = space
                    .index()
                    .ok_or_else(|| SearchError::Unavailable(RELATED_BUILDING.into()))?;
                index
                    .related(
                        &path,
                        &|other| {
                            !excluded.contains(other)
                                && admitted.as_ref().is_none_or(|set| set.contains(other))
                        },
                        min,
                        damping,
                        limit,
                    )
                    .ok_or_else(|| SearchError::Unavailable(NOT_INDEXED.into()))?
                    .iter()
                    .map(|hit| (hit.path.clone(), spots(&index, hit), hit.score))
                    .collect()
            };
            on_hits(&mut work.acc(), hits.len());
            for (path, spots, score) in &hits {
                if work.stopped() {
                    break;
                }
                let found = chunk_passages(view.as_ref(), path, spots);
                on_page(&mut work.acc(), path, *score, found);
            }
            Ok(())
        })
        .await
    }
}

impl SearchBackend for SemanticBackend {
    /// Words and Phrase always (the full-text index serves them); Natural
    /// once the semantic index is ready. Related is never public.
    fn public_modes(&self) -> &[QueryMode] {
        if self.space.state().is_ready() {
            &MODES
        } else {
            &BUILDING_MODES
        }
    }

    fn default_mode(&self) -> QueryMode {
        MODES[0]
    }

    fn pages(&self) -> Option<u64> {
        self.fulltext.pages()
    }

    fn indexes(&self) -> Vec<IndexReport> {
        vec![self.fulltext.report(), self.space.report()]
    }

    /// The full-text index keeps answering from its old documents; the
    /// semantic index starts from no vectors, so Natural answers from Words
    /// and Related is unavailable until it is built again.
    fn rebuild(&self) -> Result<(), SearchError> {
        self.fulltext.rebuild()?;
        self.space.rebuild()
    }

    fn status(&self) -> StatusResponse {
        let full = self.fulltext.status();
        let semantic = self.space.state();
        let semantic_ready = semantic.is_ready();
        // The semantic build's, or its catch-up's while it answers from the
        // vectors; else the full-text index's.
        let progress = semantic.progress().or(full.progress);
        // Logged the first time a status sees the space above the limit,
        // whatever reason it shows.
        let oversize = size::oversize_warning_logged(self.space.id(), self.fulltext.pages());
        let reason = match semantic {
            IndexState::Failed { reason } => Some(reason),
            _ => full.reason,
        }
        .or(oversize);
        StatusResponse {
            backend: Some(ID.to_string()),
            model: Some(self.spec().id.to_string()),
            capabilities: Capabilities {
                modes: MODES.to_vec(),
                related: semantic_ready,
            },
            ready: semantic_ready && full.ready,
            progress,
            reason,
        }
    }

    fn query<'a>(
        &'a self,
        req: QueryRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        Box::pin(async move {
            match req.mode.unwrap_or(MODES[0]) {
                QueryMode::Natural => self.natural(req, cx).await,
                QueryMode::Words | QueryMode::Phrase => self.fulltext.query(req, cx).await,
            }
        })
    }

    fn related<'a>(
        &'a self,
        req: RelatedRequest,
        cx: RequestCx,
    ) -> BoxFut<'a, Result<QueryResult, SearchError>> {
        Box::pin(self.run_related(req, cx))
    }
}

#[cfg(test)]
mod tests;
