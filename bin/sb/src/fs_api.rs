use std::{fmt, io::Read};

use reqwest::{
    blocking::Response,
    header::{HeaderMap, ETAG, IF_MATCH, IF_NONE_MATCH},
    StatusCode, Url,
};
use serde_json::{Map, Value};
use silverbullet_server_common::revision::CONTENT_REVISION_HEADER;

use crate::conn::SpaceConnection;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsError {
    pub code: &'static str,
    pub message: String,
    pub path: Option<String>,
    pub exit_code: u8,
    pub expected_revision: Option<String>,
    pub current_revision: Option<String>,
}

impl FsError {
    pub fn new(code: &'static str, message: impl Into<String>, exit_code: u8) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
            exit_code,
            expected_revision: None,
            current_revision: None,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }
}

impl fmt::Display for FsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for FsError {}

#[derive(Debug)]
pub struct FsFile {
    pub bytes: Vec<u8>,
    pub metadata: Value,
}

#[derive(Debug, Clone, Copy)]
pub enum WritePolicy<'a> {
    Create,
    Match(&'a str),
    Overwrite,
}

const MAX_ERROR_BYTES: u64 = 64 * 1024;

pub fn normalize_path(path: &str, directory: bool) -> Result<String, FsError> {
    let original = path;
    if path.is_empty() || path.starts_with('/') || path.contains('\0') || path.contains('\\') {
        return Err(invalid_path(original));
    }
    let path = path.strip_prefix("./").unwrap_or(path);
    let path = if directory {
        path.strip_suffix('/').unwrap_or(path)
    } else {
        path
    };
    if directory && (path.is_empty() || path == ".") {
        return Ok(".".to_string());
    }
    let invalid = path.is_empty()
        || path == "."
        || path.ends_with('/')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..");
    if invalid {
        return Err(invalid_path(original));
    }
    Ok(path.to_string())
}

fn invalid_path(path: &str) -> FsError {
    FsError::new(
        "invalid_path",
        "Remote paths must be space-relative and cannot contain '.', '..', NUL, empty segments, or backslashes.",
        2,
    )
    .with_path(path)
}

pub fn validate_revision(revision: &str) -> Result<(), FsError> {
    let bytes = revision.as_bytes();
    let valid = bytes.len() >= 3
        && bytes[0] == b'"'
        && bytes[bytes.len() - 1] == b'"'
        && bytes[1..bytes.len() - 1]
            .iter()
            .all(|byte| *byte == 0x21 || (0x23..=0x7e).contains(byte));
    if valid {
        Ok(())
    } else {
        Err(FsError::new(
            "invalid_revision",
            "Revision must be a strong, quoted content ETag returned by `sb fs read` or `sb fs stat`; `*` is not accepted.",
            2,
        ))
    }
}

impl SpaceConnection {
    pub fn fs_list(&self) -> Result<Vec<silverbullet_server_common::FileMeta>, FsError> {
        let url = self.fs_url(None)?;
        let response = self
            .apply_auth(self.client.get(url))
            .send()
            .map_err(transport_error)?;
        let status = response.status();
        if !status.is_success() {
            return Err(response_error(response, None, None, false));
        }
        let bytes = read_limited(response, 0, "filesystem listing")?;
        serde_json::from_slice(&bytes).map_err(|error| {
            FsError::new(
                "invalid_response",
                format!("Server returned an invalid filesystem listing: {error}"),
                8,
            )
        })
    }

