//! Static catalog of the embedding models the server can download and run.
//!
//! Every model property lives here; nothing else in the crate hardcodes one.

use std::sync::{OnceLock, RwLock};

/// How token embeddings are reduced to one vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pooling {
    Cls,
    Mean,
}

/// Which vendored transformer loader runs the weights.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Architecture {
    Bert,
    XlmRoberta,
    ModernBert,
}

/// One pinned file of a model repository.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelFile {
    pub name: &'static str,
    pub size: u64,
    pub sha256: String,
}

/// Cosine-similarity cut-offs for search and related-page results, and how
/// much the full-text similar tier counts in hybrid fusion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thresholds {
    pub search_min: f32,
    pub related_min: f32,
    /// How much a related page's closeness to the whole space counts
    /// against it: it scores `cos(target, page) - related_damping *
    /// cos(page, centroid)` (the centroid is the normalised mean page
    /// vector), so hub pages, close to everything, rank below specific
    /// neighbours. `related_min` applies to that score.
    pub related_damping: f32,
    pub max_gap: f32,
    /// The RRF weight of full-text hits from the similar tier (pages with
    /// some of the words, or close spellings), which answers only when no
    /// page has every word: each adds `similar_weight / (k + rank)`. Exact
    /// tier and vector hits weigh 1; 0 leaves similar pages out of Natural.
    pub similar_weight: f32,
    pub calibrated: bool,
}

/// A downloadable embedding model with pinned files and inference settings.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelSpec {
    pub id: &'static str,
    pub display_name: &'static str,
    pub repo: &'static str,
    pub revision: &'static str,
    pub files: Vec<ModelFile>,
    pub architecture: Architecture,
    pub dim: usize,
    pub pooling: Pooling,
    pub query_prefix: &'static str,
    pub passage_prefix: &'static str,
    pub max_tokens: usize,
    pub pad_token_id: u32,
    pub languages: &'static str,
    /// The model's page (its Hugging Face model card), for the model picker.
    pub homepage: &'static str,
    /// SPDX identifier, as the model card states it.
    pub license: &'static str,
    pub notice: &'static str,
    pub resident_bytes: u64,
    pub thresholds: Thresholds,
}

impl ModelSpec {
    /// Pinned download URL for one of this model's files.
    pub fn url(&self, file: &ModelFile) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repo, self.revision, file.name
        )
    }

    /// Directory name under `<data root>/search/models/`.
    pub fn dir_name(&self) -> String {
        format!("{}@{}", self.id, self.revision)
    }

    /// Total bytes to download for all files.
    pub fn download_bytes(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
}

/// Weights size plus 25 %, rounded up.
const fn resident(weights: u64) -> u64 {
    (weights * 5).div_ceil(4)
}

// The thresholds, calibrated on the eval's labelled corpus with
// `search-eval calibrate` (method and sweep in
// `crates/search-eval/results/README-semantic.md` of the app repository):
// `search_min`, `max_gap` and `similar_weight` keep hybrid nDCG@10 within
// 0.01 of the best while minimising negative queries with results;
// `related_min` and `related_damping` (swept jointly) maximise the F1
// of related P@5 and R@5.

// Granite's `search_min` sits on a steep edge: the rule picks 0.81, but
// 0.815 keeps labelled hybrid at 0.966 while lifting typo queries on the
// 5,000-page space from 0.673 to 0.749 (README-semantic.md, Granite section).
const GRANITE_97M_THRESHOLDS: Thresholds = Thresholds {
    search_min: 0.815,
    related_min: 0.30,
    related_damping: 0.6,
    max_gap: 0.05,
    similar_weight: 0.0,
    calibrated: true,
};

const E5_SMALL_THRESHOLDS: Thresholds = Thresholds {
    search_min: 0.78,
    related_min: 0.20,
    related_damping: 0.7,
    max_gap: 0.04,
    similar_weight: 0.0,
    calibrated: true,
};

