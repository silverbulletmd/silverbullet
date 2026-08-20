use sha2::{Digest, Sha256};
use silverbullet_server_merge::{contains_conflict_markers, merge, MergeOutcome};

fn hex_sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn assert_symmetric(base: &str, a: &str, b: &str) {
    let forward = merge(base, a, b);
    let backward = merge(base, b, a);
    let forward_text = match forward {
        MergeOutcome::Clean(text) => text,
        MergeOutcome::Conflicted { text, .. } => text,
    };
    let backward_text = match backward {
        MergeOutcome::Clean(text) => text,
        MergeOutcome::Conflicted { text, .. } => text,
    };
    assert_eq!(
        forward_text.as_bytes(),
        backward_text.as_bytes(),
        "merge(base, a, b) and merge(base, b, a) must be byte-identical"
    );
}

#[test]
fn non_overlapping_edits_merge_cleanly() {
    let base = "a\nb\nc\n";
    let a = "A\nb\nc\n";
    let b = "a\nb\nC\n";
    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Clean("A\nb\nC\n".to_string())
    );
}

#[test]
fn insertion_vs_unrelated_deletion_merges_cleanly() {
    let base = "a\nb\nc\nd\n";
    let a = "a\nx\nb\nc\nd\n";
    let b = "a\nb\nd\n";
    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Clean("a\nx\nb\nd\n".to_string())
    );
}

#[test]
fn same_change_on_both_sides_merges_cleanly_applied_once() {
    let base = "a\nb\nc\n";
    let a = "a\nB\nc\n";
    let b = "a\nB\nc\n";
    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Clean("a\nB\nc\n".to_string())
    );
}

#[test]
fn one_side_unchanged_returns_other_side_verbatim_missing_trailing_newline() {
    let base = "a\nb\nc\n";
    let a = base;
    let b = "a\nb\nc";
    assert_eq!(merge(base, a, b), MergeOutcome::Clean(b.to_string()));
}

#[test]
fn overlapping_same_line_edits_conflict() {
    let base = "a\nb\nc\n";
    let a = "a\nB1\nc\n";
    let b = "a\nB2\nc\n";

    let a_hash = hex_sha256(a);
    let b_hash = hex_sha256(b);
    let base_hash = hex_sha256(base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, "B1\n", b_hash, "B2\n")
    } else {
        (b_hash, "B2\n", a_hash, "B1\n")
    };

    let expected = format!(
        "a\n<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\nb\n=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\nc\n"
    );

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_symmetric(base, a, b);
}

#[test]
fn empty_base_both_sides_added_different_content_conflicts_whole_file() {
    let base = "";
    let a = "hello\n";
    let b = "world\n";

    let a_hash = hex_sha256(a);
    let b_hash = hex_sha256(b);
    let base_hash = hex_sha256(base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, "hello\n", b_hash, "world\n")
    } else {
        (b_hash, "world\n", a_hash, "hello\n")
    };

    let expected = format!(
        "<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\n=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\n"
    );

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_symmetric(base, a, b);
}

#[test]
fn no_trailing_newline_on_conflicting_side_gets_newline_appended_before_next_marker() {
    let base = "a\nb\n";
    let a = "a\nB1";
    let b = "a\nB2\n";

    let a_hash = hex_sha256(a);
    let b_hash = hex_sha256(b);
    let base_hash = hex_sha256(base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, "B1\n", b_hash, "B2\n")
    } else {
        (b_hash, "B2\n", a_hash, "B1\n")
    };

    let expected = format!(
        "a\n<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\nb\n=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\n"
    );

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_symmetric(base, a, b);
}

