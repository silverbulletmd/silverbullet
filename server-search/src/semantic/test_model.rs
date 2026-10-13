//! Deterministic tiny BERT used by tests (and by other crates via the `test-model` feature).

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use candle_core::{DType, Device, Tensor};
use candle_nn::{VarBuilder, VarMap};
use sha2::{Digest, Sha256};
use tokenizers::models::wordlevel::WordLevel;
use tokenizers::normalizers::utils::Lowercase;
use tokenizers::pre_tokenizers::whitespace::Whitespace;
use tokenizers::processors::template::TemplateProcessing;
use tokenizers::Tokenizer;

use super::catalog::{Architecture, ModelFile, ModelSpec, Pooling, Thresholds};
use super::models::{bert, xlm_roberta};

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

/// Spec of the tiny model; sizes and hashes are placeholders until `write_tiny_model` fills them.
pub fn tiny_spec() -> ModelSpec {
    tiny_spec_with(Architecture::Bert, Pooling::Mean, "query: ", "passage: ")
}

/// Tiny spec with a chosen architecture, pooling and prefixes. XLM-R uses the real special-token
/// layout (`<s>`=0, `<pad>`=1, `</s>`=2, `<unk>`=3) and pad id 1; BERT uses `[PAD]`=0.
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
        },
        display_name: "Tiny test model",
        repo: "test/tiny",
        revision: "0",
        files: ["model.safetensors", "tokenizer.json", "config.json"]
            .into_iter()
            .map(|name| ModelFile {
                name,
                size: 0,
                sha256: "",
            })
            .collect(),
        architecture,
        dim: 8,
        pooling,
        normalize: true,
        query_prefix,
        passage_prefix,
        max_tokens: 32,
        pad_token_id: match architecture {
            Architecture::Bert => 0,
            Architecture::XlmRoberta => 1,
        },
        languages: "test",
        license: "MIT",
        notice: "Random test weights.",
        resident_bytes: 1 << 20,
        thresholds: Thresholds {
            search_min: 0.0,
            related_min: 0.0,
            max_gap: 1.0,
            calibrated: false,
        },
        default: false,
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
        Architecture::XlmRoberta => (["<s>", "<pad>", "</s>", "<unk>"], "<s>", "</s>", "<unk>"),
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
///
/// The returned spec's sha256 strings are `Box::leak`ed because `ModelFile.sha256` is
/// `&'static str`; this also runs in other crates' tests that enable the `test-model` feature,
/// and leaks a few dozen bytes per call.
pub fn write_tiny_model_with(dir: &Path, seed: u64, template: ModelSpec) -> ModelSpec {
    let architecture = template.architecture;
    let config = match architecture {
        Architecture::Bert => CONFIG,
        Architecture::XlmRoberta => XLMR_CONFIG,
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
    }
    let mut rng = Rng(seed);
    let mut tensors: BTreeMap<String, Tensor> = BTreeMap::new();
    {
        let data = map.data().lock().expect("varmap lock");
        let mut names: Vec<&String> = data.keys().collect();
        names.sort();
        for name in names {
            let shape = data[name].shape().clone();
            let norm_weight = (name.contains("LayerNorm") || name.contains("layer_norm"))
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
        file.sha256 = Box::leak(sha256_hex(&bytes).into_boxed_str());
    }
    spec
}
