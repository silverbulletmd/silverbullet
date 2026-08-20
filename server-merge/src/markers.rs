use std::fmt::Write as _;

use sha2::{Digest, Sha256};

pub(crate) fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    hex
}

pub fn contains_conflict_markers(text: &str) -> bool {
    text.lines()
        .any(|line| line.starts_with("<<<<<<< SB sha256:"))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn render_conflict(
    base_chunk: &[&str],
    a_chunk: &[&str],
    a_hash: &str,
    b_chunk: &[&str],
    b_hash: &str,
    base_hash: &str,
    out: &mut String,
) {
    let (lower_hash, lower_chunk, higher_hash, higher_chunk) = if a_hash <= b_hash {
        (a_hash, a_chunk, b_hash, b_chunk)
    } else {
        (b_hash, b_chunk, a_hash, a_chunk)
    };

    out.push_str("<<<<<<< SB sha256:");
    out.push_str(lower_hash);
    out.push('\n');
    push_hunk_body(out, lower_chunk);

    out.push_str("||||||| SB BASE sha256:");
    out.push_str(base_hash);
    out.push('\n');
    push_hunk_body(out, base_chunk);

    out.push_str("=======\n");
    push_hunk_body(out, higher_chunk);

    out.push_str(">>>>>>> SB sha256:");
    out.push_str(higher_hash);
    out.push('\n');
}

fn push_hunk_body(out: &mut String, lines: &[&str]) {
    for line in lines {
        out.push_str(line);
    }
    if !lines.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}
