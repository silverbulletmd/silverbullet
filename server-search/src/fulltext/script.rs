//! Script predicates the analyzers and query validation share.

/// Whether `c` belongs to Chinese, Japanese or Korean script: Han
/// ideographs, kana, Hangul, and the CJK iteration marks.
pub fn is_cjk(c: char) -> bool {
    matches!(
        c,
        '\u{1100}'..='\u{11FF}'
            | '\u{3005}'..='\u{3007}'
            | '\u{3040}'..='\u{309F}'
            | '\u{30A0}'..='\u{30FF}'
            | '\u{3130}'..='\u{318F}'
            | '\u{31F0}'..='\u{31FF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{4E00}'..='\u{9FFF}'
            | '\u{A960}'..='\u{A97F}'
            | '\u{AC00}'..='\u{D7FF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{FF66}'..='\u{FF9F}'
            | '\u{20000}'..='\u{2FA1F}'
            | '\u{30000}'..='\u{3134F}'
    )
}

/// Whether `c` is a CJK letter or digit, not a CJK punctuation mark or
/// symbol (`・`, `゛`).
pub fn is_cjk_letter(c: char) -> bool {
    c.is_alphanumeric() && is_cjk(c)
}

/// Whether ASCII folding may change `c`: the blocks Tantivy's
/// `AsciiFoldingFilter` maps characters from (Latin-1 Supplement through
/// IPA and spacing modifiers, phonetic extensions, Latin Extended
/// Additional, C and D, sub- and superscripts, number forms, enclosed and
/// dingbat numbers, ligatures, fullwidth forms). A token without such a
/// character, Arabic, Cyrillic or Greek say, folds to itself.
pub fn may_fold(c: char) -> bool {
    matches!(
        c,
        '\u{0080}'..='\u{02FF}'
            | '\u{1D00}'..='\u{1EFF}'
            | '\u{2000}'..='\u{21FF}'
            | '\u{2400}'..='\u{24FF}'
            | '\u{2700}'..='\u{27FF}'
            | '\u{2C00}'..='\u{2C7F}'
            | '\u{2E00}'..='\u{2E7F}'
            | '\u{A700}'..='\u{A7FF}'
            | '\u{FB00}'..='\u{FB7F}'
            | '\u{FF00}'..='\u{FF7F}'
    )
}

/// Whether `c` is in one of the Arabic script's blocks.
pub fn is_arabic(c: char) -> bool {
    matches!(
        c,
        '\u{0600}'..='\u{06FF}'
            | '\u{0750}'..='\u{077F}'
            | '\u{08A0}'..='\u{08FF}'
            | '\u{FB50}'..='\u{FDFF}'
            | '\u{FE70}'..='\u{FEFF}'
    )
}
