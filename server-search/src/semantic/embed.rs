//! Candle based text embedder: prefixes, one window per input, batching and pooling.

use std::path::Path;

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use tokenizers::Tokenizer;

use super::catalog::{Architecture, ModelSpec, Pooling};
use super::models::{bert, modernbert, xlm_roberta};

/// Whether a text is a search query or an indexed passage (selects the prefix).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedKind {
    Query,
    Passage,
}

#[derive(Debug, thiserror::Error)]
pub enum EmbedError {
    #[error("{0}")]
    Load(String),
    #[error("{0}")]
    Run(String),
}

pub trait Embedder: Send + Sync {
    fn spec(&self) -> &ModelSpec;
    /// Byte length of the longest prefix of `text` that embeds as one
    /// passage window (passage prefix and special tokens included);
    /// `text.len()` when all of it fits. Always a char boundary.
    fn fit(&self, text: &str) -> usize;
    /// One L2-normalised vector of `spec().dim` per input, each input cut to one window.
    fn embed(&self, texts: &[&str], kind: EmbedKind) -> Result<Vec<Vec<f32>>, EmbedError>;
}

enum Network {
    Bert(bert::BertModel),
    XlmRoberta(xlm_roberta::XLMRobertaModel),
    ModernBert(modernbert::ModernBert),
}

/// Windows embedded per forward pass.
const BATCH_WINDOWS: usize = 16;

pub struct CandleEmbedder {
    network: Network,
    tokenizer: Tokenizer,
    /// Start and end special tokens the tokenizer adds around every text.
    specials: (u32, u32),
    spec: ModelSpec,
    pool: rayon::ThreadPool,
}

fn load_err(what: &str, e: impl std::fmt::Display) -> EmbedError {
    EmbedError::Load(format!("{what}: {e}"))
}

fn run_err(e: impl std::fmt::Display) -> EmbedError {
    EmbedError::Run(e.to_string())
}

