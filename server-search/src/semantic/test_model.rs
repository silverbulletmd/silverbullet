//! Deterministic tiny BERT used by tests (and by other crates via the `test-model` feature).

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use candle_core::{DType, Device, Tensor};
use candle_nn::{VarBuilder, VarMap};
use sha2::{Digest, Sha256};
use tokenizers::models::wordlevel::WordLevel;
use tokenizers::normalizers::utils::Lowercase;
use tokenizers::pre_tokenizers::whitespace::Whitespace;
use tokenizers::processors::template::TemplateProcessing;
use tokenizers::Tokenizer;

use super::catalog::{Architecture, ModelSpec, Pooling};
use super::embed::{EmbedError, EmbedKind, Embedder};
use super::models::{bert, modernbert, xlm_roberta};

const WORDS: &[&str] = &[
    "query", "passage", ":", "garden", "basil", "soil", "water", "plant", "grow", "sun", "light",
    "tea", "coffee", "bicycle", "tire", "repair", "flat", "how", "do", "i", "the", "a", "of",
    "and", "to", "in", "is", "it", "for", "wheel",
];

const CONFIG: &str = r#"{
  "model_type": "bert",
  "vocab_size": 34,
  "hidden_size": 8,
  "num_hidden_layers": 2,
  "num_attention_heads": 2,
  "intermediate_size": 16,
  "hidden_act": "gelu",
  "hidden_dropout_prob": 0.0,
  "max_position_embeddings": 64,
  "type_vocab_size": 2,
  "initializer_range": 0.02,
  "layer_norm_eps": 1e-12,
  "pad_token_id": 0
}
"#;

const XLMR_CONFIG: &str = r#"{
  "vocab_size": 34,
  "hidden_size": 8,
  "num_hidden_layers": 2,
  "num_attention_heads": 2,
  "intermediate_size": 16,
  "hidden_act": "gelu",
  "hidden_dropout_prob": 0.0,
  "attention_probs_dropout_prob": 0.0,
  "max_position_embeddings": 66,
  "type_vocab_size": 1,
  "layer_norm_eps": 1e-5,
  "pad_token_id": 1,
  "position_embedding_type": "absolute"
}
"#;

// Two layers: layer 0 attends globally, layer 1 through a 4-token window.
const MODERNBERT_CONFIG: &str = r#"{
  "vocab_size": 34,
  "hidden_size": 8,
  "num_hidden_layers": 2,
  "num_attention_heads": 2,
  "intermediate_size": 16,
  "hidden_activation": "silu",
  "max_position_embeddings": 64,
  "layer_norm_eps": 1e-5,
  "pad_token_id": 1,
  "global_attn_every_n_layers": 2,
  "global_rope_theta": 160000.0,
  "local_attention": 4,
  "local_rope_theta": 10000.0
}
"#;

/// Spec of the tiny model; sizes and hashes are placeholders until `write_tiny_model` fills them.
pub fn tiny_spec() -> ModelSpec {
    tiny_spec_with(Architecture::Bert, Pooling::Mean, "query: ", "passage: ")
}

/// Tiny spec with a chosen architecture, pooling and prefixes. XLM-R uses the real special-token
/// layout (`<s>`=0, `<pad>`=1, `</s>`=2, `<unk>`=3) and pad id 1, and so does ModernBERT; BERT
/// uses `[PAD]`=0.
pub fn tiny_spec_with(
    architecture: Architecture,
    pooling: Pooling,
    query_prefix: &'static str,
    passage_prefix: &'static str,
) -> ModelSpec {
    ModelSpec {
        id: match architecture {
            Architecture::Bert => "test-tiny",
            Architecture::XlmRoberta => "test-tiny-xlmr",
            Architecture::ModernBert => "test-tiny-modernbert",
        },
        architecture,
        pooling,
        query_prefix,
        passage_prefix,
        pad_token_id: match architecture {
            Architecture::Bert => 0,
            Architecture::XlmRoberta | Architecture::ModernBert => 1,
        },
        ..super::catalog::test_tiny()
    }
}

