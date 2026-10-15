//! The semantic index on disk: `<space dir>/semantic-v1/<model-id>.bin`.
//!
//! Layout: [`MAGIC`], a u64 LE metadata length, JSON metadata (model,
//! revision, dim, and per page its stamp and chunks without vectors), then
//! every chunk vector as raw f32 LE, in metadata order. The file is bound to
//! its model: another id, revision or dimension is [`StoreError::Mismatch`].
//! The metadata also says whether the index is `complete` (its first build
//! finished); a file without the field, written before it existed, is.

use std::fs;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::catalog::ModelSpec;
use super::fs_private;
use super::index::{Chunk, Page, VectorIndex};
use crate::FileStamp;

pub const SCHEMA_DIR: &str = crate::layout::SEMANTIC_SCHEMA_DIR;
pub const MAGIC: &[u8; 8] = b"SBIDX003";
/// Larger files are refused (and rebuilt).
pub const MAX_INDEX_BYTES: u64 = 2 << 30;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub model: String,
    pub revision: String,
    pub dim: usize,
}

impl Header {
    pub fn of(spec: &ModelSpec) -> Header {
        Header {
            model: spec.id.to_string(),
            revision: spec.revision.to_string(),
            dim: spec.dim,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("the index belongs to another model")]
    Mismatch,
    #[error("the index file is damaged: {0}")]
    Corrupt(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

#[derive(Serialize, Deserialize)]
struct Meta {
    model: String,
    revision: String,
    dim: usize,
    /// The first build finished; `false` for a checkpoint taken during it.
    #[serde(default = "complete_by_default")]
    complete: bool,
    pages: Vec<MetaPage>,
}

/// Files written before the flag existed came from a finished build (or are
/// rebuilt anyway).
fn complete_by_default() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
struct MetaPage {
    path: String,
    modified: i64,
    size: u64,
    chunks: Vec<MetaChunk>,
}

#[derive(Serialize, Deserialize)]
struct MetaChunk {
    start: u32,
    len: u32,
    pos: u32,
    line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    heading: Option<String>,
    hash: String,
}

pub fn file_path(space_dir: &Path, spec: &ModelSpec) -> PathBuf {
    space_dir.join(SCHEMA_DIR).join(format!("{}.bin", spec.id))
}

fn hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

fn corrupt(why: impl Into<String>) -> StoreError {
    StoreError::Corrupt(why.into())
}

/// Writes `index` atomically, recording whether it is `complete`:
/// `<path>.partial` (0600), fsync, rename.
pub fn save_state(
    path: &Path,
    header: &Header,
    index: &VectorIndex,
    complete: bool,
) -> Result<(), StoreError> {
    let dir = path
        .parent()
        .ok_or_else(|| corrupt("no parent directory"))?;
    fs_private::create_dir(dir)?;
    let mut pages: Vec<(&str, &Page)> = index.iter().collect();
    pages.sort_by(|a, b| a.0.cmp(b.0));
    let meta = Meta {
        model: header.model.clone(),
        revision: header.revision.clone(),
        dim: header.dim,
        complete,
        pages: pages
            .iter()
            .map(|(path, page)| MetaPage {
                path: path.to_string(),
                modified: page.stamp.modified,
                size: page.stamp.size,
                chunks: page
                    .chunks
                    .iter()
                    .map(|c| MetaChunk {
                        start: c.start,
                        len: c.len,
                        pos: c.pos,
                        line: c.line,
                        heading: c.heading.clone(),
                        hash: hex(&c.hash),
                    })
                    .collect(),
            })
            .collect(),
    };
    if pages
        .iter()
        .flat_map(|(_, p)| &p.chunks)
        .any(|c| c.vector.len() != header.dim)
    {
        return Err(corrupt(
            "a chunk vector does not match the header dimension",
        ));
    }
    let json = serde_json::to_vec(&meta).map_err(|e| corrupt(e.to_string()))?;
    let partial = path.with_extension("bin.partial");
    let file = fs_private::open(&partial, true)?;
    let mut out = BufWriter::with_capacity(64 * 1024, file);
    out.write_all(MAGIC)?;
    out.write_all(&(json.len() as u64).to_le_bytes())?;
    out.write_all(&json)?;
    for (_, page) in &pages {
        for chunk in &page.chunks {
            for value in &chunk.vector {
                out.write_all(&value.to_le_bytes())?;
            }
        }
    }
    let file = out
        .into_inner()
        .map_err(|e| StoreError::Io(e.into_error()))?;
    file.sync_all()?;
    drop(file);
    fs::rename(&partial, path)?;
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

/// Reads the index of `expect`'s model from `path`, with whether it is
/// complete.
pub fn load_state(path: &Path, expect: &Header) -> Result<(VectorIndex, bool), StoreError> {
    let size = fs::metadata(path)?.len();
    if size > MAX_INDEX_BYTES {
        return Err(corrupt(format!("{size} bytes is over the limit")));
    }
    let bytes = fs::read(path)?;
    if bytes.len() < 16 || &bytes[..8] != MAGIC {
        return Err(corrupt("unknown format"));
    }
    let meta_len = u64::from_le_bytes(bytes[8..16].try_into().expect("8 bytes"));
    let meta_end = 16u64
        .checked_add(meta_len)
        .filter(|end| *end <= bytes.len() as u64)
        .ok_or_else(|| corrupt("metadata past the end"))? as usize;
    let meta: Meta =
        serde_json::from_slice(&bytes[16..meta_end]).map_err(|e| corrupt(e.to_string()))?;
    if meta.model != expect.model || meta.revision != expect.revision || meta.dim != expect.dim {
        return Err(StoreError::Mismatch);
    }
    let chunks: usize = meta.pages.iter().map(|p| p.chunks.len()).sum();
    let want = chunks
        .checked_mul(meta.dim)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| corrupt("too many vectors"))?;
    let mut floats = &bytes[meta_end..];
    if floats.len() != want {
        return Err(corrupt(format!(
            "{} vector bytes, expected {want}",
            floats.len()
        )));
    }
    let mut index = VectorIndex::new(meta.dim);
    for page in meta.pages {
        let mut out = Vec::with_capacity(page.chunks.len());
        for c in page.chunks {
            let (raw, rest) = floats.split_at(meta.dim * 4);
            floats = rest;
            let vector: Vec<f32> = raw
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().expect("4 bytes")))
                .collect();
            if !vector.iter().all(|v| v.is_finite()) {
                return Err(corrupt("a vector is not finite"));
            }
            let hash = unhex(&c.hash).ok_or_else(|| corrupt("bad chunk hash"))?;
            out.push(Chunk {
                start: c.start,
                len: c.len,
                pos: c.pos,
                line: c.line,
                heading: c.heading,
                hash,
                vector,
            });
        }
        let stamp = FileStamp {
            modified: page.modified,
            size: page.size,
        };
        index.insert(page.path, Page::new(stamp, out));
    }
    Ok((index, meta.complete))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::index::{Chunk, Page};
    use crate::FileStamp;

    fn header() -> Header {
        Header {
            model: "test-model".into(),
            revision: "r1".into(),
            dim: 3,
        }
    }

    fn sample() -> VectorIndex {
        let mut index = VectorIndex::new(3);
        let chunk = |start: u32, v: [f32; 3], heading: Option<&str>| Chunk {
            start,
            len: 4,
            pos: start,
            line: 2,
            heading: heading.map(String::from),
            hash: [start as u8 + 1; 32],
            vector: v.to_vec(),
        };
        let stamp = FileStamp {
            modified: 1_700_000_000_123,
            size: 42,
        };
        index.insert(
            "Garden/Basil.md".into(),
            Page::new(
                stamp,
                vec![
                    chunk(0, [0.6, 0.8, 0.0], Some("Basil")),
                    chunk(9, [f32::MIN_POSITIVE, 1.0, -0.0], None),
                ],
            ),
        );
        index.insert("Empty.md".into(), Page::new(stamp, vec![]));
        index
    }

    fn same(a: &VectorIndex, b: &VectorIndex) {
        assert_eq!(a.len(), b.len());
        for (path, page) in a.iter() {
            let other = b.get(path).unwrap();
            assert_eq!(page.stamp, other.stamp);
            assert_eq!(page.chunks.len(), other.chunks.len());
            for (x, y) in page.chunks.iter().zip(&other.chunks) {
                assert_eq!(
                    (x.start, x.len, x.pos, x.line, &x.heading, x.hash),
                    (y.start, y.len, y.pos, y.line, &y.heading, y.hash)
                );
                let bits = |v: &[f32]| v.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
                assert_eq!(bits(&x.vector), bits(&y.vector), "float bits survive");
            }
        }
    }

    #[test]
    fn round_trip_keeps_every_bit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("semantic-v1/test-model.bin");
        save_state(&path, &header(), &sample(), true).unwrap();
        same(&load_state(&path, &header()).unwrap().0, &sample());
    }

