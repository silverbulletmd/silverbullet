//! A vectorisable exact GELU (erf form) for f32 on the CPU. candle's
//! `gelu_erf` calls scalar `libm::erff` per element, which showed up as a
//! large share of a forward pass once matmuls got fast. Used where a model
//! uses GELU (BERT, so e5-small); ModernBERT models such as Granite use SiLU.
//!
//! The erf approximation is a rational one, clamped to [-4, 4], with an odd
//! numerator of degree 13 over an even denominator of degree 8: a few ulp
//! from `erff`, branch-free, so it auto-vectorises. Its coefficients are the
//! float ones of Eigen's `generic_fast_erf_float`
//! (<https://gitlab.com/libeigen/eigen>, MPL-2.0), which XLA uses for f32
//! `erf` too (<https://github.com/openxla/xla>, Apache-2.0).

use candle_core::{CpuStorage, CustomOp1, Layout, Result, Shape, Tensor};
use rayon::prelude::*;

#[inline(always)]
fn erf(x: f32) -> f32 {
    let x = x.clamp(-4.0, 4.0);
    let x2 = x * x;
    let mut p = x2 * -2.726_142_3e-10 + 2.770_681_4e-8;
    p = p * x2 + -2.101_024e-6;
    p = p * x2 + -5.692_506_4e-5;
    p = p * x2 + -7.349_906_3e-4;
    p = p * x2 + -2.954_6e-3;
    p = p * x2 + -1.609_603_3e-2;
    let p = x * p;
    let mut q = x2 * -1.456_607_2e-5 + -2.133_740_6e-4;
    q = q * x2 + -1.682_827e-3;
    q = q * x2 + -7.373_329e-3;
    q = q * x2 + -1.426_473_9e-2;
    p / q
}

#[inline(always)]
fn gelu(v: f32) -> f32 {
    0.5 * v * (1.0 + erf(v * std::f32::consts::FRAC_1_SQRT_2))
}

fn gelu_slice(src: &[f32], dst: &mut [f32]) {
    for (d, s) in dst.iter_mut().zip(src) {
        *d = gelu(*s);
    }
}

struct FastGeluErf;

impl CustomOp1 for FastGeluErf {
    fn name(&self) -> &'static str {
        "fast-gelu-erf"
    }

    fn cpu_fwd(&self, storage: &CpuStorage, layout: &Layout) -> Result<(CpuStorage, Shape)> {
        let CpuStorage::F32(data) = storage else {
            candle_core::bail!("fast-gelu-erf: f32 only");
        };
        let Some((start, end)) = layout.contiguous_offsets() else {
            candle_core::bail!("fast-gelu-erf: contiguous input only");
        };
        let src = &data[start..end];
        let mut out = vec![0f32; src.len()];
        // On the embedder's rayon pool (the forward pass runs inside it).
        const CHUNK: usize = 16 * 1024;
        if src.len() >= 2 * CHUNK {
            out.par_chunks_mut(CHUNK)
                .zip(src.par_chunks(CHUNK))
                .for_each(|(d, s)| gelu_slice(s, d));
        } else {
            gelu_slice(src, &mut out);
        }
        Ok((CpuStorage::F32(out), layout.shape().clone()))
    }
}

/// Exact GELU of `xs`: the fast kernel for contiguous f32 on the CPU,
/// candle's `gelu_erf` otherwise.
pub fn gelu_erf(xs: &Tensor) -> Result<Tensor> {
    if xs.dtype() == candle_core::DType::F32 && xs.device().is_cpu() && xs.is_contiguous() {
        xs.apply_op1_no_bwd(&FastGeluErf)
    } else {
        xs.gelu_erf()
    }
}

#[cfg(test)]
mod tests {
    use candle_core::{Device, Tensor};

    #[test]
    fn matches_candles_gelu_erf() {
        let xs: Vec<f32> = (-20_000..20_000).map(|i| i as f32 * 0.0005).collect();
        let t = Tensor::new(xs.as_slice(), &Device::Cpu).unwrap();
        let fast = super::gelu_erf(&t).unwrap().to_vec1::<f32>().unwrap();
        let exact = t.gelu_erf().unwrap().to_vec1::<f32>().unwrap();
        let worst = fast
            .iter()
            .zip(&exact)
            .map(|(a, b)| (a - b).abs() / b.abs().max(1.0))
            .fold(0f32, f32::max);
        // Relative above 1, absolute below (the far negative tail loses digits to 1 + erf).
        assert!(worst < 2e-6, "{worst}");
    }

    #[test]
    fn large_inputs_run_in_parallel_chunks_and_match() {
        let xs: Vec<f32> = (0..100_000)
            .map(|i| (i as f32 * 0.37).sin() * 6.0)
            .collect();
        let t = Tensor::new(xs.as_slice(), &Device::Cpu)
            .unwrap()
            .reshape((100, 1000))
            .unwrap();
        let fast = super::gelu_erf(&t)
            .unwrap()
            .flatten_all()
            .unwrap()
            .to_vec1::<f32>()
            .unwrap();
        let exact = t
            .gelu_erf()
            .unwrap()
            .flatten_all()
            .unwrap()
            .to_vec1::<f32>()
            .unwrap();
        for (a, b) in fast.iter().zip(&exact) {
            assert!((a - b).abs() / b.abs().max(1.0) < 2e-6, "{a} {b}");
        }
    }

    #[test]
    fn a_non_contiguous_input_falls_back_to_candle() {
        let t = Tensor::new(&[[-1.5f32, 0.25], [2.0, -0.75]], &Device::Cpu)
            .unwrap()
            .t()
            .unwrap();
        assert!(!t.is_contiguous());
        let fast = super::gelu_erf(&t).unwrap().to_vec2::<f32>().unwrap();
        assert_eq!(fast, t.gelu_erf().unwrap().to_vec2::<f32>().unwrap());
    }
}