#[test]
fn crlf_input_lines_preserved_verbatim_in_hunk_bodies() {
    let base = "a\r\nb\r\nc\r\n";
    let a = "a\r\nB1\r\nc\r\n";
    let b = "a\r\nB2\r\nc\r\n";

    let a_hash = hex_sha256(a);
    let b_hash = hex_sha256(b);
    let base_hash = hex_sha256(base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, "B1\r\n", b_hash, "B2\r\n")
    } else {
        (b_hash, "B2\r\n", a_hash, "B1\r\n")
    };

    let expected = format!(
        "a\r\n<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\nb\r\n=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\nc\r\n"
    );

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_symmetric(base, a, b);
}

#[test]
fn contains_conflict_markers_detects_marker_line() {
    assert!(contains_conflict_markers("<<<<<<< SB sha256:abc123\nfoo\n"));
    assert!(!contains_conflict_markers("plain text\nno markers here\n"));
    assert!(!contains_conflict_markers("=======\n"));
}

fn assert_full_symmetry(base: &str, a: &str, b: &str) {
    assert_eq!(
        merge(base, a, b),
        merge(base, b, a),
        "merge(base, a, b) and merge(base, b, a) must be fully equal (variant, hunk_count, text)"
    );
}

#[test]
fn refinement_merges_start_and_end_word_edits_on_same_line() {
    let base = "The quick brown fox jumps over the lazy dog.\n";
    let a = "A quick brown fox jumps over the lazy dog.\n";
    let b = "The quick brown fox jumps over the lazy cat.\n";

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Clean("A quick brown fox jumps over the lazy cat.\n".to_string())
    );

    assert_full_symmetry(base, a, b);
}

#[test]
fn refinement_merges_mid_line_insertion_and_end_of_line_append() {
    let base = "The cat sat on the mat.\n";
    let a = "The cat immediately sat on the mat.\n";
    let b = "The cat sat on the mat. The end.\n";

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Clean("The cat immediately sat on the mat. The end.\n".to_string())
    );

    assert_full_symmetry(base, a, b);
}

#[test]
fn refinement_merges_middle_edit_on_line_one_with_end_edit_on_line_one_and_edit_on_line_three() {
    let base =
        "The quick brown fox jumps over the lazy dog.\nSecond line unchanged.\nThird line here.\n";
    let a =
        "The quick red fox jumps over the lazy dog.\nSecond line unchanged.\nThird line here.\n";
    let b =
        "The quick brown fox jumps over the lazy cat.\nSecond line unchanged.\nThird line there.\n";

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Clean(
            "The quick red fox jumps over the lazy cat.\nSecond line unchanged.\nThird line there.\n"
                .to_string()
        )
    );

    assert_full_symmetry(base, a, b);
}

#[test]
fn refinement_leaves_same_position_different_insertions_conflicted() {
    let base = "a b\n";
    let a = "a X b\n";
    let b = "a Y b\n";

    let a_hash = hex_sha256(a);
    let b_hash = hex_sha256(b);
    let base_hash = hex_sha256(base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, a, b_hash, b)
    } else {
        (b_hash, b, a_hash, a)
    };

    let expected = format!(
        "<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\n{base}=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\n"
    );

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_full_symmetry(base, a, b);
}