/// The recommended model: first in the catalog, the one pickers list first.
pub const DEFAULT_MODEL: &str = "granite-embedding-97m-multilingual-r2";

fn build_catalog() -> Vec<ModelSpec> {
    vec![granite_97m(), e5_small()]
}

fn granite_97m() -> ModelSpec {
    ModelSpec {
        id: "granite-embedding-97m-multilingual-r2",
        display_name: "Granite Embedding 97M Multilingual R2",
        repo: "ibm-granite/granite-embedding-97m-multilingual-r2",
        revision: "835ad14087e140460703cf0fae09f97d469d65c2",
        files: vec![
            ModelFile {
                name: "model.safetensors",
                size: 194_889_568,
                sha256: "f3ea88b230492811046145513710e76b4cc8c2ad49e8708da0e7247e548903be".into(),
            },
            ModelFile {
                name: "tokenizer.json",
                size: 25_301_672,
                sha256: "4f2842d568e2724370aec203652a42ac783c7937f8347a1a2cc7506d71f1582f".into(),
            },
            ModelFile {
                name: "config.json",
                size: 1_216,
                sha256: "de948b0bdc6f356afad7a84b276d8dd7e7fe10fb9add1bb5e610621c28e41ebc".into(),
            },
        ],
        architecture: Architecture::ModernBert,
        dim: 384,
        // 1_Pooling/config.json: CLS token; 2_Normalize.
        pooling: Pooling::Cls,
        // config_sentence_transformers.json: empty query and document prompts.
        query_prefix: "",
        passage_prefix: "",
        // The model takes 32,768 tokens; kept at e5-small's 512 so the
        // chunking and windows are the same.
        max_tokens: 512,
        // <|endoftext|>; the attention mask makes the value irrelevant.
        pad_token_id: 179_935,
        languages: "Multilingual (52 languages with retrieval training, 200+ pretrained)",
        homepage: "https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2",
        license: "Apache-2.0",
        notice: "ibm-granite/granite-embedding-97m-multilingual-r2 by IBM, Apache-2.0 license.",
        // BF16 weights load as F32: twice the file, plus 25 %.
        resident_bytes: resident(2 * 194_889_568),
        thresholds: GRANITE_97M_THRESHOLDS,
    }
}

fn e5_small() -> ModelSpec {
    ModelSpec {
        id: "multilingual-e5-small",
        display_name: "Multilingual E5 Small",
        repo: "intfloat/multilingual-e5-small",
        revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
        files: vec![
            ModelFile {
                name: "model.safetensors",
                size: 470_641_600,
                sha256: "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477".into(),
            },
            ModelFile {
                name: "tokenizer.json",
                size: 17_082_730,
                sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39".into(),
            },
            ModelFile {
                name: "config.json",
                size: 655,
                sha256: "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959".into(),
            },
        ],
        architecture: Architecture::Bert,
        dim: 384,
        pooling: Pooling::Mean,
        query_prefix: "query: ",
        passage_prefix: "passage: ",
        max_tokens: 512,
        // The tokenizer's <pad> is 1; the attention mask makes the value irrelevant.
        pad_token_id: 1,
        languages: "Multilingual (about 100 languages)",
        homepage: "https://huggingface.co/intfloat/multilingual-e5-small",
        license: "MIT",
        notice: "intfloat/multilingual-e5-small by Liang Wang et al. (Microsoft), MIT license.",
        resident_bytes: resident(470_641_600),
        thresholds: E5_SMALL_THRESHOLDS,
    }
}

/// The launch catalog, built once.
pub fn catalog() -> &'static [ModelSpec] {
    static CATALOG: OnceLock<Vec<ModelSpec>> = OnceLock::new();
    CATALOG.get_or_init(build_catalog)
}