impl CandleEmbedder {
    /// Loads `model.safetensors`, `tokenizer.json`, `config.json` from `dir`, running inference on `threads` rayon threads.
    pub fn load(spec: ModelSpec, dir: &Path, threads: usize) -> Result<Self, EmbedError> {
        let config_text = std::fs::read_to_string(dir.join("config.json"))
            .map_err(|e| load_err("config.json", e))?;
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|e| load_err("tokenizer.json", e))?;
        tokenizer
            .with_truncation(None)
            .map_err(|e| load_err("tokenizer.json", e))?;
        tokenizer.with_padding(None);
        let specials = {
            let empty = tokenizer
                .encode("", true)
                .map_err(|e| load_err("tokenizer.json", e))?;
            match empty.get_ids() {
                [first, last] => (*first, *last),
                _ => {
                    return Err(EmbedError::Load(
                        "tokenizer.json must add exactly a start and an end special token".into(),
                    ))
                }
            }
        };
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads.max(1))
            .thread_name(|i| format!("sb-embed-{i}"))
            .build()
            .map_err(|e| load_err("thread pool", e))?;
        let weights = dir.join("model.safetensors");
        let network = pool.install(|| -> Result<Network, EmbedError> {
            // SAFETY: mmap is only sound while the file is not truncated or rewritten in place.
            // The model store installs files by writing a temporary file, fsync, then an atomic
            // rename (download manager, Task 7), and never modifies an installed model file.
            let vb = unsafe {
                VarBuilder::from_mmaped_safetensors(&[weights], DType::F32, &Device::Cpu)
            }
            .map_err(|e| load_err("model.safetensors", e))?;
            match spec.architecture {
                Architecture::Bert => {
                    let cfg: bert::Config = serde_json::from_str(&config_text)
                        .map_err(|e| load_err("config.json", e))?;
                    check_hidden(&spec, cfg.hidden_size)?;
                    bert::BertModel::load(vb, &cfg)
                        .map(Network::Bert)
                        .map_err(|e| load_err("model", e))
                }
                Architecture::XlmRoberta => {
                    let cfg: xlm_roberta::Config = serde_json::from_str(&config_text)
                        .map_err(|e| load_err("config.json", e))?;
                    check_hidden(&spec, cfg.hidden_size)?;
                    xlm_roberta::XLMRobertaModel::new(&cfg, vb)
                        .map(Network::XlmRoberta)
                        .map_err(|e| load_err("model", e))
                }
                Architecture::ModernBert => {
                    let cfg: modernbert::Config = serde_json::from_str(&config_text)
                        .map_err(|e| load_err("config.json", e))?;
                    check_hidden(&spec, cfg.hidden_size)?;
                    modernbert::ModernBert::load(vb, &cfg)
                        .map(Network::ModernBert)
                        .map_err(|e| load_err("model", e))
                }
            }
        })?;
        Ok(Self {
            network,
            tokenizer,
            specials,
            spec,
            pool,
        })
    }

    /// Token ids of one (already prefixed) text, cut to one window of
    /// `max_tokens`: the start token, as much of the body as fits, the end token.
    pub(crate) fn window(&self, text: &str) -> Result<Vec<u32>, EmbedError> {
        let encoding = self.tokenizer.encode(text, true).map_err(run_err)?;
        let ids = encoding.get_ids();
        let (first, last) = self.specials;
        if ids.len() < 2 || ids[0] != first || ids[ids.len() - 1] != last {
            return Err(EmbedError::Run(
                "tokenizer output lacks the start and end special tokens".into(),
            ));
        }
        let body = &ids[1..ids.len() - 1];
        let keep = body.len().min(self.spec.max_tokens.saturating_sub(2));
        let mut window = Vec::with_capacity(keep + 2);
        window.push(first);
        window.extend_from_slice(&body[..keep]);
        window.push(last);
        Ok(window)
    }

    /// [`CandleEmbedder::window`] of `text` with the spec's prefix for `kind`.
    pub(crate) fn prefixed_window(
        &self,
        text: &str,
        kind: EmbedKind,
    ) -> Result<Vec<u32>, EmbedError> {
        let prefix = match kind {
            EmbedKind::Query => self.spec.query_prefix,
            EmbedKind::Passage => self.spec.passage_prefix,
        };
        self.window(&format!("{prefix}{text}"))
    }

    /// Raw pooled (not normalised) vector per window; runs on the caller's thread.
    pub(crate) fn pool_windows(&self, windows: &[&[u32]]) -> Result<Vec<Vec<f32>>, EmbedError> {
        let mut out = Vec::with_capacity(windows.len());
        for batch in windows.chunks(BATCH_WINDOWS) {
            out.extend(self.forward_batch(batch).map_err(run_err)?);
        }
        Ok(out)
    }

    /// Hidden states `[batch, width, hidden]` and the padding mask `[batch, width]`.
    pub(crate) fn hidden_batch(&self, batch: &[&[u32]]) -> candle_core::Result<(Tensor, Tensor)> {
        let device = Device::Cpu;
        let width = batch.iter().map(|w| w.len()).max().unwrap_or(0);
        let mut ids = Vec::with_capacity(batch.len() * width);
        let mut mask = Vec::with_capacity(batch.len() * width);
        for window in batch {
            ids.extend_from_slice(window);
            mask.extend(std::iter::repeat_n(1u32, window.len()));
            let pad = width - window.len();
            ids.extend(std::iter::repeat_n(self.spec.pad_token_id, pad));
            mask.extend(std::iter::repeat_n(0u32, pad));
        }
        let shape = (batch.len(), width);
        let ids = Tensor::from_vec(ids, shape, &device)?;
        let mask = Tensor::from_vec(mask, shape, &device)?;
        let types = ids.zeros_like()?;
        let hidden = match &self.network {
            Network::Bert(m) => m.forward(&ids, &types, Some(&mask))?,
            Network::XlmRoberta(m) => m.forward(&ids, &mask, &types, None, None, None)?,
            Network::ModernBert(m) => m.forward(&ids, &mask)?,
        };
        Ok((hidden, mask))
    }

    fn forward_batch(&self, batch: &[&[u32]]) -> candle_core::Result<Vec<Vec<f32>>> {
        let (hidden, mask) = self.hidden_batch(batch)?;
        let pooled = match self.spec.pooling {
            Pooling::Cls => hidden.narrow(1, 0, 1)?.squeeze(1)?,
            Pooling::Mean => {
                let m = mask.to_dtype(DType::F32)?.unsqueeze(2)?;
                let sum = hidden.broadcast_mul(&m)?.sum(1)?;
                let count = m.sum(1)?.clamp(1e-9, f32::MAX as f64)?;
                sum.broadcast_div(&count)?
            }
        };
        pooled.to_vec2::<f32>()
    }

    fn embed_inner(&self, texts: &[&str], kind: EmbedKind) -> Result<Vec<Vec<f32>>, EmbedError> {
        let windows = texts
            .iter()
            .map(|text| self.prefixed_window(text, kind))
            .collect::<Result<Vec<_>, _>>()?;
        // Similar lengths batch together, which keeps padding small.
        let mut order: Vec<usize> = (0..windows.len()).collect();
        order.sort_by_key(|&i| windows[i].len());
        let refs: Vec<&[u32]> = order.iter().map(|&i| windows[i].as_slice()).collect();
        let pooled = self.pool_windows(&refs)?;
        let mut out = vec![Vec::new(); texts.len()];
        for (mut vector, &i) in pooled.into_iter().zip(&order) {
            if vector.len() != self.spec.dim {
                return Err(EmbedError::Run(format!(
                    "model produced {} dimensions, expected {}",
                    vector.len(),
                    self.spec.dim
                )));
            }
            l2_normalise(&mut vector)?;
            out[i] = vector;
        }
        Ok(out)
    }
}