#[test]
fn refinement_leaves_same_word_edited_differently_conflicted_byte_identical_to_line_level_hunk() {
    let base = "The quick brown fox jumps over the lazy dog.\n";
    let a = "The quick red fox jumps over the lazy dog.\n";
    let b = "The quick green fox jumps over the lazy dog.\n";

    let a_hash = hex_sha256(a);
    let b_hash = hex_sha256(b);
    let base_hash = hex_sha256(base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, a, b_hash, b)
    } else {
        (b_hash, b, a_hash, a)
    };

    let expected = format!(
        "<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\n{base}=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\n"
    );

    assert_eq!(
        merge(base, a, b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_full_symmetry(base, a, b);
}

#[test]
fn refinement_guard_skips_refinement_above_size_limit() {
    let middle = "middle ".repeat(1200);
    let base = format!("start {middle}end\n");
    let a = format!("A {middle}end\n");
    let b = format!("start {middle}END\n");

    assert!(base.len() > 8192);
    assert!(a.len() > 8192);
    assert!(b.len() > 8192);

    let a_hash = hex_sha256(&a);
    let b_hash = hex_sha256(&b);
    let base_hash = hex_sha256(&base);

    let (lower_hash, lower_content, higher_hash, higher_content) = if a_hash <= b_hash {
        (a_hash, &a, b_hash, &b)
    } else {
        (b_hash, &b, a_hash, &a)
    };

    let expected = format!(
        "<<<<<<< SB sha256:{lower_hash}\n{lower_content}||||||| SB BASE sha256:{base_hash}\n{base}=======\n{higher_content}>>>>>>> SB sha256:{higher_hash}\n"
    );

    assert_eq!(
        merge(&base, &a, &b),
        MergeOutcome::Conflicted {
            text: expected,
            hunk_count: 1,
        }
    );

    assert_full_symmetry(&base, &a, &b);
}

struct Xorshift32(u32);

impl Xorshift32 {
    fn new(seed: u32) -> Self {
        Xorshift32(if seed == 0 { 0xdead_beef } else { seed })
    }

    fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    fn next_range(&mut self, bound: u32) -> u32 {
        self.next_u32() % bound
    }
}

const RANDOM_ALPHABET: &[&str] = &["alpha", "beta", "gamma", "delta", "epsilon"];

fn random_words(rng: &mut Xorshift32, count: u32) -> Vec<&'static str> {
    (0..count)
        .map(|_| RANDOM_ALPHABET[rng.next_range(RANDOM_ALPHABET.len() as u32) as usize])
        .collect()
}

fn mutate_words(rng: &mut Xorshift32, words: &[&'static str], edits: u32) -> Vec<&'static str> {
    let mut result = words.to_vec();
    for _ in 0..edits {
        if result.is_empty() {
            result.push(RANDOM_ALPHABET[rng.next_range(RANDOM_ALPHABET.len() as u32) as usize]);
            continue;
        }
        let idx = rng.next_range(result.len() as u32) as usize;
        let word = RANDOM_ALPHABET[rng.next_range(RANDOM_ALPHABET.len() as u32) as usize];
        if rng.next_range(2) == 0 {
            result[idx] = word;
        } else {
            result.insert(idx, word);
        }
    }
    result
}

fn join_line(words: &[&str]) -> String {
    format!("{}\n", words.join(" "))
}

#[test]
fn randomized_refinement_probe() {
    for seed in 1..=500u32 {
        let mut rng = Xorshift32::new(seed);
        let base_word_count = 2 + rng.next_range(4);
        let base_words = random_words(&mut rng, base_word_count);
        let a_edits = rng.next_range(3);
        let b_edits = rng.next_range(3);
        let a_words = mutate_words(&mut rng, &base_words, a_edits);
        let b_words = mutate_words(&mut rng, &base_words, b_edits);

        let base = join_line(&base_words);
        let a = join_line(&a_words);
        let b = join_line(&b_words);

        let forward = merge(&base, &a, &b);
        let backward = merge(&base, &b, &a);
        assert_eq!(
            forward, backward,
            "seed {seed}: merge(base, a, b) must fully equal merge(base, b, a); base={base:?} a={a:?} b={b:?}"
        );

        if let MergeOutcome::Clean(text) = &forward {
            use std::collections::HashSet;
            let base_set: HashSet<&str> = base_words.iter().copied().collect();
            let a_unique: HashSet<&str> = a_words
                .iter()
                .copied()
                .filter(|w| !base_set.contains(w))
                .collect();
            let b_unique: HashSet<&str> = b_words
                .iter()
                .copied()
                .filter(|w| !base_set.contains(w))
                .collect();
            for word in a_unique.union(&b_unique) {
                assert!(
                    text.contains(word),
                    "seed {seed}: clean merge {text:?} missing unique token {word:?} (base={base:?} a={a:?} b={b:?})"
                );
            }
        }
    }
}