/// The generated tiny model of the tests and the e2e journey (files written
/// by `test_model::write_tiny_model`; sizes and hashes filled in by the writer).
#[cfg(any(debug_assertions, test, feature = "test-model"))]
pub fn test_tiny() -> ModelSpec {
    ModelSpec {
        id: "test-tiny",
        display_name: "Tiny test model",
        repo: "test/tiny",
        revision: "0",
        files: ["model.safetensors", "tokenizer.json", "config.json"]
            .into_iter()
            .map(|name| ModelFile {
                name,
                size: 0,
                sha256: String::new(),
            })
            .collect(),
        architecture: Architecture::Bert,
        dim: 8,
        pooling: Pooling::Mean,
        query_prefix: "query: ",
        passage_prefix: "passage: ",
        max_tokens: 32,
        pad_token_id: 0,
        languages: "test",
        homepage: "https://example.com/test-tiny",
        license: "MIT",
        notice: "Random test weights.",
        resident_bytes: 1 << 20,
        thresholds: Thresholds {
            search_min: 0.0,
            related_min: 0.0,
            related_damping: 0.0,
            max_gap: 1.0,
            similar_weight: 1.0,
            calibrated: false,
        },
    }
}

/// Models offered beside the catalog ([`offer`]).
static EXTRA: RwLock<Vec<&'static ModelSpec>> = RwLock::new(Vec::new());

/// Offers `spec` beside the catalog from now on, process-wide: the e2e
/// harness's tiny model (`semantic::e2e::install`, debug builds) and tests'.
/// An id already offered is ignored.
pub fn offer(spec: ModelSpec) {
    let mut extra = EXTRA.write().unwrap_or_else(|e| e.into_inner());
    if catalog()
        .iter()
        .chain(extra.iter().copied())
        .any(|m| m.id == spec.id)
    {
        return;
    }
    extra.push(Box::leak(Box::new(spec)));
}

/// The models the dashboard offers: the catalog, then any [`offer`]ed one.
pub fn offered() -> Vec<&'static ModelSpec> {
    let extra = EXTRA.read().unwrap_or_else(|e| e.into_inner());
    catalog().iter().chain(extra.iter().copied()).collect()
}

/// Offered model `id` ([`offered`]).
pub fn find(id: &str) -> Option<&'static ModelSpec> {
    offered().into_iter().find(|m| m.id == id)
}

/// Model `id` ([`find`]), or why there is none: every mode resolves a
/// configured or chosen model id here, and decides itself whether an
/// unknown one warns or fails.
pub fn resolve(id: &str) -> Result<&'static ModelSpec, UnknownModel> {
    find(id).ok_or_else(|| UnknownModel(id.to_string()))
}

/// A model id the catalog doesn't know ([`resolve`]). It reads as the id
/// and the ids of the offered models.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownModel(pub String);

impl std::fmt::Display for UnknownModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let known: Vec<_> = offered().into_iter().map(|spec| spec.id).collect();
        write!(
            f,
            "{:?} isn't a known model; known models: {}",
            self.0,
            known.join(", ")
        )
    }
}

impl std::error::Error for UnknownModel {}

/// Whether `dir_name`, a directory under `<search root>/models`, holds a
/// revision of a catalog model other than the one the catalog now pins (the
/// inverse of [`ModelSpec::dir_name`]). Names the catalog doesn't know, or
/// that aren't `<id>@<revision>`, are not superseded.
pub fn superseded(dir_name: &str) -> bool {
    let Some((id, revision)) = dir_name.split_once('@') else {
        return false;
    };
    find(id).is_some_and(|spec| spec.revision != revision)
}

