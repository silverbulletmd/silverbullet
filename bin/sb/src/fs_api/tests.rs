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
    // The mock serves one response per connection; without `Connection:
    // close` the client may reuse the closed socket for its next request.
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
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
fn read_with_weak_etag_succeeds_without_a_write_revision() {
    let (base_url, request) = mock_server(response(
        "200 OK",
        &[("ETag", "W/\"sha256:abc\"")],
        b"hello",
    ));
    let file = connection(&base_url).fs_read("Note.md", 100).unwrap();
    assert_eq!(file.bytes, b"hello");
    assert_eq!(file.metadata["revision"], Value::Null);
    request.join().unwrap();
}

#[test]
fn proxy_revision_survives_read_and_conditional_write() {
    let revision = "\"sha256:original\"";
    let (base_url, requests) = mock_server_sequence(vec![
        response(
            "200 OK",
            &[
                ("ETag", "W/\"sha256:proxy\""),
                ("X-SilverBullet-Revision", revision),
            ],
            b"hello",
        ),
        response(
            "200 OK",
            &[("X-SilverBullet-Revision", "\"sha256:updated\"")],
            b"OK",
        ),
    ]);
    let conn = connection(&base_url);
    let file = conn.fs_read("Note.md", 100).unwrap();
    assert_eq!(file.metadata["revision"], revision);
    let result = conn
        .fs_write(
            "Note.md",
            b"updated".to_vec(),
            WritePolicy::Match(file.metadata["revision"].as_str().unwrap()),
        )
        .unwrap();
    assert_eq!(result["revision"], "\"sha256:updated\"");
    let requests = requests.join().unwrap();
    assert_eq!(requests[1].header("if-match"), Some(revision));
}

#[test]
fn invalid_dedicated_revision_does_not_fall_back_to_etag() {
    let mut headers = HeaderMap::new();
    headers.insert("ETag", "\"sha256:valid\"".parse().unwrap());
    headers.insert(
        "X-SilverBullet-Revision",
        "W/\"sha256:invalid\"".parse().unwrap(),
    );
    assert!(response_revision(&headers).is_err());
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
        &[
            ("ETag", "W/\"sha256:new\""),
            ("X-SilverBullet-Revision", "\"sha256:new\""),
        ],
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
fn conflict_message_tells_how_to_reread() {
    let response = response(
        "412 Precondition Failed",
        &[("X-SilverBullet-Revision", "\"sha256:new\"")],
        b"Precondition Failed",
    );
    let (base_url, _request) = mock_server(response);
    let error = connection(&base_url)
        .fs_write(
            "Draft.md",
            b"new".to_vec(),
            WritePolicy::Match("\"sha256:old\""),
        )
        .unwrap_err();
    assert_eq!(
        error.message,
        "Draft.md changed since revision \"sha256:old\"; the current revision is \"sha256:new\". Read it again (sb fs read Draft.md --json) and retry."
    );
    assert_eq!(
        conflict_text("My Notes/Draft.md", Some("\"a\""), None),
        "My Notes/Draft.md changed since revision \"a\"; it no longer exists or the revision is not valid. Read it again (sb fs read 'My Notes/Draft.md' --json) and retry."
    );
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

#[test]
fn error_messages_prefer_message_over_error_code() {
    assert_eq!(
        error_body_message(br#"{"error":"code","message":"readable"}"#).as_deref(),
        Some("readable")
    );
    assert_eq!(
        error_body_message(br#"{"error":"only code"}"#).as_deref(),
        Some("only code")
    );
}