fn check_hidden(spec: &ModelSpec, hidden: usize) -> Result<(), EmbedError> {
    if hidden == spec.dim {
        Ok(())
    } else {
        Err(EmbedError::Load(format!(
            "config.json hidden_size {hidden} does not match the model's {} dimensions",
            spec.dim
        )))
    }
}

pub(crate) fn l2_normalise(vector: &mut [f32]) -> Result<(), EmbedError> {
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if !norm.is_finite() || norm <= 0.0 {
        return Err(EmbedError::Run(
            "model produced an invalid embedding".into(),
        ));
    }
    for v in vector {
        *v /= norm;
    }
    Ok(())
}

impl Embedder for CandleEmbedder {
    fn spec(&self) -> &ModelSpec {
        &self.spec
    }

    fn fit(&self, text: &str) -> usize {
        let prefix = self.spec.passage_prefix;
        let prefixed = format!("{prefix}{text}");
        let Ok(encoding) = self.tokenizer.encode(prefixed.as_str(), true) else {
            return text.len();
        };
        let max = self.spec.max_tokens;
        if encoding.get_ids().len() <= max {
            return text.len();
        }
        // Token 0 is the start token, so a window keeps tokens 1..max-1; the
        // token at max-1 is the first that doesn't fit, and the cut is where
        // it starts (a byte offset into `prefixed`).
        let cut = encoding.get_offsets()[max - 1].0;
        super::chunk::floor_char_boundary(text, cut.saturating_sub(prefix.len()))
    }

    fn embed(&self, texts: &[&str], kind: EmbedKind) -> Result<Vec<Vec<f32>>, EmbedError> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        self.pool.install(|| self.embed_inner(texts, kind))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::test_model::{tiny_spec_with, write_tiny_model, write_tiny_model_with};

    fn tiny() -> (tempfile::TempDir, CandleEmbedder) {
        let dir = tempfile::tempdir().unwrap();
        let spec = write_tiny_model(dir.path(), 7);
        let embedder = CandleEmbedder::load(spec, dir.path(), 2).unwrap();
        (dir, embedder)
    }