pub fn default_model() -> &'static ModelSpec {
    find(DEFAULT_MODEL).expect("the default model is in the catalog")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_has_three_valid_files() {
        for m in catalog() {
            assert_eq!(m.files.len(), 3, "{}", m.id);
            let names: Vec<_> = m.files.iter().map(|f| f.name).collect();
            assert_eq!(
                names,
                ["model.safetensors", "tokenizer.json", "config.json"]
            );
            for f in &m.files {
                assert_eq!(f.sha256.len(), 64, "{} {}", m.id, f.name);
                assert!(f.sha256.chars().all(|c| c.is_ascii_hexdigit()));
                assert!(f.size > 0);
            }
            assert!(m.resident_bytes > m.files[0].size);
        }
    }

    #[test]
    fn the_catalog_is_granite_first_then_e5_small() {
        let ids: Vec<_> = catalog().iter().map(|m| m.id).collect();
        assert_eq!(
            ids,
            [
                "granite-embedding-97m-multilingual-r2",
                "multilingual-e5-small"
            ]
        );
        assert_eq!(DEFAULT_MODEL, "granite-embedding-97m-multilingual-r2");
        assert_eq!(default_model().id, DEFAULT_MODEL);
        assert_eq!(catalog()[0].id, DEFAULT_MODEL);
        // Models dropped from the catalog are unknown ids now.
        assert!(find("bge-small-en-v1.5").is_none());
        assert!(find("multilingual-e5-base").is_none());
        // A setting naming e5-small keeps resolving to it.
        assert_eq!(
            resolve("multilingual-e5-small").map(|m| m.id),
            Ok("multilingual-e5-small")
        );
        let unknown = resolve("pear-embed").unwrap_err().to_string();
        assert!(
            unknown.starts_with(
                "\"pear-embed\" isn't a known model; known models: \
                 granite-embedding-97m-multilingual-r2, multilingual-e5-small"
            ),
            "{unknown}"
        );
    }

    #[test]
    fn pins_inference_settings() {
        let g = find("granite-embedding-97m-multilingual-r2").unwrap();
        assert_eq!(g.architecture, Architecture::ModernBert);
        assert_eq!(g.pooling, Pooling::Cls);
        assert_eq!((g.query_prefix, g.passage_prefix), ("", ""));
        assert_eq!(g.dim, 384);
        assert_eq!(g.pad_token_id, 179_935);
        assert_eq!(g.max_tokens, 512);
        assert_eq!(g.revision, "835ad14087e140460703cf0fae09f97d469d65c2");

        let e5 = find("multilingual-e5-small").unwrap();
        assert_eq!(e5.architecture, Architecture::Bert);
        assert_eq!(e5.pooling, Pooling::Mean);
        assert_eq!(e5.query_prefix, "query: ");
        assert_eq!(e5.passage_prefix, "passage: ");
        assert_eq!(e5.dim, 384);
        assert_eq!(e5.pad_token_id, 1);
        assert_eq!(e5.max_tokens, 512);
    }

    /// What the model picker shows: the model card's page and licence.
    #[test]
    fn every_entry_names_its_homepage_and_licence() {
        let g = default_model();
        assert_eq!(
            g.homepage,
            "https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2"
        );
        assert_eq!(g.license, "Apache-2.0");
        let e5 = find("multilingual-e5-small").unwrap();
        assert_eq!(
            e5.homepage,
            "https://huggingface.co/intfloat/multilingual-e5-small"
        );
        assert_eq!(e5.license, "MIT");
        for m in catalog() {
            assert_eq!(m.homepage, format!("https://huggingface.co/{}", m.repo));
            assert!(!m.license.is_empty() && m.notice.contains(m.license));
        }
    }

    /// The calibrated values; change them only with a new
    /// calibration run and its report.
    #[test]
    fn pins_calibrated_thresholds() {
        assert_eq!(
            find("granite-embedding-97m-multilingual-r2")
                .unwrap()
                .thresholds,
            GRANITE_97M_THRESHOLDS
        );
        assert_eq!(
            GRANITE_97M_THRESHOLDS,
            Thresholds {
                search_min: 0.815,
                related_min: 0.30,
                related_damping: 0.6,
                max_gap: 0.05,
                similar_weight: 0.0,
                calibrated: true,
            }
        );
        assert_eq!(
            find("multilingual-e5-small").unwrap().thresholds,
            Thresholds {
                search_min: 0.78,
                related_min: 0.20,
                related_damping: 0.7,
                max_gap: 0.04,
                similar_weight: 0.0,
                calibrated: true,
            }
        );
        // The test model lets every match through, so its tests see every page.
        let tiny = test_tiny().thresholds;
        assert_eq!(
            (tiny.search_min, tiny.related_min, tiny.related_damping),
            (0.0, 0.0, 0.0)
        );
        assert!(tiny.max_gap >= 1.0 && !tiny.calibrated);
        assert_eq!(tiny.similar_weight, 1.0);
    }

    #[test]
    fn the_tiny_test_model_is_the_test_models_spec() {
        assert_eq!(test_tiny(), crate::semantic::test_model::tiny_spec());
    }

    #[test]
    fn an_offered_model_is_found_after_the_catalog() {
        let pear = ModelSpec {
            id: "catalog-test-pear",
            ..test_tiny()
        };
        assert!(find("catalog-test-pear").is_none());
        offer(pear.clone());
        offer(pear);
        assert_eq!(
            find("catalog-test-pear").map(|m| m.id),
            Some("catalog-test-pear")
        );
        let ids: Vec<_> = offered().iter().map(|m| m.id).collect();
        assert_eq!(
            ids.iter().filter(|id| **id == "catalog-test-pear").count(),
            1
        );
        assert_eq!(ids[0], DEFAULT_MODEL);
    }

    #[test]
    fn find_by_id() {
        let m = find("multilingual-e5-small").unwrap();
        assert_eq!(m.id, "multilingual-e5-small");
        assert_eq!(find(DEFAULT_MODEL).map(|m| m.id), Some(DEFAULT_MODEL));
        assert!(find("nope").is_none());
    }

    #[test]
    fn the_offered_models_start_with_the_catalog() {
        let offered: Vec<&str> = offered().iter().map(|m| m.id).collect();
        let catalog: Vec<&str> = catalog().iter().map(|m| m.id).collect();
        assert_eq!(offered[..catalog.len()], catalog[..]);
    }

    #[test]
    fn url_and_dir_name() {
        let m = find("multilingual-e5-small").unwrap();
        let cfg = m.files.iter().find(|f| f.name == "config.json").unwrap();
        assert_eq!(
            m.url(cfg),
            "https://huggingface.co/intfloat/multilingual-e5-small/resolve/614241f622f53c4eeff9890bdc4f31cfecc418b3/config.json"
        );
        assert_eq!(
            m.dir_name(),
            "multilingual-e5-small@614241f622f53c4eeff9890bdc4f31cfecc418b3"
        );
    }

    #[test]
    fn only_another_revision_of_a_catalog_model_is_superseded() {
        let m = find("multilingual-e5-small").unwrap();
        assert!(!superseded(&m.dir_name()));
        assert!(superseded(&format!("{}@0123abcd", m.id)));
        for name in ["custom@1", "notes", "bge-small-en-v1.5@5c38ec7c"] {
            assert!(!superseded(name), "{name}");
        }
    }

    #[test]
    fn granite_url_dir_name_and_sizes() {
        let m = find("granite-embedding-97m-multilingual-r2").unwrap();
        let cfg = m.files.iter().find(|f| f.name == "config.json").unwrap();
        assert_eq!(
            m.url(cfg),
            "https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2/resolve/835ad14087e140460703cf0fae09f97d469d65c2/config.json"
        );
        assert_eq!(
            m.dir_name(),
            "granite-embedding-97m-multilingual-r2@835ad14087e140460703cf0fae09f97d469d65c2"
        );
        assert_eq!(m.download_bytes(), 220_192_456);
        // BF16 on disk, F32 in memory.
        assert_eq!(m.resident_bytes, 487_223_920);
    }

    #[test]
    fn download_bytes_e5_small() {
        let m = find("multilingual-e5-small").unwrap();
        assert!(m.download_bytes().abs_diff(487_700_000) < 1_000_000);
        assert_eq!(m.download_bytes(), 487_724_985);
    }
}
