//! Static catalog of the embedding models the server can download and run.
//!
//! Every model property lives here; nothing else in the crate hardcodes one.

use std::sync::OnceLock;

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
}

/// One pinned file of a model repository.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelFile {
    pub name: &'static str,
    pub size: u64,
    pub sha256: &'static str,
}

/// Cosine-similarity cut-offs for search and related-page results.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thresholds {
    pub search_min: f32,
    pub related_min: f32,
    pub max_gap: f32,
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
    pub normalize: bool,
    pub query_prefix: &'static str,
    pub passage_prefix: &'static str,
    pub max_tokens: usize,
    pub pad_token_id: u32,
    pub languages: &'static str,
    pub license: &'static str,
    pub notice: &'static str,
    pub resident_bytes: u64,
    pub thresholds: Thresholds,
    pub default: bool,
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

/// Desktop's values (calibrated on an INT8 model); the eval replaces them.
const DEFAULT_THRESHOLDS: Thresholds = Thresholds {
    search_min: 0.79,
    related_min: 0.85,
    max_gap: 0.04,
    calibrated: false,
};

fn build_catalog() -> Vec<ModelSpec> {
    vec![
        ModelSpec {
            id: "bge-small-en-v1.5",
            display_name: "BGE Small English v1.5",
            repo: "BAAI/bge-small-en-v1.5",
            revision: "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
            files: vec![
                ModelFile {
                    name: "model.safetensors",
                    size: 133_466_304,
                    sha256: "3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad",
                },
                ModelFile {
                    name: "tokenizer.json",
                    size: 711_396,
                    sha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
                },
                ModelFile {
                    name: "config.json",
                    size: 743,
                    sha256: "094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750",
                },
            ],
            architecture: Architecture::Bert,
            dim: 384,
            pooling: Pooling::Cls,
            normalize: true,
            query_prefix: "Represent this sentence for searching relevant passages: ",
            passage_prefix: "",
            max_tokens: 512,
            pad_token_id: 0,
            languages: "English",
            license: "MIT",
            notice: "BAAI/bge-small-en-v1.5 by the Beijing Academy of Artificial Intelligence (BAAI), MIT license.",
            resident_bytes: resident(133_466_304),
            thresholds: DEFAULT_THRESHOLDS,
            default: false,
        },
        ModelSpec {
            id: "multilingual-e5-small",
            display_name: "Multilingual E5 Small",
            repo: "intfloat/multilingual-e5-small",
            revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
            files: vec![
                ModelFile {
                    name: "model.safetensors",
                    size: 470_641_600,
                    sha256: "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477",
                },
                ModelFile {
                    name: "tokenizer.json",
                    size: 17_082_730,
                    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
                },
                ModelFile {
                    name: "config.json",
                    size: 655,
                    sha256: "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959",
                },
            ],
            architecture: Architecture::Bert,
            dim: 384,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "query: ",
            passage_prefix: "passage: ",
            max_tokens: 512,
            // The tokenizer's <pad> is 1; the attention mask makes the value irrelevant.
            pad_token_id: 1,
            languages: "Multilingual (about 100 languages)",
            license: "MIT",
            notice: "intfloat/multilingual-e5-small by Liang Wang et al. (Microsoft), MIT license.",
            resident_bytes: resident(470_641_600),
            thresholds: DEFAULT_THRESHOLDS,
            default: true,
        },
        ModelSpec {
            id: "multilingual-e5-base",
            display_name: "Multilingual E5 Base",
            repo: "intfloat/multilingual-e5-base",
            revision: "d128750597153bb5987e10b1c3493a34e5a4502a",
            files: vec![
                ModelFile {
                    name: "model.safetensors",
                    size: 1_112_201_288,
                    sha256: "a18a44fad1d0b46ded15928144138cff1135d5cc8233bdd90be5f18822de09a7",
                },
                ModelFile {
                    name: "tokenizer.json",
                    size: 17_082_660,
                    sha256: "62c24cdc13d4c9952d63718d6c9fa4c287974249e16b7ade6d5a85e7bbb75626",
                },
                ModelFile {
                    name: "config.json",
                    size: 694,
                    sha256: "9dab198f24c8c0879e481cf7822005d5ecbceedbacb390ffafa594e28d31bac4",
                },
            ],
            architecture: Architecture::XlmRoberta,
            dim: 768,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "query: ",
            passage_prefix: "passage: ",
            max_tokens: 512,
            pad_token_id: 1,
            languages: "Multilingual (about 100 languages)",
            license: "MIT",
            notice: "intfloat/multilingual-e5-base by Liang Wang et al. (Microsoft), MIT license.",
            resident_bytes: resident(1_112_201_288),
            thresholds: DEFAULT_THRESHOLDS,
            default: false,
        },
    ]
}

/// The launch catalog, built once.
pub fn catalog() -> &'static [ModelSpec] {
    static CATALOG: OnceLock<Vec<ModelSpec>> = OnceLock::new();
    CATALOG.get_or_init(build_catalog)
}

pub fn find(id: &str) -> Option<&'static ModelSpec> {
    catalog().iter().find(|m| m.id == id)
}

pub fn default_model() -> &'static ModelSpec {
    catalog()
        .iter()
        .find(|m| m.default)
        .expect("catalog has a default model")
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
    fn dims_and_default() {
        let dims: Vec<_> = catalog().iter().map(|m| m.dim).collect();
        assert_eq!(dims, [384, 384, 768]);
        let defaults: Vec<_> = catalog().iter().filter(|m| m.default).collect();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].id, "multilingual-e5-small");
        assert_eq!(default_model().id, "multilingual-e5-small");
    }

    #[test]
    fn pins_inference_settings() {
        const BGE_PREFIX: &str = "Represent this sentence for searching relevant passages: ";
        // (id, pooling, query prefix, passage prefix, dim, pad_token_id, architecture)
        let expected = [
            (
                "bge-small-en-v1.5",
                Pooling::Cls,
                BGE_PREFIX,
                "",
                384,
                0,
                Architecture::Bert,
            ),
            (
                "multilingual-e5-small",
                Pooling::Mean,
                "query: ",
                "passage: ",
                384,
                1,
                Architecture::Bert,
            ),
            (
                "multilingual-e5-base",
                Pooling::Mean,
                "query: ",
                "passage: ",
                768,
                1,
                Architecture::XlmRoberta,
            ),
        ];
        assert_eq!(catalog().len(), expected.len());
        for (id, pooling, q, p, dim, pad, arch) in expected {
            let m = find(id).unwrap();
            assert_eq!(m.pooling, pooling, "{id}");
            assert_eq!(m.query_prefix, q, "{id}");
            assert_eq!(m.passage_prefix, p, "{id}");
            assert_eq!(m.dim, dim, "{id}");
            assert_eq!(m.pad_token_id, pad, "{id}");
            assert_eq!(m.architecture, arch, "{id}");
            assert!(m.normalize);
            assert_eq!(m.max_tokens, 512);
        }
    }

    #[test]
    fn find_by_id() {
        let m = find("multilingual-e5-small").unwrap();
        assert!(m.default);
        assert!(find("nope").is_none());
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
    fn download_bytes_e5_small() {
        let m = find("multilingual-e5-small").unwrap();
        assert!(m.download_bytes().abs_diff(487_700_000) < 1_000_000);
        assert_eq!(m.download_bytes(), 487_724_985);
    }
}