    fn norm(v: &[f32]) -> f32 {
        v.iter().map(|x| x * x).sum::<f32>().sqrt()
    }

    fn max_diff(a: &[f32], b: &[f32]) -> f32 {
        a.iter()
            .zip(b)
            .map(|(x, y)| (x - y).abs())
            .fold(0.0, f32::max)
    }

    #[test]
    fn vectors_have_spec_dimension_and_unit_norm() {
        let (_dir, e) = tiny();
        let out = e
            .embed(&["garden basil", "coffee tea", ""], EmbedKind::Passage)
            .unwrap();
        assert_eq!(out.len(), 3);
        for v in &out {
            assert_eq!(v.len(), 8);
            assert!((norm(v) - 1.0).abs() < 1e-5);
        }
    }

    #[test]
    fn query_and_passage_prefixes_differ() {
        let (_dir, e) = tiny();
        let q = e.embed(&["garden basil"], EmbedKind::Query).unwrap();
        let p = e.embed(&["garden basil"], EmbedKind::Passage).unwrap();
        assert!(max_diff(&q[0], &p[0]) > 1e-4);
    }

    #[test]
    fn batching_and_padding_do_not_change_vectors() {
        let (_dir, e) = tiny();
        let long =
            "garden basil soil water plant grow sun light tea coffee bicycle tire repair flat";
        let twice = e
            .embed(&["garden basil", "garden basil"], EmbedKind::Passage)
            .unwrap();
        assert!(max_diff(&twice[0], &twice[1]) < 1e-5);
        let alone = e.embed(&["garden basil"], EmbedKind::Passage).unwrap();
        let mixed = e
            .embed(&[long, "garden basil"], EmbedKind::Passage)
            .unwrap();
        assert!(max_diff(&alone[0], &mixed[1]) < 1e-5);
    }

    fn tiny_with(
        arch: Architecture,
        pooling: Pooling,
        query: &'static str,
        passage: &'static str,
    ) -> (tempfile::TempDir, CandleEmbedder) {
        let dir = tempfile::tempdir().unwrap();
        let spec =
            write_tiny_model_with(dir.path(), 7, tiny_spec_with(arch, pooling, query, passage));
        let embedder = CandleEmbedder::load(spec, dir.path(), 2).unwrap();
        (dir, embedder)
    }

    #[test]
    fn a_long_text_is_cut_to_one_window_that_keeps_its_prefix() {
        let (_dir, e) = tiny();
        let text = ["garden basil soil water plant"; 20].join(" ");
        let id = |t: &str| e.tokenizer.token_to_id(t).unwrap();
        let w = e.prefixed_window(&text, EmbedKind::Passage).unwrap();
        assert_eq!(w.len(), 32, "exactly max_tokens");
        assert_eq!(&w[..4], &[2, id("passage"), id(":"), id("garden")]);
        assert_eq!(w[31], 3, "the end token is kept");
        let got = e.embed(&[&text], EmbedKind::Passage).unwrap();
        let mut expected = e.pool_windows(&[&w[..]]).unwrap().remove(0);
        l2_normalise(&mut expected).unwrap();
        assert!(max_diff(&got[0], &expected) < 1e-5);
    }

    #[test]
    fn fit_is_the_longest_prefix_that_embeds_as_one_window() {
        let (_dir, e) = tiny();
        let short = "garden basil soil";
        assert_eq!(e.fit(short), short.len());
        let long = ["garden basil soil water plant"; 20].join(" ");
        let cut = e.fit(&long);
        assert!(cut < long.len() && long.is_char_boundary(cut));
        let tokens = |s: &str| {
            e.tokenizer
                .encode(format!("passage: {s}"), true)
                .unwrap()
                .get_ids()
                .len()
        };
        let head = long[..cut].trim_end();
        assert!(tokens(head) <= 32, "the head fits");
        let next = long[cut..].split_whitespace().next().unwrap();
        assert!(
            tokens(&format!("{head} {next}")) > 32,
            "one more word doesn't"
        );
    }

