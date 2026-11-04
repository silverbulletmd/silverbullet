//! Space files over [`SpaceApi`]: read, write with the script-reload
//! decision, edit and page listing.

use http::{header, Method, StatusCode};
use serde_json::Value;

use super::{SpaceApi, SpaceRequest, SpaceResponse};
use crate::edit::{self, Edit, EditError, EditOpts};
use crate::page_text::{has_scripts, needs_reload};
use crate::paths::{fs_url, path_to_page};

const REVISION_HEADER: &str = "x-silverbullet-revision";

/// A file as `GET /.fs/<path>` returns it.
pub struct File {
    pub bytes: Vec<u8>,
    /// Empty when the server sent none.
    pub revision: String,
    pub content_type: String,
}

#[derive(Debug)]
pub enum FileError {
    NotFound,
    /// A write over revision `expected` was refused; `current` is the
    /// file's revision now.
    Conflict {
        expected: String,
        current: Option<String>,
    },
    /// Any other answer the request was not meant to get.
    Status {
        status: StatusCode,
        body: String,
    },
    /// The answer could not be read.
    Invalid(String),
    /// The request could not be sent.
    Transport(String),
}

fn revision_of(response: &SpaceResponse) -> String {
    response
        .headers
        .get(REVISION_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}

fn status_error(response: SpaceResponse) -> FileError {
    FileError::Status {
        status: response.status,
        body: String::from_utf8_lossy(&response.body).into_owned(),
    }
}

async fn send(
    api: &dyn SpaceApi,
    method: Method,
    path_and_query: String,
    body: Vec<u8>,
    headers: Vec<(http::HeaderName, String)>,
) -> Result<SpaceResponse, FileError> {
    api.send(SpaceRequest {
        method,
        path_and_query,
        body,
        headers,
    })
    .await
    .map_err(FileError::Transport)
}

pub async fn read_file(api: &dyn SpaceApi, path: &str) -> Result<File, FileError> {
    let response = send(api, Method::GET, fs_url(path), Vec::new(), Vec::new()).await?;
    match response.status {
        StatusCode::OK => Ok(File {
            revision: revision_of(&response),
            content_type: response
                .headers
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_owned(),
            bytes: response.body,
        }),
        StatusCode::NOT_FOUND => Err(FileError::NotFound),
        _ => Err(status_error(response)),
    }
}

/// PUTs `body` to `path`, only over revision `if_match` when given, and
/// returns the new revision.
pub async fn put_file(
    api: &dyn SpaceApi,
    path: &str,
    body: Vec<u8>,
    if_match: Option<&str>,
) -> Result<String, FileError> {
    let content_type = if path.ends_with(".md") {
        "text/markdown"
    } else {
        "text/plain"
    };
    let mut headers = vec![(header::CONTENT_TYPE, content_type.to_owned())];
    if let Some(revision) = if_match {
        headers.push((header::IF_MATCH, revision.to_owned()));
    }
    let response = send(api, Method::PUT, fs_url(path), body, headers).await?;
    match response.status {
        StatusCode::OK => Ok(revision_of(&response)),
        StatusCode::PRECONDITION_FAILED => Err(FileError::Conflict {
            expected: if_match.unwrap_or_default().to_owned(),
            current: Some(revision_of(&response)).filter(|c| !c.is_empty()),
        }),
        _ => Err(status_error(response)),
    }
}

pub struct Written {
    pub revision: String,
    /// The write added, changed or removed Space Lua or Space Style, so the
    /// space's scripts need a reload ([`super::reload_after_write`]).
    pub scripts: bool,
}

/// Writes `content` to `path`, only over revision `if_match` when given.
pub async fn write_page(
    api: &dyn SpaceApi,
    path: &str,
    content: &str,
    if_match: Option<&str>,
) -> Result<Written, FileError> {
    // The old text only matters when the new one has no scripts; a page that
    // cannot be read is judged by its new text.
    let old = if path.ends_with(".md") && !has_scripts(content) {
        read_file(api, path)
            .await
            .ok()
            .map(|file| String::from_utf8_lossy(&file.bytes).into_owned())
    } else {
        None
    };
    let scripts = needs_reload(path, old.as_deref(), content);
    let revision = put_file(api, path, content.as_bytes().to_vec(), if_match).await?;
    Ok(Written { revision, scripts })
}

#[derive(Debug)]
pub enum EditPageError {
    Read(FileError),
    NotUtf8,
    Edit(EditError),
    Write(FileError),
}

pub struct Edited {
    /// The page before and after the edits, with `\n` line endings, for a diff.
    pub before: String,
    pub after: String,
    pub read_revision: String,
    /// `None` for a dry run.
    pub written: Option<Written>,
}

/// Applies `edits` to the page at `path` (see [`edit::apply`]) and, unless
/// `dry_run`, writes it over `if_revision`, or else over the revision it was
/// read at.
pub async fn edit_page(
    api: &dyn SpaceApi,
    path: &str,
    edits: &[Edit],
    opts: EditOpts,
    if_revision: Option<&str>,
    dry_run: bool,
) -> Result<Edited, EditPageError> {
    let file = read_file(api, path).await.map_err(EditPageError::Read)?;
    let Ok(original) = String::from_utf8(file.bytes) else {
        return Err(EditPageError::NotUtf8);
    };
    let after = edit::apply(&original, edits, opts)
        .map_err(EditPageError::Edit)?
        .content;
    let mut edited = Edited {
        before: original.replace("\r\n", "\n"),
        after: after.replace("\r\n", "\n"),
        read_revision: file.revision,
        written: None,
    };
    if dry_run {
        return Ok(edited);
    }
    let if_match = if_revision.or(Some(edited.read_revision.as_str()).filter(|r| !r.is_empty()));
    let revision = put_file(api, path, after.into_bytes(), if_match)
        .await
        .map_err(EditPageError::Write)?;
    edited.written = Some(Written {
        revision,
        scripts: needs_reload(path, Some(&edited.before), &edited.after),
    });
    Ok(edited)
}

/// The pages under `prefix` (a folder ending in "/", or "" for all), sorted,
/// leaving out hidden ones.
pub async fn list_pages(api: &dyn SpaceApi, prefix: &str) -> Result<Vec<String>, FileError> {
    let response = send(api, Method::GET, "/.fs".into(), Vec::new(), Vec::new()).await?;
    if response.status != StatusCode::OK {
        return Err(status_error(response));
    }
    let files: Vec<Value> =
        serde_json::from_slice(&response.body).map_err(|e| FileError::Invalid(e.to_string()))?;
    let mut pages: Vec<String> = files
        .iter()
        .filter_map(|file| {
            let name = file.get("name")?.as_str()?;
            if !name.ends_with(".md")
                || !name.starts_with(prefix)
                || name.split('/').any(|c| c.starts_with('.'))
            {
                return None;
            }
            Some(path_to_page(name))
        })
        .collect();
    pages.sort();
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use async_trait::async_trait;
    use http::HeaderMap;

    use super::*;

    /// One file in memory, with a revision per content.
    struct OneFile {
        content: Mutex<Option<Vec<u8>>>,
        puts: Mutex<Vec<Option<String>>>,
    }

    impl OneFile {
        fn new(content: &str) -> Self {
            Self {
                content: Mutex::new(Some(content.as_bytes().to_vec())),
                puts: Mutex::new(Vec::new()),
            }
        }

        fn text(&self) -> String {
            String::from_utf8(self.content.lock().unwrap().clone().unwrap()).unwrap()
        }
    }

    fn with_bytes(bytes: Option<Vec<u8>>) -> OneFile {
        OneFile {
            content: Mutex::new(bytes),
            puts: Mutex::new(Vec::new()),
        }
    }

    fn revision(bytes: &[u8]) -> String {
        format!("\"r{}\"", bytes.len())
    }

    #[async_trait]
    impl SpaceApi for OneFile {
        async fn send(&self, req: SpaceRequest) -> Result<SpaceResponse, String> {
            let mut headers = HeaderMap::new();
            let mut content = self.content.lock().unwrap();
            let status = match req.method {
                Method::GET => match content.as_ref() {
                    Some(bytes) => {
                        headers.insert(REVISION_HEADER, revision(bytes).parse().unwrap());
                        StatusCode::OK
                    }
                    None => StatusCode::NOT_FOUND,
                },
                _ => {
                    let if_match = req
                        .headers
                        .iter()
                        .find(|(name, _)| *name == header::IF_MATCH)
                        .map(|(_, value)| value.clone());
                    self.puts.lock().unwrap().push(if_match.clone());
                    let current = content.as_deref().map(revision);
                    if if_match.is_some() && if_match != current {
                        StatusCode::PRECONDITION_FAILED
                    } else {
                        headers.insert(REVISION_HEADER, revision(&req.body).parse().unwrap());
                        *content = Some(req.body.clone());
                        StatusCode::OK
                    }
                }
            };
            let body = match req.method {
                Method::GET => content.clone().unwrap_or_default(),
                _ => Vec::new(),
            };
            Ok(SpaceResponse {
                status,
                headers,
                body,
            })
        }
    }

    const OPTS: EditOpts = EditOpts {
        all: false,
        old_text: "oldText",
    };

    fn edit(old: &str, new: &str) -> Edit {
        Edit {
            old: old.into(),
            new: new.into(),
        }
    }

    #[tokio::test]
    async fn edits_locate_against_the_original_and_write_over_the_read_revision() {
        let api = OneFile::new("alpha\r\nbeta\r\n");
        let edited = edit_page(
            &api,
            "Doc.md",
            &[edit("alpha\nbeta", "A\nB"), edit("beta\n", "B\n")],
            OPTS,
            None,
            false,
        )
        .await;
        assert!(
            matches!(edited, Err(EditPageError::Edit(e)) if e.message == "edits 1 and 2 overlap. Nothing was changed.")
        );

        let edited = edit_page(&api, "Doc.md", &[edit("alpha", "A")], OPTS, None, false)
            .await
            .unwrap();
        assert_eq!(edited.after, "A\nbeta\n");
        assert_eq!(api.text(), "A\r\nbeta\r\n");
        assert_eq!(
            *api.puts.lock().unwrap(),
            [Some(revision(b"alpha\r\nbeta\r\n"))]
        );
        assert!(!edited.written.unwrap().scripts);
    }

    #[tokio::test]
    async fn if_revision_replaces_the_read_revision() {
        let api = OneFile::new("a\n");
        let error = edit_page(
            &api,
            "Doc.md",
            &[edit("a", "b")],
            OPTS,
            Some("\"r9\""),
            false,
        )
        .await
        .err()
        .unwrap();
        assert!(matches!(
            error,
            EditPageError::Write(FileError::Conflict { expected, .. }) if expected == "\"r9\""
        ));
        assert_eq!(*api.puts.lock().unwrap(), [Some("\"r9\"".to_owned())]);
        assert_eq!(api.text(), "a\n");
    }

    #[tokio::test]
    async fn missing_and_binary_pages_are_not_edited() {
        let missing = with_bytes(None);
        let error = edit_page(&missing, "Doc.md", &[edit("a", "b")], OPTS, None, false).await;
        assert!(matches!(
            error,
            Err(EditPageError::Read(FileError::NotFound))
        ));
        assert!(matches!(
            read_file(&missing, "Doc.md").await,
            Err(FileError::NotFound)
        ));

        let binary = with_bytes(Some(vec![b'a', 0xff]));
        let error = edit_page(&binary, "Doc.md", &[edit("a", "b")], OPTS, None, false).await;
        assert!(matches!(error, Err(EditPageError::NotUtf8)));
        assert!(binary.puts.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn dry_runs_write_nothing() {
        let api = OneFile::new("a\n");
        let edited = edit_page(&api, "Doc.md", &[edit("a", "b")], OPTS, None, true)
            .await
            .unwrap();
        assert_eq!(
            (edited.before.as_str(), edited.after.as_str()),
            ("a\n", "b\n")
        );
        assert!(edited.written.is_none());
        assert!(api.puts.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn removing_a_script_needs_a_reload() {
        let api = OneFile::new("```space-lua\nx = 1\n```\n");
        let written = write_page(&api, "Tools.md", "plain", None).await.unwrap();
        assert!(written.scripts);
        let written = write_page(&api, "Tools.md", "still plain", None)
            .await
            .unwrap();
        assert!(!written.scripts);
    }

    #[tokio::test]
    async fn a_stale_revision_is_a_conflict() {
        let api = OneFile::new("a");
        let error = write_page(&api, "Doc.md", "b", Some("\"old\""))
            .await
            .err()
            .unwrap();
        assert!(
            matches!(error, FileError::Conflict { expected, current: None } if expected == "\"old\"")
        );
    }
}
