use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};

/// Upper bound on the text a single tool result carries.
pub const MAX_RESULT_BYTES: usize = 100_000;

const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// Maps a page name to its file path in the space. Names without a file
/// extension are Markdown pages; others (`img/a.png`) are documents as is,
/// by the client's rule, so "Notes v1.2" is a document too.
pub fn page_to_path(page: &str) -> Result<String, String> {
    if page.is_empty() {
        return Err("page must not be empty".into());
    }
    if page.starts_with('/') {
        return Err(format!("page \"{page}\" must not start with \"/\""));
    }
    for component in page.split('/') {
        if component.is_empty() {
            return Err(format!("page \"{page}\" has an empty path component"));
        }
        if component.starts_with('.') {
            return Err(format!(
                "page \"{page}\" has a component starting with \".\" (\"..\" and hidden names are refused)"
            ));
        }
        if component.contains('\\') || component.chars().any(char::is_control) {
            return Err(format!("page \"{page}\" contains an invalid character"));
        }
    }
    if ends_in_extension(page) {
        Ok(page.to_owned())
    } else {
        Ok(format!("{page}.md"))
    }
}

pub fn path_to_page(path: &str) -> String {
    path.strip_suffix(".md").unwrap_or(path).to_owned()
}

/// Request path for `/.fs/<path>`, percent-encoding each segment.
pub fn fs_url(path: &str) -> String {
    let encoded: Vec<String> = path
        .split('/')
        .map(|segment| utf8_percent_encode(segment, SEGMENT).to_string())
        .collect();
    format!("/.fs/{}", encoded.join("/"))
}

/// Whether `name` (without a trailing `.md`) is a page SilverBullet shows,
/// never a document or attachment, which a host would hand to the OS. The
/// rule is spelled out in `tests/fixtures/page_names.json`, which this and the
/// TypeScript copy (`isPageName` in Desktop's `editor-adapter.ts`) are both
/// tested against.
pub fn is_page_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('^')
        && !name.contains(['@', '#', '|', '<', '>', '$', '\\'])
        && !name.contains("[[")
        && !name.contains("]]")
        && name
            .split('/')
            .all(|segment| !segment.is_empty() && !segment.starts_with('.'))
        && !ends_in_extension(name)
}

/// Port of `endsInExtension` in `plug-api/lib/ref.ts`: a dot after the first
/// character followed by one or more ASCII alphanumerics up to the end.
fn ends_in_extension(path: &str) -> bool {
    match path.rfind('.') {
        Some(dot) if dot >= 1 && dot < path.len() - 1 => {
            path[dot + 1..].bytes().all(|b| b.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_names_match_the_shared_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/page_names.json")).unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(cases.len() > 20);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            assert_eq!(
                is_page_name(name),
                case["page"].as_bool().unwrap(),
                "{name:?}"
            );
        }
    }

    #[test]
    fn pages_get_md_extension() {
        assert_eq!(
            page_to_path("Projects/Garden Plan").unwrap(),
            "Projects/Garden Plan.md"
        );
        assert_eq!(page_to_path("notes.md").unwrap(), "notes.md");
        assert_eq!(
            page_to_path("v1.2 notes/Plan").unwrap(),
            "v1.2 notes/Plan.md"
        );
        assert_eq!(page_to_path("Done.").unwrap(), "Done..md");
        assert_eq!(
            page_to_path("Plan v1.final-draft").unwrap(),
            "Plan v1.final-draft.md"
        );
        assert_eq!(page_to_path("Café.é").unwrap(), "Café.é.md");
    }

    #[test]
    fn other_extensions_are_documents() {
        assert_eq!(page_to_path("img/a.png").unwrap(), "img/a.png");
        // As in the client's `endsInExtension`: any alphanumeric suffix.
        assert_eq!(page_to_path("Notes v1.2").unwrap(), "Notes v1.2");
        assert_eq!(page_to_path("Plan v1.final").unwrap(), "Plan v1.final");
        assert_eq!(page_to_path("archive.tar.gz").unwrap(), "archive.tar.gz");
    }

    #[test]
    fn unicode_is_kept() {
        assert_eq!(page_to_path("Café/Menü").unwrap(), "Café/Menü.md");
    }

    #[test]
    fn unsafe_names_are_refused() {
        for bad in [
            "",
            "/abs",
            "../x",
            "a/../b",
            "a/./b",
            ".hidden",
            "a/.hidden",
            "a//b",
            "a/",
            "a\\b",
        ] {
            assert!(page_to_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn path_to_page_strips_md_only() {
        assert_eq!(path_to_page("a/b.md"), "a/b");
        assert_eq!(path_to_page("img/a.png"), "img/a.png");
    }

    #[test]
    fn fs_url_encodes_segments() {
        assert_eq!(fs_url("a b/Café#1?.md"), "/.fs/a%20b/Caf%C3%A9%231%3F.md");
    }
}
