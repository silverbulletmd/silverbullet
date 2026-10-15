//! Vendored BERT, ModernBERT and XLM-RoBERTa model code (see the header of each file), and
//! our own faster kernels for them (`fast_ops`).
//! candle-transformers is deliberately not a dependency.

#[allow(clippy::all)]
pub mod bert;
pub mod fast_ops;
#[allow(clippy::all)]
pub mod modernbert;
#[allow(clippy::all)]
pub mod xlm_roberta;

#[cfg(test)]
mod tests {
    use candle_core::{DType, Device, Tensor};
    use candle_nn::{VarBuilder, VarMap};

    #[test]
    fn a_random_tiny_bert_runs_forward() {
        let cfg: super::bert::Config = serde_json::from_value(serde_json::json!({
            "vocab_size": 32, "hidden_size": 8, "num_hidden_layers": 2, "num_attention_heads": 2,
            "intermediate_size": 16, "hidden_act": "gelu", "max_position_embeddings": 64,
            "type_vocab_size": 2, "layer_norm_eps": 1e-12, "pad_token_id": 0, "hidden_dropout_prob": 0.0, "initializer_range": 0.02
        }))
        .unwrap();
        let map = VarMap::new();
        let vb = VarBuilder::from_varmap(&map, DType::F32, &Device::Cpu);
        let model = super::bert::BertModel::load(vb, &cfg).unwrap();
        let ids = Tensor::new(&[[1u32, 5, 7, 2]], &Device::Cpu).unwrap();
        let types = ids.zeros_like().unwrap();
        let mask = ids.ones_like().unwrap();
        let out = model.forward(&ids, &types, Some(&mask)).unwrap();
        assert_eq!(out.dims(), &[1, 4, 8]);
    }

    #[test]
    fn a_random_tiny_xlm_roberta_runs_forward() {
        let cfg: super::xlm_roberta::Config = serde_json::from_value(serde_json::json!({
            "hidden_size": 8, "layer_norm_eps": 1e-5, "attention_probs_dropout_prob": 0.0,
            "hidden_dropout_prob": 0.0, "num_attention_heads": 2, "intermediate_size": 16,
            "hidden_act": "gelu", "num_hidden_layers": 2, "vocab_size": 32,
            "max_position_embeddings": 66, "type_vocab_size": 1, "pad_token_id": 1, "position_embedding_type": "absolute"
        }))
        .unwrap();
        let map = VarMap::new();
        let vb = VarBuilder::from_varmap(&map, DType::F32, &Device::Cpu);
        let model = super::xlm_roberta::XLMRobertaModel::new(&cfg, vb).unwrap();
        let ids = Tensor::new(&[[2u32, 5, 7, 3]], &Device::Cpu).unwrap();
        let types = ids.zeros_like().unwrap();
        let mask = ids.ones_like().unwrap();
        let out = model
            .forward(&ids, &mask, &types, None, None, None)
            .unwrap();
        assert_eq!(out.dims(), &[1, 4, 8]);
    }
}
