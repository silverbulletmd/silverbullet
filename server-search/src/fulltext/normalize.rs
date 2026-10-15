//! Arabic spelling normalization for every analyzer: alef with hamza or
//! madda (أ إ آ ٱ) becomes bare alef (ا), alef maqsura (ى) becomes yeh (ي),
//! harakat and tatweel are dropped, and, in the unstemmed fields only, teh
//! marbuta (ة) becomes heh (ه). Before stemming ة stays, because the Arabic
//! stemmer strips ة as a suffix but not ه after the article (`المكتبة` and
//! `مكتبة` stem alike, `المكتبه` doesn't). A token of only harakat or
//! tatweel is dropped.

use std::mem;

use tantivy::tokenizer::{Token, TokenFilter, TokenStream, Tokenizer};

use super::script::is_arabic;

#[derive(Clone, Copy, Debug)]
pub struct ArabicNormalizer {
    teh_marbuta: bool,
}

impl ArabicNormalizer {
    /// For the unstemmed fields.
    pub const FULL: ArabicNormalizer = ArabicNormalizer { teh_marbuta: true };
    /// Before a stemmer.
    pub const BEFORE_STEMMING: ArabicNormalizer = ArabicNormalizer { teh_marbuta: false };

    /// `c` normalized, or `None` when it is dropped.
    fn map(self, c: char) -> Option<char> {
        match c {
            'أ' | 'إ' | 'آ' | 'ٱ' => Some('ا'),
            'ى' => Some('ي'),
            'ة' if self.teh_marbuta => Some('ه'),
            '\u{0640}' | '\u{064B}'..='\u{065F}' | '\u{0670}' => None,
            c => Some(c),
        }
    }
}

impl TokenFilter for ArabicNormalizer {
    type Tokenizer<T: Tokenizer> = ArabicNormalizerFilter<T>;

    fn transform<T: Tokenizer>(self, tokenizer: T) -> ArabicNormalizerFilter<T> {
        ArabicNormalizerFilter {
            tokenizer,
            normalizer: self,
            buffer: String::new(),
        }
    }
}

#[derive(Clone)]
pub struct ArabicNormalizerFilter<T> {
    tokenizer: T,
    normalizer: ArabicNormalizer,
    buffer: String,
}

impl<T: Tokenizer> Tokenizer for ArabicNormalizerFilter<T> {
    type TokenStream<'a> = ArabicNormalizerStream<'a, T::TokenStream<'a>>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        ArabicNormalizerStream {
            tail: self.tokenizer.token_stream(text),
            normalizer: self.normalizer,
            buffer: &mut self.buffer,
        }
    }
}

pub struct ArabicNormalizerStream<'a, T> {
    tail: T,
    normalizer: ArabicNormalizer,
    buffer: &'a mut String,
}

impl<T: TokenStream> TokenStream for ArabicNormalizerStream<'_, T> {
    fn advance(&mut self) -> bool {
        while self.tail.advance() {
            let text = &self.tail.token().text;
            if !text.chars().any(is_arabic) {
                return true;
            }
            self.buffer.clear();
            let normalizer = self.normalizer;
            self.buffer
                .extend(text.chars().filter_map(|c| normalizer.map(c)));
            if self.buffer.is_empty() {
                continue;
            }
            mem::swap(&mut self.tail.token_mut().text, self.buffer);
            return true;
        }
        false
    }

    fn token(&self) -> &Token {
        self.tail.token()
    }

    fn token_mut(&mut self) -> &mut Token {
        self.tail.token_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fulltext::tokenizer::SbTokenizer;
    use tantivy::tokenizer::TextAnalyzer;

    fn run(normalizer: ArabicNormalizer, text: &str) -> Vec<(String, usize)> {
        let mut analyzer = TextAnalyzer::builder(SbTokenizer::default())
            .filter(normalizer)
            .build();
        let mut stream = analyzer.token_stream(text);
        let mut out = Vec::new();
        while let Some(t) = stream.next() {
            out.push((t.text.clone(), t.position));
        }
        out
    }

    fn texts(normalizer: ArabicNormalizer, text: &str) -> Vec<String> {
        run(normalizer, text).into_iter().map(|t| t.0).collect()
    }

    #[test]
    fn spelling_variants_normalize() {
        let text = "أحمد إبراهيم آمنة مستشفى المَكْتَبَةُ كتـــاب";
        assert_eq!(
            texts(ArabicNormalizer::FULL, text),
            ["احمد", "ابراهيم", "امنه", "مستشفي", "المكتبه", "كتاب"]
        );
        assert_eq!(
            texts(ArabicNormalizer::BEFORE_STEMMING, text),
            ["احمد", "ابراهيم", "امنة", "مستشفي", "المكتبة", "كتاب"]
        );
    }

    #[test]
    fn other_scripts_pass_through() {
        assert_eq!(
            texts(ArabicNormalizer::FULL, "Café 東京 Straße"),
            ["Café", "東京", "Straße"]
        );
    }

    #[test]
    fn tokens_of_only_marks_are_dropped() {
        assert_eq!(
            run(ArabicNormalizer::FULL, "كتاب ـــــ قلم"),
            [("كتاب".to_string(), 0), ("قلم".to_string(), 2)]
        );
    }
}
