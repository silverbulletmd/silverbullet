//! The tokenizer under every full-text analyzer: runs of letters and digits,
//! as Tantivy's `SimpleTokenizer` makes them, except that Chinese, Japanese
//! and Korean text, which has no spaces between words, becomes overlapping
//! two-character tokens (`東京タワー`: `東京`, `京タ`, `タワ`, `ワー`), so a word
//! matches inside a longer run as the sequence of its own bigrams. A lone
//! CJK character is one token. A run that mixes scripts splits where the
//! script changes (`iPhone用`: `iPhone`, `用`).

use tantivy::tokenizer::{Token, TokenStream, Tokenizer};

use super::script::{is_cjk, is_cjk_letter as cjk_letter};

#[derive(Clone, Default)]
pub struct SbTokenizer {
    token: Token,
}

pub struct SbTokenStream<'a> {
    text: &'a str,
    /// Where scanning continues.
    at: usize,
    /// Inside a CJK run: where the next bigram starts (the last token's
    /// second character).
    bigram_from: Option<usize>,
    token: &'a mut Token,
}

impl Tokenizer for SbTokenizer {
    type TokenStream<'a> = SbTokenStream<'a>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> SbTokenStream<'a> {
        self.token.reset();
        SbTokenStream {
            text,
            at: 0,
            bigram_from: None,
            token: &mut self.token,
        }
    }
}

impl SbTokenStream<'_> {
    fn char_at(&self, at: usize) -> Option<char> {
        self.text[at..].chars().next()
    }

    fn emit(&mut self, from: usize, to: usize) -> bool {
        self.token.text.clear();
        self.token.text.push_str(&self.text[from..to]);
        self.token.offset_from = from;
        self.token.offset_to = to;
        self.token.position = self.token.position.wrapping_add(1);
        true
    }
}

impl TokenStream for SbTokenStream<'_> {
    fn advance(&mut self) -> bool {
        if let Some(from) = self.bigram_from.take() {
            if let Some(c) = self.char_at(self.at).filter(|&c| cjk_letter(c)) {
                let to = self.at + c.len_utf8();
                self.bigram_from = Some(self.at);
                self.at = to;
                return self.emit(from, to);
            }
        }
        while let Some(c) = self.char_at(self.at) {
            if c.is_alphanumeric() {
                break;
            }
            self.at += c.len_utf8();
        }
        let start = self.at;
        let Some(c) = self.char_at(start) else {
            return false;
        };
        let second = start + c.len_utf8();
        if is_cjk(c) {
            let end = match self.char_at(second).filter(|&d| cjk_letter(d)) {
                Some(d) => {
                    self.bigram_from = Some(second);
                    second + d.len_utf8()
                }
                None => second,
            };
            self.at = end;
            return self.emit(start, end);
        }
        let end = self.text[second..]
            .char_indices()
            .find(|&(_, d)| !d.is_alphanumeric() || is_cjk(d))
            .map_or(self.text.len(), |(i, _)| second + i);
        self.at = end;
        self.emit(start, end)
    }

    fn token(&self) -> &Token {
        self.token
    }

    fn token_mut(&mut self) -> &mut Token {
        self.token
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tantivy::tokenizer::SimpleTokenizer;

    /// `(text, position, offset_from, offset_to)` of every token.
    fn run<T: Tokenizer>(mut tokenizer: T, text: &str) -> Vec<(String, usize, usize, usize)> {
        let mut stream = tokenizer.token_stream(text);
        let mut out = Vec::new();
        while let Some(t) = stream.next() {
            out.push((t.text.clone(), t.position, t.offset_from, t.offset_to));
        }
        out
    }

    fn texts(text: &str) -> Vec<String> {
        run(SbTokenizer::default(), text)
            .into_iter()
            .map(|t| t.0)
            .collect()
    }

    #[test]
    fn cjk_runs_become_overlapping_bigrams_in_order() {
        let tok = |t: &str, p, a, b| (t.to_string(), p, a, b);
        assert_eq!(
            run(SbTokenizer::default(), "東京タワー"),
            [
                tok("東京", 0, 0, 6),
                tok("京タ", 1, 3, 9),
                tok("タワ", 2, 6, 12),
                tok("ワー", 3, 9, 15),
            ]
        );
    }

    #[test]
    fn scripts_split_and_lone_characters_stay_whole() {
        assert_eq!(
            texts("iPhone用のケース、猫"),
            ["iPhone", "用の", "のケ", "ケー", "ース", "猫"]
        );
        assert_eq!(texts("학교에서 공부"), ["학교", "교에", "에서", "공부"]);
        assert_eq!(texts("2026年3月"), ["2026", "年", "3", "月"]);
    }

    #[test]
    fn other_text_tokenizes_like_the_simple_tokenizer() {
        let text = "Hello 🌱 garden\r\nF-31 ERR_TLS_412 café naïve Fahrräder مرحبا بالعالم";
        assert_eq!(
            run(SbTokenizer::default(), text),
            run(SimpleTokenizer::default(), text)
        );
    }

    #[test]
    fn offsets_slice_back_to_the_token() {
        let text = "我们在东京塔看夜景，然后去吃拉面。iPhone用";
        for (t, _, from, to) in run(SbTokenizer::default(), text) {
            assert_eq!(&text[from..to], t);
        }
    }
}