/// Small deterministic PRNG (splitmix64) so the weights depend only on the seed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [-1, 1).
    fn unit(&mut self) -> f32 {
        ((self.next() >> 40) as f32 / (1u64 << 23) as f32) - 1.0
    }
}

fn tokenizer(architecture: Architecture) -> Tokenizer {
    let (specials, start, end, unk) = match architecture {
        Architecture::Bert => (
            ["[PAD]", "[UNK]", "[CLS]", "[SEP]"],
            "[CLS]",
            "[SEP]",
            "[UNK]",
        ),
        Architecture::XlmRoberta | Architecture::ModernBert => {
            (["<s>", "<pad>", "</s>", "<unk>"], "<s>", "</s>", "<unk>")
        }
    };
    let id_of = |name: &str| specials.iter().position(|s| *s == name).unwrap() as u32;
    let mut vocab: HashMap<String, u32> = HashMap::new();
    for (id, token) in specials.into_iter().enumerate() {
        vocab.insert(token.to_string(), id as u32);
    }
    for (i, word) in WORDS.iter().enumerate() {
        vocab.insert((*word).to_string(), 4 + i as u32);
    }
    let model = WordLevel::builder()
        .vocab(vocab.into_iter().collect())
        .unk_token(unk.to_string())
        .build()
        .expect("word level model");
    let mut tokenizer = Tokenizer::new(model);
    tokenizer
        .with_normalizer(Some(Lowercase))
        .expect("normalizer");
    tokenizer.with_pre_tokenizer(Some(Whitespace {}));
    tokenizer.with_post_processor(Some(
        TemplateProcessing::builder()
            .try_single(format!("{start} $A {end}"))
            .expect("template")
            .special_tokens(vec![(start, id_of(start)), (end, id_of(end))])
            .build()
            .expect("template processing"),
    ));
    tokenizer
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Writes `model.safetensors`, `tokenizer.json` and `config.json` deterministically for `seed`
/// and returns the spec with exact sizes and sha256 values.
pub fn write_tiny_model(dir: &Path, seed: u64) -> ModelSpec {
    write_tiny_model_with(dir, seed, tiny_spec())
}

/// Like `write_tiny_model` for any spec built by `tiny_spec_with`. Weights depend only on the seed
/// and the architecture, so the same seed gives the same weights for Mean and Cls pooling.
pub fn write_tiny_model_with(dir: &Path, seed: u64, template: ModelSpec) -> ModelSpec {
    let architecture = template.architecture;
    let config = match architecture {
        Architecture::Bert => CONFIG,
        Architecture::XlmRoberta => XLMR_CONFIG,
        Architecture::ModernBert => MODERNBERT_CONFIG,
    };
    std::fs::create_dir_all(dir).expect("create model dir");
    std::fs::write(dir.join("config.json"), config).expect("write config");
    tokenizer(architecture)
        .save(dir.join("tokenizer.json"), false)
        .expect("write tokenizer");

    let map = VarMap::new();
    let vb = VarBuilder::from_varmap(&map, DType::F32, &Device::Cpu);
    match architecture {
        Architecture::Bert => {
            let cfg: bert::Config = serde_json::from_str(config).expect("tiny config");
            bert::BertModel::load(vb, &cfg).expect("tiny bert");
        }
        Architecture::XlmRoberta => {
            let cfg: xlm_roberta::Config = serde_json::from_str(config).expect("tiny config");
            xlm_roberta::XLMRobertaModel::new(&cfg, vb).expect("tiny xlm-roberta");
        }
        Architecture::ModernBert => {
            let cfg: modernbert::Config = serde_json::from_str(config).expect("tiny config");
            modernbert::ModernBert::load(vb, &cfg).expect("tiny modernbert");
        }
    }
    let mut rng = Rng(seed);
    let mut tensors: BTreeMap<String, Tensor> = BTreeMap::new();
    {
        let data = map.data().lock().expect("varmap lock");
        let mut names: Vec<&String> = data.keys().collect();
        names.sort();
        for name in names {
            let shape = data[name].shape().clone();
            // ModernBERT's norms are `embeddings.norm`, `mlp_norm`, `final_norm`.
            let norm_weight = (name.contains("LayerNorm")
                || name.contains("layer_norm")
                || name.ends_with("norm.weight"))
                && name.ends_with(".weight");
            let values: Vec<f32> = (0..shape.elem_count())
                .map(|_| {
                    let v = rng.unit();
                    if norm_weight {
                        1.0 + 0.1 * v
                    } else {
                        0.4 * v
                    }
                })
                .collect();
            let tensor = Tensor::from_vec(values, shape, &Device::Cpu).expect("tensor");
            tensors.insert(name.clone(), tensor);
        }
    }
    let tensors: HashMap<String, Tensor> = tensors.into_iter().collect();
    candle_core::safetensors::save(&tensors, dir.join("model.safetensors")).expect("write weights");

    let mut spec = template;
    for file in &mut spec.files {
        let bytes = std::fs::read(dir.join(file.name)).expect("read back");
        file.size = bytes.len() as u64;
        file.sha256 = sha256_hex(&bytes);
    }
    spec
}

/// A spec for [`FakeEmbedder`]: 64 dimensions, thresholds that let every
/// match through.
pub fn fake_spec() -> ModelSpec {
    ModelSpec {
        id: "test-fake",
        display_name: "Fake test model",
        dim: 64,
        ..tiny_spec()
    }
}

/// A deterministic embedder for tests: a bag of words hashed into
/// `spec.dim` dimensions and normalised, so texts sharing words are close.
/// `fit` allows `budget` whitespace-separated pieces per window. Counts
/// calls and embedded texts, can sleep per call, can be held (each call
/// then waits, after it is counted, until `hold` is cleared), and can be
/// made to fail.
pub struct FakeEmbedder {
    pub spec: ModelSpec,
    pub budget: usize,
    pub delay: Duration,
    pub calls: AtomicUsize,
    pub texts: AtomicUsize,
    pub fail: AtomicBool,
    pub hold: AtomicBool,
}

impl Default for FakeEmbedder {
    fn default() -> Self {
        FakeEmbedder::new()
    }
}

impl FakeEmbedder {
    pub fn new() -> FakeEmbedder {
        FakeEmbedder {
            spec: fake_spec(),
            budget: 24,
            delay: Duration::ZERO,
            calls: AtomicUsize::new(0),
            texts: AtomicUsize::new(0),
            fail: AtomicBool::new(false),
            hold: AtomicBool::new(false),
        }
    }

    /// What `embed` returns for `text` (the kind doesn't matter).
    pub fn vector(&self, text: &str) -> Vec<f32> {
        let dim = self.spec.dim;
        let mut v = vec![0f32; dim];
        for word in text
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
        {
            let hash = word
                .to_lowercase()
                .bytes()
                .fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
                    (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
                });
            v[(hash % dim as u64) as usize] += 1.0;
        }
        if v.iter().all(|x| *x == 0.0) {
            v[0] = 1.0;
        }
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter_mut().for_each(|x| *x /= norm);
        v
    }
}

impl Embedder for FakeEmbedder {
    fn spec(&self) -> &ModelSpec {
        &self.spec
    }

    fn fit(&self, text: &str) -> usize {
        text.split_inclusive(char::is_whitespace)
            .take(self.budget)
            .map(str::len)
            .sum::<usize>()
            .min(text.len())
    }

    fn embed(&self, texts: &[&str], _kind: EmbedKind) -> Result<Vec<Vec<f32>>, EmbedError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.texts.fetch_add(texts.len(), Ordering::SeqCst);
        while self.hold.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(1));
        }
        if !self.delay.is_zero() {
            std::thread::sleep(self.delay);
        }
        if self.fail.load(Ordering::SeqCst) {
            return Err(EmbedError::Run("fake failure".into()));
        }
        Ok(texts.iter().map(|t| self.vector(t)).collect())
    }
}

/// Offers `test-tiny` ([`crate::semantic::catalog::offer`]) as the e2e
/// harness does, its files written once per process.
pub fn offer_test_tiny() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let dir = std::env::temp_dir().join(format!("sb-offered-tiny-{}", std::process::id()));
        crate::semantic::catalog::offer(write_tiny_model(&dir, 7));
    });
}