    #[test]
    fn prefixes_are_applied_per_kind() {
        let (_dir, e) = tiny();
        let id = |t: &str| e.tokenizer.token_to_id(t).unwrap();
        let (cls, query, passage, colon, garden) =
            (2, id("query"), id("passage"), id(":"), id("garden"));
        assert_eq!(
            e.prefixed_window("garden", EmbedKind::Query).unwrap()[..4],
            [cls, query, colon, garden]
        );
        assert_eq!(
            e.prefixed_window("garden", EmbedKind::Passage).unwrap()[..4],
            [cls, passage, colon, garden]
        );
        // Swapping the prefixes by hand swaps the vectors.
        let q = e.embed(&["garden basil"], EmbedKind::Query).unwrap();
        let p_manual = e
            .embed(&["query: garden basil"], EmbedKind::Passage)
            .unwrap();
        // Passage adds "passage: " first, so compare against windows built without any prefix.
        let raw = e.window("query: garden basil").unwrap();
        let mut expected = e.pool_windows(&[&raw[..]]).unwrap().remove(0);
        l2_normalise(&mut expected).unwrap();
        assert!(max_diff(&q[0], &expected) < 1e-5);
        assert!(max_diff(&q[0], &p_manual[0]) > 1e-4);
    }

    #[test]
    fn an_empty_prefix_adds_nothing() {
        let (_dir, e) = tiny_with(Architecture::Bert, Pooling::Mean, "query: ", "");
        let id = |t: &str| e.tokenizer.token_to_id(t).unwrap();
        assert_eq!(
            e.prefixed_window("garden basil", EmbedKind::Passage)
                .unwrap(),
            [2, id("garden"), id("basil"), 3]
        );
        let got = e.embed(&["garden basil"], EmbedKind::Passage).unwrap();
        let w = [2, id("garden"), id("basil"), 3];
        let mut expected = e.pool_windows(&[&w[..]]).unwrap().remove(0);
        l2_normalise(&mut expected).unwrap();
        assert!(max_diff(&got[0], &expected) < 1e-5);
    }

    #[test]
    fn cls_pooling_is_the_normalised_first_token_state() {
        let (_dir, cls) = tiny_with(Architecture::Bert, Pooling::Cls, "query: ", "passage: ");
        let (_dir2, mean) = tiny();
        let text = "garden basil soil";
        let w = cls.prefixed_window(text, EmbedKind::Passage).unwrap();
        let (hidden, _) = cls.hidden_batch(&[&w[..]]).unwrap();
        let mut first = hidden
            .get(0)
            .unwrap()
            .get(0)
            .unwrap()
            .to_vec1::<f32>()
            .unwrap();
        l2_normalise(&mut first).unwrap();
        let got = cls.embed(&[text], EmbedKind::Passage).unwrap();
        assert!(max_diff(&got[0], &first) < 1e-5);
        // Same weights, different pooling: the vectors differ.
        let m = mean.embed(&[text], EmbedKind::Passage).unwrap();
        assert!(max_diff(&got[0], &m[0]) > 1e-3);
        // Padding in a batch does not move the CLS vector.
        let long = "garden basil soil water plant grow sun light tea coffee bicycle tire";
        let mixed = cls.embed(&[long, text], EmbedKind::Passage).unwrap();
        assert!(max_diff(&got[0], &mixed[1]) < 1e-5);
    }

    #[test]
    fn mean_pooling_is_the_masked_average_of_token_states() {
        let (_dir, e) = tiny();
        let text = "garden basil soil";
        let w = e.prefixed_window(text, EmbedKind::Passage).unwrap();
        let (hidden, _) = e.hidden_batch(&[&w[..]]).unwrap();
        let rows = hidden.get(0).unwrap().to_vec2::<f32>().unwrap();
        let mut avg = vec![0f32; 8];
        for row in &rows {
            for (a, v) in avg.iter_mut().zip(row) {
                *a += v / rows.len() as f32;
            }
        }
        l2_normalise(&mut avg).unwrap();
        let got = e.embed(&[text], EmbedKind::Passage).unwrap();
        assert!(max_diff(&got[0], &avg) < 1e-5);
    }