    pub fn fs_read(&self, path: &str, max_bytes: u64) -> Result<FsFile, FsError> {
        let path = normalize_path(path, false)?;
        let url = self.fs_url(Some(&path))?;
        let response = self
            .apply_auth(
                self.client
                    .get(url)
                    .header("Accept", "application/octet-stream"),
            )
            .send()
            .map_err(|error| transport_error(error).with_path(path.clone()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(response_error(response, Some(&path), None, false));
        }
        let headers = response.headers().clone();
        let bytes = read_limited(response, max_bytes, "file content")
            .map_err(|error| error.with_path(path.clone()))?;
        let metadata = metadata_from_headers(&path, &headers, true)
            .map_err(|error| error.with_path(path.clone()))?;
        Ok(FsFile { bytes, metadata })
    }

    pub fn fs_stat(&self, path: &str) -> Result<Value, FsError> {
        let path = normalize_path(path, false)?;
        self.ensure_file_target(&path)?;
        let url = self.fs_url(Some(&path))?;
        let response = self
            .apply_auth(self.client.get(url).header("X-Get-Meta", "true"))
            .send()
            .map_err(|error| transport_error(error).with_path(path.clone()))?;
        if !response.status().is_success() {
            return Err(response_error(response, Some(&path), None, false));
        }
        metadata_from_headers(&path, response.headers(), false)
            .map_err(|error| error.with_path(path.clone()))
    }

    pub fn fs_write(
        &self,
        path: &str,
        bytes: Vec<u8>,
        policy: WritePolicy<'_>,
    ) -> Result<Value, FsError> {
        let path = normalize_path(path, false)?;
        if let WritePolicy::Match(revision) = policy {
            validate_revision(revision).map_err(|error| error.with_path(path.clone()))?;
        }
        let url = self.fs_url(Some(&path))?;
        let mut request = self.client.put(url).header("X-Source", "external");
        request = match policy {
            WritePolicy::Create => request.header(IF_NONE_MATCH, "*"),
            WritePolicy::Match(revision) => request.header(IF_MATCH, revision),
            WritePolicy::Overwrite => request,
        };
        let response = self
            .apply_auth(request.body(bytes))
            .send()
            .map_err(|error| uncertain_mutation_error(error, &path))?;
        if !response.status().is_success() {
            let expected = match policy {
                WritePolicy::Match(revision) => Some(revision),
                _ => None,
            };
            return Err(response_error(
                response,
                Some(&path),
                expected,
                matches!(policy, WritePolicy::Create),
            ));
        }
        metadata_from_headers(&path, response.headers(), false)
            .map_err(|error| error.with_path(path.clone()))
    }

    pub fn fs_delete(&self, path: &str, revision: Option<&str>) -> Result<(), FsError> {
        let path = normalize_path(path, false)?;
        if let Some(revision) = revision {
            validate_revision(revision).map_err(|error| error.with_path(path.clone()))?;
        }
        self.ensure_file_target(&path)?;
        let url = self.fs_url(Some(&path))?;
        let mut request = self.client.delete(url).header("X-Source", "external");
        if let Some(revision) = revision {
            request = request.header(IF_MATCH, revision);
        }
        let response = self
            .apply_auth(request)
            .send()
            .map_err(|error| uncertain_mutation_error(error, &path))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(response_error(response, Some(&path), revision, false))
        }
    }

    fn fs_url(&self, path: Option<&str>) -> Result<Url, FsError> {
        let mut url = Url::parse(&self.base_url).map_err(|error| {
            FsError::new(
                "invalid_url",
                format!("Invalid SilverBullet server URL: {error}"),
                8,
            )
        })?;
        if url.query().is_some() || url.fragment().is_some() {
            return Err(FsError::new(
                "invalid_url",
                "SilverBullet server URL cannot contain a query or fragment.",
                8,
            ));
        }
        let mut segments = url.path_segments_mut().map_err(|_| {
            FsError::new(
                "invalid_url",
                "SilverBullet server URL cannot be used as a hierarchical base URL.",
                8,
            )
        })?;
        segments.pop_if_empty().push(".fs");
        if let Some(path) = path {
            segments.extend(path.split('/'));
        }
        drop(segments);
        Ok(url)
    }

    fn ensure_file_target(&self, path: &str) -> Result<(), FsError> {
        let files = self.fs_list().map_err(|error| {
            if error.path.is_some() {
                error
            } else {
                error.with_path(path)
            }
        })?;
        if files.iter().any(|file| file.name == path) {
            return Ok(());
        }
        let directory_prefix = format!("{path}/");
        if files
            .iter()
            .any(|file| file.name.starts_with(&directory_prefix))
        {
            Err(FsError::new(
                "invalid_target",
                "This operation requires a file path; the supplied path is a directory.",
                2,
            )
            .with_path(path))
        } else {
            Err(FsError::new("not_found", "Remote file was not found.", 3).with_path(path))
        }
    }
}

fn read_limited(
    mut response: Response,
    max_bytes: u64,
    description: &str,
) -> Result<Vec<u8>, FsError> {
    let mut bytes = Vec::new();
    if max_bytes == 0 {
        response.read_to_end(&mut bytes).map_err(|error| {
            FsError::new(
                "transport_error",
                format!("Failed while reading {description}: {error}"),
                8,
            )
        })?;
        return Ok(bytes);
    }
    response
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| {
            FsError::new(
                "transport_error",
                format!("Failed while reading {description}: {error}"),
                8,
            )
        })?;
    if bytes.len() as u64 > max_bytes {
        return Err(FsError::new(
            "response_too_large",
            format!("{description} exceeds the configured {max_bytes}-byte limit."),
            8,
        ));
    }
    Ok(bytes)
}

fn metadata_from_headers(
    path: &str,
    headers: &HeaderMap,
    prefer_original_content_type: bool,
) -> Result<Value, FsError> {
    let mut metadata = Map::new();
    metadata.insert("path".to_string(), Value::String(path.to_string()));
    let revision = response_revision(headers)?;
    metadata.insert(
        "revision".to_string(),
        revision.map(Value::String).unwrap_or(Value::Null),
    );
    insert_i64(&mut metadata, headers, "X-Created", "created");
    insert_i64(&mut metadata, headers, "X-Last-Modified", "lastModified");
    insert_i64(&mut metadata, headers, "X-Content-Length", "size");
    let content_type = if prefer_original_content_type {
        header_text(headers, "X-Content-Type").or_else(|| header_text(headers, "Content-Type"))
    } else {
        header_text(headers, "Content-Type")
    };
    if let Some(content_type) = content_type {
        metadata.insert("contentType".to_string(), Value::String(content_type));
    }
    if let Some(permission) = header_text(headers, "X-Permission") {
        metadata.insert("perm".to_string(), Value::String(permission));
    }
    Ok(Value::Object(metadata))
}

