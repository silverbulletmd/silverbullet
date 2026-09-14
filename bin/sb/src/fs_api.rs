use std::{fmt, io::Read};

use reqwest::{
    blocking::Response,
    header::{HeaderMap, ETAG, IF_MATCH, IF_NONE_MATCH},
    StatusCode, Url,
};
use serde_json::{Map, Value};

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
    let Some(value) = headers.get(ETAG) else {
        return Ok(None);
    };
    let revision = value.to_str().map_err(|_| {
        FsError::new(
            "invalid_response",
            "Server returned an invalid revision header.",
            8,
        )
    })?;
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
        StatusCode::NOT_FOUND => FsError::new(
            "not_found",
            "Remote file or directory was not found.",
            3,
        ),
        StatusCode::PRECONDITION_FAILED if create => FsError::new(
            "already_exists",
            "The remote file already exists; inspect it before choosing another write policy.",
            5,
        ),
        StatusCode::PRECONDITION_FAILED => FsError::new(
            "revision_conflict",
            "File changed; read it again before retrying.",
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

fn error_body_message(body: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(body).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if let Some(message) = value.get("error").and_then(Value::as_str) {
            return Some(message.to_string());
        }
    }
    Some(text.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    use reqwest::blocking::Client;

    use super::*;
    use crate::conn::Auth;

    #[derive(Debug)]
    struct RecordedRequest {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl RecordedRequest {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.as_str())
        }
    }

    fn mock_server(response: Vec<u8>) -> (String, thread::JoinHandle<RecordedRequest>) {
        let (base_url, requests) = mock_server_sequence(vec![response]);
        let handle = thread::spawn(move || requests.join().unwrap().pop().unwrap());
        (base_url, handle)
    }

    fn mock_server_sequence(
        responses: Vec<Vec<u8>>,
    ) -> (String, thread::JoinHandle<Vec<RecordedRequest>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}/space/team", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut writer = stream;
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut parts = request_line.trim().splitn(3, ' ');
                let method = parts.next().unwrap_or("").to_string();
                let path = parts.next().unwrap_or("").to_string();
                let mut headers = Vec::new();
                let mut content_length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        break;
                    }
                    if let Some((name, value)) = trimmed.split_once(':') {
                        let name = name.trim().to_string();
                        let value = value.trim().to_string();
                        if name.eq_ignore_ascii_case("content-length") {
                            content_length = value.parse().unwrap();
                        }
                        headers.push((name, value));
                    }
                }
                let mut body = vec![0; content_length];
                reader.read_exact(&mut body).unwrap();
                writer.write_all(&response).unwrap();
                requests.push(RecordedRequest {
                    method,
                    path,
                    headers,
                    body,
                });
            }
            requests
        });
        (base_url, handle)
    }

    fn response(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
        let mut response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\n", body.len());
        for (name, value) in headers {
            response.push_str(&format!("{name}: {value}\r\n"));
        }
        response.push_str("\r\n");
        let mut bytes = response.into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }

    fn connection(base_url: &str) -> SpaceConnection {
        SpaceConnection {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base_url: base_url.to_string(),
            auth: Auth::Bearer("secret".to_string()),
            timeout: Duration::from_secs(30),
        }
    }

    #[test]
    fn normalizes_only_safe_space_relative_paths() {
        assert_eq!(
            normalize_path("./Projects/Launch.md", false).unwrap(),
            "Projects/Launch.md"
        );
        assert_eq!(normalize_path(".", true).unwrap(), ".");
        assert_eq!(normalize_path("./", true).unwrap(), ".");
        assert_eq!(normalize_path("Projects/", true).unwrap(), "Projects");
        for path in [
            "/etc/passwd",
            "../secret",
            "Projects/../secret",
            "a\\b",
            "a\0b",
        ] {
            assert_eq!(
                normalize_path(path, false).unwrap_err().code,
                "invalid_path",
                "{path:?}"
            );
        }
        for path in ["", ".", "Projects/", "/"] {
            assert_eq!(
                normalize_path(path, false).unwrap_err().code,
                "invalid_path",
                "{path:?}"
            );
        }
    }

    #[test]
    fn validates_only_strong_content_specific_etags() {
        for revision in [
            "*",
            "W/\"sha256:abc\"",
            "sha256:abc",
            "\"\"",
            "\"bad\nvalue\"",
        ] {
            assert_eq!(
                validate_revision(revision).unwrap_err().code,
                "invalid_revision",
                "{revision:?}"
            );
        }
        validate_revision("\"sha256:abc\"").unwrap();
        validate_revision("\"opaque:value\"").unwrap();
    }

    #[test]
    fn read_preserves_prefixed_url_and_exact_bytes() {
        let bytes = [0, 0xff, b'\n'];
        let response = response(
            "200 OK",
            &[
                ("ETag", "\"sha256:abcd\""),
                ("X-Content-Type", "application/custom"),
                ("X-Content-Length", "3"),
                ("X-Last-Modified", "42"),
            ],
            &bytes,
        );
        let (base_url, request) = mock_server(response);
        let file = connection(&base_url)
            .fs_read("Folder/naïve #?.bin", 3)
            .unwrap();
        assert_eq!(file.bytes, bytes);
        assert_eq!(file.metadata["path"], "Folder/naïve #?.bin");
        assert_eq!(file.metadata["revision"], "\"sha256:abcd\"");
        assert_eq!(file.metadata["contentType"], "application/custom");
        assert_eq!(file.metadata["size"], 3);
        assert_eq!(file.metadata["lastModified"], 42);

        let request = request.join().unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(
            request.path,
            "/space/team/.fs/Folder/na%C3%AFve%20%23%3F.bin"
        );
        assert_eq!(request.header("accept"), Some("application/octet-stream"));
        assert_eq!(request.header("authorization"), Some("Bearer secret"));
    }

    #[test]
    fn read_rejects_a_body_over_the_explicit_limit() {
        let (base_url, request) = mock_server(response("200 OK", &[], b"12345"));
        let error = connection(&base_url).fs_read("big.bin", 4).unwrap_err();
        assert_eq!(error.code, "response_too_large");
        assert_eq!(error.path.as_deref(), Some("big.bin"));
        request.join().unwrap();
    }

    #[test]
    fn conditional_write_reports_both_revisions_on_conflict() {
        let response = response(
            "412 Precondition Failed",
            &[("ETag", "\"sha256:new\"")],
            b"Precondition Failed",
        );
        let (base_url, request) = mock_server(response);
        let error = connection(&base_url)
            .fs_write(
                "Notes.md",
                b"new".to_vec(),
                WritePolicy::Match("\"sha256:old\""),
            )
            .unwrap_err();
        assert_eq!(error.code, "revision_conflict");
        assert_eq!(error.exit_code, 5);
        assert_eq!(error.expected_revision.as_deref(), Some("\"sha256:old\""));
        assert_eq!(error.current_revision.as_deref(), Some("\"sha256:new\""));

        let request = request.join().unwrap();
        assert_eq!(request.method, "PUT");
        assert_eq!(request.header("if-match"), Some("\"sha256:old\""));
        assert_eq!(request.header("if-none-match"), None);
        assert_eq!(request.header("x-source"), Some("external"));
        assert_eq!(request.body, b"new");
    }

    #[test]
    fn create_write_sends_an_explicit_create_policy() {
        let response = response("200 OK", &[("ETag", "\"sha256:new\"")], b"OK");
        let (base_url, request) = mock_server(response);
        let metadata = connection(&base_url)
            .fs_write("New.md", Vec::new(), WritePolicy::Create)
            .unwrap();
        assert_eq!(metadata["revision"], "\"sha256:new\"");

        let request = request.join().unwrap();
        assert_eq!(request.header("if-none-match"), Some("*"));
        assert_eq!(request.header("if-match"), None);
        assert_eq!(request.header("x-source"), Some("external"));
    }

    #[test]
    fn overwrite_write_sends_no_conditional_header() {
        let response = response("200 OK", &[], b"OK");
        let (base_url, request) = mock_server(response);
        connection(&base_url)
            .fs_write(
                "Replace.md",
                b"replacement".to_vec(),
                WritePolicy::Overwrite,
            )
            .unwrap();

        let request = request.join().unwrap();
        assert_eq!(request.header("if-none-match"), None);
        assert_eq!(request.header("if-match"), None);
        assert_eq!(request.header("x-source"), Some("external"));
    }

    #[test]
    fn lists_file_metadata_from_the_prefixed_endpoint() {
        let body = br#"[{"name":"Page.md","created":1,"lastModified":2,"contentType":"text/markdown","size":3,"perm":"rw"}]"#;
        let (base_url, request) = mock_server(response("200 OK", &[], body));
        let files = connection(&base_url).fs_list().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "Page.md");
        assert_eq!(files[0].last_modified, 2);

        let request = request.join().unwrap();
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/space/team/.fs");
    }

    #[test]
    fn stat_uses_a_metadata_probe_without_inventing_a_revision() {
        let (base_url, requests) = mock_server_sequence(vec![
            response(
                "200 OK",
                &[],
                br#"[{"name":"Page.md","created":1,"lastModified":2,"contentType":"text/markdown","size":9,"perm":"rw"}]"#,
            ),
            response(
                "200 OK",
                &[
                    ("Content-Type", "text/markdown"),
                    ("X-Content-Length", "9"),
                    ("X-Permission", "rw"),
                ],
                &[],
            ),
        ]);
        let metadata = connection(&base_url).fs_stat("Page.md").unwrap();
        assert_eq!(metadata["path"], "Page.md");
        assert_eq!(metadata["revision"], Value::Null);
        assert_eq!(metadata["size"], 9);
        assert_eq!(metadata["contentType"], "text/markdown");
        assert_eq!(metadata["perm"], "rw");

        let requests = requests.join().unwrap();
        assert_eq!(requests[0].path, "/space/team/.fs");
        assert_eq!(requests[1].header("x-get-meta"), Some("true"));
        assert!(requests[1].body.is_empty());
    }

    #[test]
    fn stat_rejects_a_directory_before_sending_a_metadata_probe() {
        let (base_url, request) = mock_server(response(
            "200 OK",
            &[],
            br#"[{"name":"Folder/Page.md","created":1,"lastModified":2,"contentType":"text/markdown","size":9,"perm":"rw"}]"#,
        ));
        let error = connection(&base_url).fs_stat("Folder").unwrap_err();
        assert_eq!(error.code, "invalid_target");
        assert_eq!(error.exit_code, 2);
        assert_eq!(request.join().unwrap().path, "/space/team/.fs");
    }

    #[test]
    fn conditional_delete_forwards_the_revision_and_attribution() {
        let (base_url, requests) = mock_server_sequence(vec![
            response(
                "200 OK",
                &[],
                br#"[{"name":"Old.md","created":1,"lastModified":2,"contentType":"text/markdown","size":3,"perm":"rw"}]"#,
            ),
            response("200 OK", &[], b"OK"),
        ]);
        connection(&base_url)
            .fs_delete("Old.md", Some("\"sha256:old\""))
            .unwrap();

        let requests = requests.join().unwrap();
        assert_eq!(requests[0].path, "/space/team/.fs");
        assert_eq!(requests[1].method, "DELETE");
        assert_eq!(requests[1].header("if-match"), Some("\"sha256:old\""));
        assert_eq!(requests[1].header("x-source"), Some("external"));
    }

    #[test]
    fn create_conflict_has_a_distinct_typed_error() {
        let (base_url, request) = mock_server(response(
            "412 Precondition Failed",
            &[("ETag", "\"sha256:current\"")],
            b"Precondition Failed",
        ));
        let error = connection(&base_url)
            .fs_write("Exists.md", Vec::new(), WritePolicy::Create)
            .unwrap_err();
        assert_eq!(error.code, "already_exists");
        assert_eq!(
            error.current_revision.as_deref(),
            Some("\"sha256:current\"")
        );
        request.join().unwrap();
    }

    #[test]
    fn mutation_transport_failure_reports_an_uncertain_outcome_without_retrying() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}/space/team", listener.local_addr().unwrap());
        let request = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            line
        });

        let error = connection(&base_url)
            .fs_write("Maybe.md", b"payload".to_vec(), WritePolicy::Overwrite)
            .unwrap_err();
        assert_eq!(error.code, "uncertain_outcome");
        assert_eq!(error.path.as_deref(), Some("Maybe.md"));
        assert!(error.message.contains("Inspect the remote file"));
        assert!(request.join().unwrap().starts_with("PUT "));
    }

    #[test]
    fn oversized_binary_error_body_keeps_the_typed_status_error() {
        let body = vec![0xff; 70 * 1024];
        let (base_url, request) = mock_server(response("404 Not Found", &[], &body));
        let error = connection(&base_url)
            .fs_read("missing.bin", 10)
            .unwrap_err();
        assert_eq!(error.code, "not_found");
        assert_eq!(error.exit_code, 3);
        assert_eq!(error.path.as_deref(), Some("missing.bin"));
        request.join().unwrap();
    }
}