    #[test]
    fn xlm_roberta_path_embeds_and_masks_padding() {
        let (_dir, e) = tiny_with(
            Architecture::XlmRoberta,
            Pooling::Mean,
            "query: ",
            "passage: ",
        );
        assert_eq!(e.specials, (0, 2));
        let long = "garden basil soil water plant grow sun light tea coffee bicycle tire";
        let alone = e.embed(&["garden basil"], EmbedKind::Passage).unwrap();
        let mixed = e
            .embed(&[long, "garden basil"], EmbedKind::Passage)
            .unwrap();
        assert_eq!(alone[0].len(), 8);
        assert!((norm(&alone[0]) - 1.0).abs() < 1e-5);
        assert!(max_diff(&alone[0], &mixed[1]) < 1e-5);
        let q = e.embed(&["garden basil"], EmbedKind::Query).unwrap();
        assert!(max_diff(&q[0], &alone[0]) > 1e-4);
        // Mean over the unpadded tokens matches the manual average.
        let w = e
            .prefixed_window("garden basil", EmbedKind::Passage)
            .unwrap();
        let (hidden, _) = e.hidden_batch(&[&w[..]]).unwrap();
        let rows = hidden.get(0).unwrap().to_vec2::<f32>().unwrap();
        let mut avg = vec![0f32; 8];
        for row in &rows {
            for (a, v) in avg.iter_mut().zip(row) {
                *a += v / rows.len() as f32;
            }
        }
        l2_normalise(&mut avg).unwrap();
        assert!(max_diff(&alone[0], &avg) < 1e-5);
    }

    #[test]
    fn modernbert_path_embeds_with_cls_pooling_and_masks_padding() {
        let (_dir, e) = tiny_with(Architecture::ModernBert, Pooling::Cls, "", "");
        assert_eq!(e.specials, (0, 2));
        // Longer than the tiny model's 4-token local window.
        let long = "garden basil soil water plant grow sun light tea coffee bicycle tire";
        let alone = e.embed(&["garden basil"], EmbedKind::Passage).unwrap();
        let mixed = e
            .embed(&[long, "garden basil"], EmbedKind::Passage)
            .unwrap();
        let long_alone = e.embed(&[long], EmbedKind::Passage).unwrap();
        assert_eq!(alone[0].len(), 8);
        assert!((norm(&alone[0]) - 1.0).abs() < 1e-5);
        assert!(max_diff(&alone[0], &mixed[1]) < 1e-5);
        assert!(max_diff(&long_alone[0], &mixed[0]) < 1e-5);
        // No prefixes: a query embeds like a passage.
        let q = e.embed(&["garden basil"], EmbedKind::Query).unwrap();
        assert!(max_diff(&q[0], &alone[0]) < 1e-6);
        // CLS: the normalised first token state.
        let w = e
            .prefixed_window("garden basil", EmbedKind::Passage)
            .unwrap();
        let (hidden, _) = e.hidden_batch(&[&w[..]]).unwrap();
        let mut first = hidden.get(0).unwrap().to_vec2::<f32>().unwrap()[0].clone();
        l2_normalise(&mut first).unwrap();
        assert!(max_diff(&alone[0], &first) < 1e-5);
    }