fn insert_i64(metadata: &mut Map<String, Value>, headers: &HeaderMap, header: &str, key: &str) {
    if let Some(value) = header_text(headers, header).and_then(|value| value.parse::<i64>().ok()) {
        metadata.insert(key.to_string(), Value::from(value));
    }
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn response_revision(headers: &HeaderMap) -> Result<Option<String>, FsError> {
    let dedicated_revision = headers.get(CONTENT_REVISION_HEADER);
    let Some(value) = dedicated_revision.or_else(|| headers.get(ETAG)) else {
        return Ok(None);
    };
    let revision = value.to_str().map_err(|_| {
        FsError::new(
            "invalid_response",
            "Server returned an invalid revision header.",
            8,
        )
    })?;
    if dedicated_revision.is_none() && revision.starts_with("W/") {
        return Ok(None);
    }
    validate_revision(revision).map_err(|_| {
        FsError::new(
            "invalid_response",
            "Server returned a revision that is not a strong, quoted content ETag.",
            8,
        )
    })?;
    Ok(Some(revision.to_string()))
}

fn transport_error(error: reqwest::Error) -> FsError {
    FsError::new(
        "transport_error",
        format!("Filesystem request failed: {error}"),
        8,
    )
}

fn uncertain_mutation_error(error: reqwest::Error, path: &str) -> FsError {
    FsError::new(
        "uncertain_outcome",
        format!(
            "The connection failed while submitting the mutation: {error}. Inspect the remote file before retrying."
        ),
        8,
    )
    .with_path(path)
}

fn response_error(
    response: Response,
    path: Option<&str>,
    expected_revision: Option<&str>,
    create: bool,
) -> FsError {
    let status = response.status();
    let current_revision = response_revision(response.headers()).ok().flatten();
    let body = read_limited(response, MAX_ERROR_BYTES, "server error response").ok();
    let server_message = body.as_deref().and_then(error_body_message);
    let mut error = match status {
        StatusCode::UNAUTHORIZED => FsError::new(
            "authentication_required",
            "Authentication required; run `sb space login <name>`, use --token, or configure a space with `sb space add`.",
            4,
        ),
        StatusCode::FORBIDDEN => FsError::new(
            "access_denied",
            server_message.unwrap_or_else(|| "Access denied by the server.".to_string()),
            4,
        ),
        // Without a path (search, listing) the server's reason, e.g. `unavailable`, is the useful part.
        StatusCode::NOT_FOUND => FsError::new(
            "not_found",
            match (path, server_message) {
                (None, Some(message)) => message,
                _ => "Remote file or directory was not found.".to_string(),
            },
            3,
        ),
        StatusCode::PRECONDITION_FAILED if create => FsError::new(
            "already_exists",
            "The remote file already exists; inspect it before choosing another write policy.",
            5,
        ),
        StatusCode::PRECONDITION_FAILED => FsError::new(
            "revision_conflict",
            match path {
                Some(path) => conflict_text(path, expected_revision, current_revision.as_deref()),
                None => "File changed; read it again before retrying.".to_string(),
            },
            5,
        ),
        status if status.is_redirection() => FsError::new(
            "authentication_required",
            "Authentication required; run `sb space login <name>`, use --token, or configure a space with `sb space add`.",
            4,
        ),
        _ => FsError::new(
            "server_error",
            server_message.unwrap_or_else(|| {
                format!("Server returned HTTP {}.", status.as_u16())
            }),
            8,
        ),
    };
    error.path = path.map(str::to_string);
    error.expected_revision = expected_revision.map(str::to_string);
    error.current_revision = current_revision;
    error
}

/// A refused conditional write or delete of `path`, worded as the MCP's.
pub fn conflict_text(path: &str, expected: Option<&str>, current: Option<&str>) -> String {
    let detail = match current {
        Some(current) => format!("the current revision is {current}"),
        None => "it no longer exists or the revision is not valid".to_string(),
    };
    let since = expected.map_or_else(String::new, |rev| format!(" since revision {rev}"));
    let shown = if path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._/-".contains(c))
    {
        path.to_string()
    } else {
        format!("'{}'", path.replace('\'', "'\\''"))
    };
    format!("{path} changed{since}; {detail}. Read it again (sb fs read {shown} --json) and retry.")
}

fn error_body_message(body: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(body).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        // Search errors are `{error: <code>, message}`; the message is the readable part.
        if let Some(message) = ["message", "error"]
            .iter()
            .find_map(|key| value.get(*key).and_then(Value::as_str))
        {
            return Some(message.to_string());
        }
    }
    Some(text.to_string())
}

#[cfg(test)]
mod tests;
