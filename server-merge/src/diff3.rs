use similar::{capture_diff_slices, Algorithm, DiffOp};

use crate::markers::{render_conflict, sha256_hex};
use crate::refine;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeOutcome {
    Clean(String),
    Conflicted { text: String, hunk_count: usize },
}

pub fn merge(base: &str, a: &str, b: &str) -> MergeOutcome {
    let base_lines = split_lines(base);
    let a_lines = split_lines(a);
    let b_lines = split_lines(b);

    let base_hash = sha256_hex(base);
    let a_hash = sha256_hex(a);
    let b_hash = sha256_hex(b);

    let mut result = String::new();
    let mut hunk_count = 0usize;

    walk_diff3(
        &base_lines,
        &a_lines,
        &b_lines,
        |base_chunk, a_chunk, b_chunk, synced| {
            resolve_chunk(
                base_chunk,
                a_chunk,
                &a_hash,
                b_chunk,
                &b_hash,
                &base_hash,
                &mut result,
                &mut hunk_count,
            );
            if let Some(line) = synced {
                result.push_str(line);
            }
            true
        },
    );

    if hunk_count == 0 {
        MergeOutcome::Clean(result)
    } else {
        MergeOutcome::Conflicted {
            text: result,
            hunk_count,
        }
    }
}

pub(crate) enum ChunkTake {
    A,
    B,
}

pub(crate) fn classify_chunk(
    base_chunk: &[&str],
    a_chunk: &[&str],
    b_chunk: &[&str],
) -> Option<ChunkTake> {
    if a_chunk == b_chunk {
        Some(ChunkTake::A)
    } else if a_chunk == base_chunk {
        Some(ChunkTake::B)
    } else if b_chunk == base_chunk {
        Some(ChunkTake::A)
    } else {
        None
    }
}

/// Walks the three-way alignment of `base`/`a`/`b` token slices (lines or
/// words), calling `on_chunk` for each unsynced chunk followed by the next
/// synced item (`None` on the trailing chunk after the last sync point).
/// `on_chunk` returns `false` to abort the walk early.
pub(crate) fn walk_diff3<'a>(
    base: &[&'a str],
    a: &[&'a str],
    b: &[&'a str],
    mut on_chunk: impl FnMut(&[&'a str], &[&'a str], &[&'a str], Option<&'a str>) -> bool,
) -> bool {
    let map_a = align(base, a);
    let map_b = align(base, b);

    let mut sync_base = 0usize;
    let mut sync_a = 0usize;
    let mut sync_b = 0usize;

    for (i, (&map_a_i, &map_b_i)) in map_a.iter().zip(map_b.iter()).enumerate() {
        let (Some(ai), Some(bi)) = (map_a_i, map_b_i) else {
            continue;
        };
        if !on_chunk(
            &base[sync_base..i],
            &a[sync_a..ai],
            &b[sync_b..bi],
            Some(base[i]),
        ) {
            return false;
        }
        sync_base = i + 1;
        sync_a = ai + 1;
        sync_b = bi + 1;
    }

    on_chunk(&base[sync_base..], &a[sync_a..], &b[sync_b..], None)
}

fn align(base_lines: &[&str], side_lines: &[&str]) -> Vec<Option<usize>> {
    let ops = capture_diff_slices(Algorithm::Myers, base_lines, side_lines);
    let mut map = vec![None; base_lines.len()];
    for op in ops {
        if let DiffOp::Equal {
            old_index,
            new_index,
            len,
        } = op
        {
            for k in 0..len {
                map[old_index + k] = Some(new_index + k);
            }
        }
    }
    map
}

fn split_lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

#[allow(clippy::too_many_arguments)]
fn resolve_chunk(
    base_chunk: &[&str],
    a_chunk: &[&str],
    a_hash: &str,
    b_chunk: &[&str],
    b_hash: &str,
    base_hash: &str,
    result: &mut String,
    hunk_count: &mut usize,
) {
    match classify_chunk(base_chunk, a_chunk, b_chunk) {
        Some(ChunkTake::A) => {
            for line in a_chunk {
                result.push_str(line);
            }
        }
        Some(ChunkTake::B) => {
            for line in b_chunk {
                result.push_str(line);
            }
        }
        None => {
            let base_text: String = base_chunk.concat();
            let a_text: String = a_chunk.concat();
            let b_text: String = b_chunk.concat();
            if let Some(refined) = refine::refine_chunk(&base_text, &a_text, &b_text) {
                result.push_str(&refined);
            } else {
                *hunk_count += 1;
                render_conflict(
                    base_chunk, a_chunk, a_hash, b_chunk, b_hash, base_hash, result,
                );
            }
        }
    }
}