    #[test]
    fn completion_is_recorded_and_older_files_count_as_complete() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        for complete in [false, true] {
            save_state(&path, &header(), &sample(), complete).unwrap();
            let (index, loaded) = load_state(&path, &header()).unwrap();
            same(&index, &sample());
            assert_eq!(loaded, complete);
        }
        // A file written before the flag existed: no `complete` field.
        let bytes = std::fs::read(&path).unwrap();
        let len = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize;
        let meta = std::str::from_utf8(&bytes[16..16 + len]).unwrap();
        let old = meta.replace(r#""complete":true,"#, "");
        assert_ne!(old, meta);
        let mut file = bytes[..8].to_vec();
        file.extend((old.len() as u64).to_le_bytes());
        file.extend(old.as_bytes());
        file.extend(&bytes[16 + len..]);
        std::fs::write(&path, file).unwrap();
        let (index, loaded) = load_state(&path, &header()).unwrap();
        same(&index, &sample());
        assert!(loaded, "older files are complete");
    }

    #[test]
    fn another_model_revision_or_dimension_is_a_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        save_state(&path, &header(), &sample(), true).unwrap();
        for other in [
            Header {
                model: "other".into(),
                ..header()
            },
            Header {
                revision: "r2".into(),
                ..header()
            },
            Header { dim: 4, ..header() },
        ] {
            assert!(
                matches!(load_state(&path, &other), Err(StoreError::Mismatch)),
                "{other:?}"
            );
        }
    }

    #[test]
    fn damaged_files_are_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        save_state(&path, &header(), &sample(), true).unwrap();
        let good = std::fs::read(&path).unwrap();
        let check = |bytes: Vec<u8>, what: &str| {
            std::fs::write(&path, bytes).unwrap();
            assert!(
                matches!(load_state(&path, &header()), Err(StoreError::Corrupt(_))),
                "{what}"
            );
        };
        check(good[..good.len() - 1].to_vec(), "truncated vectors");
        check([good.clone(), vec![0]].concat(), "trailing bytes");
        let mut magic = good.clone();
        magic[7] = b'2';
        check(magic, "old magic");
        let mut long = good.clone();
        long[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
        check(long, "metadata length past the end");
        let mut nan = good.clone();
        let at = nan.len() - 4;
        nan[at..].copy_from_slice(&f32::NAN.to_le_bytes());
        check(nan, "NaN vector");
        check(b"SBIDX003".to_vec(), "no length");
    }

    #[test]
    fn a_leftover_partial_does_not_hide_the_saved_index() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        save_state(&path, &header(), &sample(), true).unwrap();
        std::fs::write(dir.path().join("i.bin.partial"), b"half a save").unwrap();
        same(&load_state(&path, &header()).unwrap().0, &sample());
        save_state(&path, &header(), &sample(), true).unwrap();
        assert!(!dir.path().join("i.bin.partial").exists());
    }

    #[cfg(unix)]
    #[test]
    fn files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("semantic-v1/i.bin");
        save_state(&path, &header(), &sample(), true).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().unwrap()), 0o700);
    }

    #[test]
    fn the_file_sits_in_the_schema_directory_named_by_the_model() {
        let spec = crate::semantic::catalog::default_model();
        assert_eq!(
            file_path(Path::new("/data/search/indexes/notes"), spec),
            Path::new(
                "/data/search/indexes/notes/semantic-v1/granite-embedding-97m-multilingual-r2.bin"
            )
        );
        assert_eq!(Header::of(spec).dim, 384);
    }

    /// Builds a file by hand: magic, metadata length, metadata, then `tail`.
    fn raw(meta: &str, tail: &[u8]) -> Vec<u8> {
        let mut out = MAGIC.to_vec();
        out.extend((meta.len() as u64).to_le_bytes());
        out.extend(meta.as_bytes());
        out.extend(tail);
        out
    }

    fn corrupt_load(bytes: Vec<u8>, what: &str) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        std::fs::write(&path, bytes).unwrap();
        assert!(
            matches!(load_state(&path, &header()), Err(StoreError::Corrupt(_))),
            "{what}"
        );
    }

    #[test]
    fn hostile_sizes_are_rejected_before_allocating() {
        // Metadata claims a million chunks, the file carries no vectors.
        let chunk = r#"{"start":0,"len":1,"pos":0,"line":1,"hash":"00"}"#;
        let many = format!(
            r#"{{"model":"test-model","revision":"r1","dim":3,"pages":[{{"path":"a.md","modified":1,"size":1,"chunks":[{}]}}]}}"#,
            vec![chunk.replace("\"00\"", &format!("\"{}\"", "0".repeat(64))); 1000].join(",")
        );
        corrupt_load(raw(&many, &[]), "chunks without vectors");
        // A huge dimension matching nothing is a mismatch, never an allocation.
        let big = r#"{"model":"test-model","revision":"r1","dim":18446744073709551615,"pages":[]}"#;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        std::fs::write(&path, raw(big, &[])).unwrap();
        assert!(matches!(
            load_state(&path, &header()),
            Err(StoreError::Mismatch)
        ));
        // The same dimension expected: the size arithmetic must not overflow.
        let h = Header {
            dim: usize::MAX,
            ..header()
        };
        let one = r#"{"model":"test-model","revision":"r1","dim":18446744073709551615,"pages":[{"path":"a.md","modified":1,"size":1,"chunks":[{"start":0,"len":1,"pos":0,"line":1,"hash":"0000000000000000000000000000000000000000000000000000000000000000"}]}]}"#;
        std::fs::write(&path, raw(one, &[])).unwrap();
        assert!(matches!(load_state(&path, &h), Err(StoreError::Corrupt(_))));
    }

    #[test]
    fn a_file_over_the_size_limit_is_refused_unread() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_INDEX_BYTES + 1).unwrap();
        assert!(matches!(
            load_state(&path, &header()),
            Err(StoreError::Corrupt(_))
        ));
    }

    #[test]
    fn malformed_metadata_is_corrupt() {
        corrupt_load(raw("not json", &[]), "not json");
        corrupt_load(raw("{}", &[]), "missing fields");
        let bad_hash = r#"{"model":"test-model","revision":"r1","dim":3,"pages":[{"path":"a.md","modified":1,"size":1,"chunks":[{"start":0,"len":1,"pos":0,"line":1,"hash":"zz"}]}]}"#;
        corrupt_load(raw(bad_hash, &[0; 12]), "bad hash");
    }

    #[test]
    fn a_missing_file_is_an_io_error_and_an_empty_index_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("none.bin");
        assert!(matches!(
            load_state(&path, &header()),
            Err(StoreError::Io(_))
        ));
        save_state(&path, &header(), &VectorIndex::new(3), true).unwrap();
        assert_eq!(load_state(&path, &header()).unwrap().0.len(), 0);
    }

    #[test]
    fn saving_a_vector_of_the_wrong_dimension_fails_and_leaves_the_old_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("i.bin");
        save_state(&path, &header(), &sample(), true).unwrap();
        let before = std::fs::read(&path).unwrap();
        let wrong = Header { dim: 4, ..header() };
        assert!(matches!(
            save_state(&path, &wrong, &sample(), true),
            Err(StoreError::Corrupt(_))
        ));
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
}