    #[test]
    fn tiny_model_is_deterministic() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let sa = write_tiny_model(a.path(), 7);
        let sb = write_tiny_model(b.path(), 7);
        assert_eq!(sa, sb);
        for name in ["model.safetensors", "tokenizer.json", "config.json"] {
            assert_eq!(
                std::fs::read(a.path().join(name)).unwrap(),
                std::fs::read(b.path().join(name)).unwrap(),
                "{name}"
            );
        }
        let c = tempfile::tempdir().unwrap();
        write_tiny_model(c.path(), 8);
        assert_ne!(
            std::fs::read(a.path().join("model.safetensors")).unwrap(),
            std::fs::read(c.path().join("model.safetensors")).unwrap()
        );
    }

    #[test]
    fn corrupt_config_is_a_load_error() {
        let dir = tempfile::tempdir().unwrap();
        let spec = write_tiny_model(dir.path(), 7);
        std::fs::write(dir.path().join("config.json"), "{ not json").unwrap();
        assert!(matches!(
            CandleEmbedder::load(spec, dir.path(), 1),
            Err(EmbedError::Load(_))
        ));
    }

    #[test]
    #[ignore = "needs real models in SB_SEARCH_MODEL_DIR"]
    fn real_models_rank_multilingual_paraphrases() {
        let root = std::env::var("SB_SEARCH_MODEL_DIR").expect("SB_SEARCH_MODEL_DIR");
        for spec in crate::semantic::catalog::catalog() {
            let dir = Path::new(&root).join(spec.dir_name());
            let e = CandleEmbedder::load(spec.clone(), &dir, 2).unwrap();
            let q = &e
                .embed(&["How do I repair a flat bicycle tire?"], EmbedKind::Query)
                .unwrap()[0];
            let ps = e
                .embed(
                    &[
                        "Reparar un pinchazo de bicicleta: quita la rueda, saca la cámara, localiza el agujero y pega un parche.",
                        "Cómo preparar un buen café: muele los granos justo antes y usa agua a noventa y tres grados.",
                    ],
                    EmbedKind::Passage,
                )
                .unwrap();
            let cos = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
            let (bike, coffee) = (cos(q, &ps[0]), cos(q, &ps[1]));
            assert!(bike > coffee, "{}: bike {bike} coffee {coffee}", spec.id);
        }
    }

    /// The cosine matrix of Granite's model card (queries by passages,
    /// to 4 decimals), passages embedded as one padded batch. The card's
    /// German passage reads "ist with rund"; its numbers come from "ist mit
    /// rund".
    #[test]
    #[ignore = "needs granite-embedding-97m-multilingual-r2 in SB_SEARCH_MODEL_DIR"]
    fn granite_reproduces_the_model_cards_cosine_matrix() {
        let root = std::env::var("SB_SEARCH_MODEL_DIR").expect("SB_SEARCH_MODEL_DIR");
        let spec = crate::semantic::catalog::find("granite-embedding-97m-multilingual-r2").unwrap();
        let e =
            CandleEmbedder::load(spec.clone(), &Path::new(&root).join(spec.dir_name()), 2).unwrap();
        let queries = e
            .embed(
                &[
                    "What is the tallest mountain in Japan?",
                    "Wer hat das Lied Achy Breaky Heart geschrieben?",
                    "ドイツの首都はどこですか？",
                ],
                EmbedKind::Query,
            )
            .unwrap();
        let passages = e
            .embed(
                &[
                    "富士山は、静岡県と山梨県にまたがる活火山で、標高3776.12 mで日本最高峰の独立峰である。",
                    "Achy Breaky Heart is a country song written by Don Von Tress. Originally titled Don't Tell My Heart and performed by The Marcy Brothers in 1991.",
                    "Berlin ist die Hauptstadt und ein Land der Bundesrepublik Deutschland. Die Stadt ist mit rund 3,7 Millionen Einwohnern die bevölkerungsreichste Kommune Deutschlands.",
                ],
                EmbedKind::Passage,
            )
            .unwrap();
        let card = [
            [0.8869, 0.6658, 0.7213],
            [0.6792, 0.9577, 0.6420],
            [0.7534, 0.6771, 0.9112],
        ];
        let cos = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
        for (i, q) in queries.iter().enumerate() {
            for (j, p) in passages.iter().enumerate() {
                let got = cos(q, p);
                assert!(
                    (got - card[i][j]).abs() < 1e-4,
                    "query {i} passage {j}: {got} vs {}",
                    card[i][j]
                );
            }
        }
    }
}
