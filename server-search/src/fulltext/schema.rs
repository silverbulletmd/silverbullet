//! The index model: one document per page, with raw (unstemmed) fields for
//! phrases and exact words, accent-folded copies of them, and per-language
//! stemmed fields for ranking.

use silverbullet_server_common::page::{parse_page, PageKind};
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, FAST, STORED, STRING,
};
use tantivy::TantivyDocument;

use super::analysis::{self, detect_lang, Lang};
use crate::FileStamp;

/// Name of the unstemmed analyzer (simple tokenizer + lowercase). Not "raw":
/// that is Tantivy's own whole-value tokenizer, which `STRING` fields such as
/// `path` and `lang` use, so registering over it would split paths into words.
pub const RAW_TOKENIZER: &str = "sb_raw";

/// Name of the accent-folded analyzer: [`RAW_TOKENIZER`] plus ASCII folding
/// (`żółw` → `zolw`, `ＡＢＣ` → `abc`).
pub const FOLD_TOKENIZER: &str = "sb_fold";

pub struct Fields {
    pub path: Field,
    pub name_raw: Field,
    pub body_raw: Field,
    /// The raw fields with accents folded, for matches the exact tier
    /// misses (`zolw` on `żółw`).
    pub name_fold: Field,
    pub body_fold: Field,
    pub lang: Field,
    /// [`KIND_CONTENT`] or [`KIND_META`], by the page's tags.
    pub kind: Field,
    pub modified: Field,
    pub size: Field,
    /// Per language, indexed by [`Lang::idx`].
    pub name_stem: [Field; Lang::COUNT],
    pub body_stem: [Field; Lang::COUNT],
}

fn text_options(tokenizer: &str, record: IndexRecordOption) -> TextOptions {
    TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer(tokenizer)
            .set_index_option(record),
    )
}

pub fn schema() -> (Schema, Fields) {
    let mut b = Schema::builder();
    let path = b.add_text_field("path", STRING | STORED);
    let positions = IndexRecordOption::WithFreqsAndPositions;
    let name_raw = b.add_text_field("name_raw", text_options(RAW_TOKENIZER, positions));
    let body_raw = b.add_text_field("body_raw", text_options(RAW_TOKENIZER, positions));
    let name_fold = b.add_text_field("name_fold", text_options(FOLD_TOKENIZER, positions));
    let body_fold = b.add_text_field("body_fold", text_options(FOLD_TOKENIZER, positions));
    let lang = b.add_text_field("lang", STRING | STORED);
    let kind = b.add_text_field("kind", STRING);
    let modified = b.add_i64_field("modified", STORED | FAST);
    let size = b.add_u64_field("size", STORED | FAST);
    let mut stem = |prefix: &str| {
        Lang::ALL.map(|l| {
            let opts = text_options(
                &analysis::stem_tokenizer_name(l),
                IndexRecordOption::WithFreqs,
            );
            b.add_text_field(&format!("{prefix}_{}", l.code()), opts)
        })
    };
    let name_stem = stem("name");
    let body_stem = stem("body");
    (
        b.build(),
        Fields {
            path,
            name_raw,
            body_raw,
            name_fold,
            body_fold,
            lang,
            kind,
            modified,
            size,
            name_stem,
            body_stem,
        },
    )
}

/// `kind` of a page tagged `meta`, `meta/…` or `template`.
pub const KIND_META: &str = "meta";
/// `kind` of every other page.
pub const KIND_CONTENT: &str = "content";

/// The `kind` value of a page with this text, by the classifier the server
/// shares with SEO and the bundle.
pub fn page_kind(text: &str) -> &'static str {
    match parse_page(text).metadata.kind() {
        PageKind::Meta => KIND_META,
        PageKind::Content => KIND_CONTENT,
    }
}

/// The document for one page. Its name is the path without `.md`; the body
/// goes into the raw field and into the stemmed field of its detected language.
pub fn document(fields: &Fields, path: &str, text: &str, stamp: FileStamp) -> TantivyDocument {
    let name = path.strip_suffix(".md").unwrap_or(path);
    let lang = detect_lang(text);
    let mut doc = TantivyDocument::default();
    doc.add_text(fields.path, path);
    doc.add_text(fields.name_raw, name);
    doc.add_text(fields.body_raw, text);
    doc.add_text(fields.name_fold, name);
    doc.add_text(fields.body_fold, text);
    doc.add_text(fields.lang, lang.code());
    doc.add_text(fields.kind, page_kind(text));
    doc.add_i64(fields.modified, stamp.modified);
    doc.add_u64(fields.size, stamp.size);
    doc.add_text(fields.name_stem[lang.idx()], name);
    doc.add_text(fields.body_stem[lang.idx()], text);
    doc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fulltext::analysis::register_tokenizers;
    use tantivy::collector::TopDocs;
    use tantivy::query::AllQuery;
    use tantivy::schema::Value;
    use tantivy::{Index, IndexWriter};

    #[test]
    fn schema_round_trip() {
        let (schema, f) = schema();
        let index = Index::create_in_ram(schema);
        register_tokenizers(&index);
        let mut w: IndexWriter = index.writer_with_num_threads(1, 15_000_000).unwrap();
        let stamp = FileStamp {
            modified: 1_700_000_000_123,
            size: 42,
        };
        w.add_document(document(
            &f,
            "Notes/Garden.md",
            "The tomatoes are red",
            stamp,
        ))
        .unwrap();
        w.commit().unwrap();
        let searcher = index.reader().unwrap().searcher();
        let hits = searcher
            .search(&AllQuery, &TopDocs::with_limit(5).order_by_score())
            .unwrap();
        assert_eq!(hits.len(), 1);
        let doc: TantivyDocument = searcher.doc(hits[0].1).unwrap();
        assert_eq!(
            doc.get_first(f.path).unwrap().as_str(),
            Some("Notes/Garden.md")
        );
        assert_eq!(
            doc.get_first(f.modified).unwrap().as_i64(),
            Some(1_700_000_000_123)
        );
        assert_eq!(doc.get_first(f.size).unwrap().as_u64(), Some(42));
        let lang = doc.get_first(f.lang).unwrap().as_str().unwrap();
        assert_eq!(Lang::from_code(lang), Some(Lang::En));
    }

    #[test]
    fn document_name_drops_extension() {
        let (_, f) = schema();
        let stamp = FileStamp {
            modified: 0,
            size: 0,
        };
        let doc = document(&f, "Notes/Garden.md", "x", stamp);
        assert_eq!(
            doc.get_first(f.name_raw).unwrap().as_str(),
            Some("Notes/Garden")
        );
        let kind = |text: &str| {
            let doc = document(&f, "Notes/Garden.md", text, stamp);
            doc.get_first(f.kind).unwrap().as_str().unwrap().to_string()
        };
        assert_eq!(kind("x"), KIND_CONTENT);
        assert_eq!(kind("#meta/config\n"), KIND_META);
        assert_eq!(kind("---\ntags: template\n---\nWeekly"), KIND_META);
        assert_eq!(kind("Body with #meta inline"), KIND_CONTENT);
    }
}
