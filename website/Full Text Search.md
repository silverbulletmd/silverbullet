While, honestly not amazing, SilverBullet does have full-text search support.

To use it, run the {[Search Space]} command.

## Content indexing
The pages are searched by full words (as separated by non-letter characters), except Chinese ideograms which are treated each as a separate word. Any other text is normalized to be case-insensitive and various forms (like “word”/“words”) brought together using [Porter Stemming Algorithm](https://tartarus.org/martin/PorterStemmer/).

What constitutes a “Chinese ideogram” is any character of the [Han script in Unicode](https://unicode.org/iso15924/iso15924-codes.html), which includes Chinese Hanzi, Japanese Kanji and Korean Hanja.