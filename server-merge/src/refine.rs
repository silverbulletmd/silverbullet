use crate::diff3::{classify_chunk, walk_diff3, ChunkTake};

pub(crate) const REFINE_CHUNK_LIMIT: usize = 8192;

pub(crate) fn refine_chunk(base: &str, a: &str, b: &str) -> Option<String> {
    if base.len() > REFINE_CHUNK_LIMIT
        || a.len() > REFINE_CHUNK_LIMIT
        || b.len() > REFINE_CHUNK_LIMIT
    {
        return None;
    }

    let base_tokens = tokenize(base);
    let a_tokens = tokenize(a);
    let b_tokens = tokenize(b);

    let mut result = String::new();
    let ok = walk_diff3(
        &base_tokens,
        &a_tokens,
        &b_tokens,
        |base_chunk, a_chunk, b_chunk, synced| {
            match classify_chunk(base_chunk, a_chunk, b_chunk) {
                Some(ChunkTake::A) => {
                    for token in a_chunk {
                        result.push_str(token);
                    }
                }
                Some(ChunkTake::B) => {
                    for token in b_chunk {
                        result.push_str(token);
                    }
                }
                None => return false,
            }
            if let Some(token) = synced {
                result.push_str(token);
            }
            true
        },
    );

    ok.then_some(result)
}

fn tokenize(text: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut chars = text.char_indices().peekable();

    while let Some(&(start, ch)) = chars.peek() {
        let mut end = start;
        if ch.is_whitespace() {
            while let Some(&(idx, c)) = chars.peek() {
                if !c.is_whitespace() {
                    break;
                }
                end = idx + c.len_utf8();
                chars.next();
            }
        } else {
            while let Some(&(idx, c)) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                end = idx + c.len_utf8();
                chars.next();
            }
            while let Some(&(idx, c)) = chars.peek() {
                if !c.is_whitespace() {
                    break;
                }
                end = idx + c.len_utf8();
                chars.next();
            }
        }
        tokens.push(&text[start..end]);
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_lossless(text: &str) {
        let tokens = tokenize(text);
        assert_eq!(tokens.concat(), text, "tokens must reconstruct {text:?}");
    }

    #[test]
    fn tokenizer_is_lossless() {
        for text in [
            "a b  c",
            "  leading",
            "trailing  ",
            "a\r\nb",
            "héllo wörld",
            "",
            "nospaceshere",
        ] {
            assert_lossless(text);
        }
    }

    #[test]
    fn tokenizer_boundaries() {
        assert_eq!(tokenize("a b  c"), vec!["a ", "b  ", "c"]);
        assert_eq!(tokenize("  leading"), vec!["  ", "leading"]);
        assert_eq!(tokenize("trailing  "), vec!["trailing  "]);
        assert_eq!(tokenize("a\r\nb"), vec!["a\r\n", "b"]);
        assert_eq!(tokenize(""), Vec::<&str>::new());
        assert_eq!(tokenize("nospaceshere"), vec!["nospaceshere"]);
    }
}
