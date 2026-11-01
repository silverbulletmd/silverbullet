use std::sync::Arc;

use axum::{
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chrono::{TimeZone, Utc};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use silverbullet_server_common::page::{parse_page, PageKind};

use crate::{router::run_blocking, state::ServerState};

pub(crate) fn is_public(state: &ServerState) -> bool {
    state.anonymous_readable && !state.anonymous_writable
}

pub(crate) fn origin(headers: &HeaderMap) -> Option<String> {
    let host = crate::auth::request_host(headers);
    let authority: axum::http::uri::Authority = host.parse().ok()?;
    if authority.as_str().contains('@') {
        return None;
    }
    Some(crate::router::own_origin(headers))
}

pub(crate) fn page_url(state: &ServerState, origin: &str, page: &str) -> String {
    const PATH: &AsciiSet = &NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'~')
        .remove(b'/');
    let page = if page == state.boot_config.index_page {
        ""
    } else {
        page
    };
    format!(
        "{origin}{}/{}",
        state.host_url_prefix,
        utf8_percent_encode(page, PATH)
    )
}

fn response(status: StatusCode, content_type: &str, body: String) -> Response {
    Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("cache-control", "no-cache")
        .body(Body::from(body))
        .unwrap()
}

pub async fn handle_robots(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let prefix = &state.host_url_prefix;
    let body = if is_public(&state) {
        let sitemap = origin(&headers)
            .map(|origin| format!("Sitemap: {origin}{prefix}/sitemap.xml\n"))
            .unwrap_or_default();
        format!("User-agent: *\nAllow: {prefix}/\n{sitemap}")
    } else {
        format!("User-agent: *\nDisallow: {prefix}/\n")
    };
    response(StatusCode::OK, "text/plain; charset=utf-8", body)
}

pub async fn handle_sitemap(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if !is_public(&state) {
        return response(StatusCode::NOT_FOUND, "text/plain", "Not found".into());
    }
    let Some(origin) = origin(&headers) else {
        return response(StatusCode::BAD_REQUEST, "text/plain", "Invalid host".into());
    };
    let xml = run_blocking(move || {
        let mut files = state.space.fetch_file_list()?;
        files.sort_by(|a, b| a.name.cmp(&b.name));
        let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
        let mut count = 0;
        for file in files {
            let Some(page) = file.name.strip_suffix(".md") else { continue; };
            if file.name.split('/').any(|part| part.starts_with('.')) { continue; }
            let data = match state.space.read_file(&file.name) {
                Ok((data, _)) => data,
                Err(silverbullet_server_common::SpaceError::NotFound) => continue,
                Err(error) => return Err(error),
            };
            if parse_page(&String::from_utf8_lossy(&data)).metadata.kind() != PageKind::Content { continue; }
            let loc = page_url(&state, &origin, page).replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
            xml.push_str(&format!("  <url><loc>{loc}</loc>"));
            if file.last_modified > 0 {
                if let Some(date) = Utc.timestamp_millis_opt(file.last_modified).single() {
                    xml.push_str(&format!("<lastmod>{}</lastmod>", date.to_rfc3339()));
                }
            }
            xml.push_str("</url>\n");
            count += 1;
            if count > 50_000 || xml.len() > 50_000_000 {
                return Err(silverbullet_server_common::SpaceError::Io(std::io::Error::other("Space exceeds a single sitemap's limits")));
            }
        }
        xml.push_str("</urlset>\n");
        Ok(xml)
    }).await;
    match xml {
        Ok(xml) => response(StatusCode::OK, "application/xml; charset=utf-8", xml),
        Err(error) => super::space_error_response(error),
    }
}

#[cfg(test)]
mod tests {
    use crate::{build_router, state::ServerState, test_support::test_state};
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use std::sync::Arc;
    use tower::ServiceExt;

    fn public_state() -> ServerState {
        let mut state = test_state();
        state.anonymous_readable = true;
        state.host_url_prefix = "/wiki".into();
        for (name, text) in [
            ("index.md", "# Home"),
            ("Field Notes.md", "---\ntags: glossary\n---\n# Notes"),
            ("Library/Guide.md", "# Guide"),
            ("Settings.md", "#meta/config"),
            ("Weekly Review.md", "---\ntags: template\n---\n# Review"),
            ("Photo.png", "image"),
        ] {
            state.space.write_file(name, text.as_bytes(), None).unwrap();
        }
        state
    }

    fn public_state_with_shell() -> ServerState {
        let state = public_state();
        state
            .client_bundle
            .write_file(
                ".client/index.html",
                include_bytes!("../../../client/html/index.html"),
                None,
            )
            .unwrap();
        state
    }

    async fn request(state: ServerState, path: &str) -> (u16, String, String) {
        let response = build_router(Arc::new(state))
            .oneshot(
                Request::builder()
                    .uri(path)
                    .header("host", "notes.example")
                    .header("x-forwarded-proto", "https")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned();
        let body = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        (status, content_type, body)
    }

    #[tokio::test]
    async fn sitemap_discovers_content_not_meta_pages() {
        let (status, content_type, body) = request(public_state(), "/sitemap.xml").await;
        assert_eq!(status, 200);
        assert!(content_type.starts_with("application/xml"));
        assert!(
            body.contains("<loc>https://notes.example/wiki/</loc>"),
            "{body}"
        );
        assert!(body.contains("/wiki/Field%20Notes</loc>"), "{body}");
        assert!(body.contains("/wiki/Library/Guide</loc>"), "{body}");
        assert!(!body.contains("Settings"));
        assert!(!body.contains("Weekly%20Review"), "{body}");
        assert!(!body.contains("Photo"));
        assert!(!body.contains("/index</loc>"));
    }

    #[tokio::test]
    async fn robots_discovery_and_non_public_spaces() {
        let (status, content_type, body) = request(public_state(), "/robots.txt").await;
        assert_eq!(status, 200);
        assert!(content_type.starts_with("text/plain"));
        assert!(body.contains("Sitemap: https://notes.example/wiki/sitemap.xml"));
        for (readable, writable) in [(false, false), (true, true)] {
            let mut state = public_state();
            state.anonymous_readable = readable;
            state.anonymous_writable = writable;
            let (_, _, robots) = request(state, "/robots.txt").await;
            assert!(robots.contains("Disallow: /wiki/"));
            let mut state = public_state();
            state.anonymous_readable = readable;
            state.anonymous_writable = writable;
            let (status, _, sitemap) = request(state, "/sitemap.xml").await;
            assert_eq!(status, 404);
            assert!(!sitemap.contains("Field"));
        }
    }

    #[tokio::test]
    async fn rendered_metadata_uses_the_same_classifier() {
        let state = public_state();
        state
            .client_bundle
            .write_file(
                ".client/index.html",
                include_bytes!("../../../client/html/index.html"),
                None,
            )
            .unwrap();
        state
            .space
            .write_file(
                "Field Notes.md",
                b"---\ndescription: 'A & B <notes>'\ntags: meta/config\n---\n# Published",
                None,
            )
            .unwrap();
        let (status, _, body) = request(state, "/Field%20Notes?view=1").await;
        assert_eq!(status, 200);
        assert!(
            body.contains("content=\"A &amp; B &lt;notes&gt;\" name=\"description\""),
            "{body}"
        );
        assert!(
            body.replace("&#x2f;", "/")
                .contains("https://notes.example/wiki/Field%20Notes"),
            "{body}"
        );
        assert!(body
            .replace("&#x2f;", "/")
            .contains("https://notes.example/wiki/.client/logo.png"));
        assert!(body.contains("noindex, follow"));
        assert!(!body.contains("description:"));
        assert!(body.contains("Published"));
        // Templates are meta pages too, as the client classifies them.
        let (status, _, body) = request(public_state_with_shell(), "/Weekly%20Review?view=1").await;
        assert_eq!(status, 200);
        assert!(body.contains("noindex, follow"), "{body}");
        let (_, _, body) = request(public_state_with_shell(), "/Field%20Notes?view=1").await;
        assert!(!body.contains("noindex"), "{body}");
    }
    #[tokio::test]
    async fn canonical_index_and_description_fallback() {
        for path in ["/", "/index?view=1"] {
            let state = public_state();
            state
                .client_bundle
                .write_file(
                    ".client/index.html",
                    include_bytes!("../../../client/html/index.html"),
                    None,
                )
                .unwrap();
            let (status, _, body) = request(state, path).await;
            assert_eq!(status, 200);
            let decoded = body.replace("&#x2f;", "/");
            assert!(
                decoded.contains("href=\"https://notes.example/wiki/\" rel=\"canonical\""),
                "{body}"
            );
            assert!(body.contains("Powerful and programmable note taking app"));
            assert!(!body.contains("noindex"));
        }
        for path in ["/%FF", "/Notes%ZZ", "/Notes%2"] {
            assert_eq!(request(public_state_with_shell(), path).await.0, 400);
        }
    }

    #[tokio::test]
    async fn initial_html_links_resolve_meta_and_positions_without_linking_lua_or_code() {
        let state = public_state_with_shell();
        for (name, text) in [
            ("Library/Config.md", "#meta/config\nConfiguration"),
            ("Café & Tea.md", "A page with a reserved character"),
            ("Field Notes.md", "# **Bold**\nHeading content"),
            (
                "index.md",
                r#"[[^Library/Config|Configuration]]
[[Field Notes@123|Position]]
[[Field Notes@L12C42|Line and column]]
[[Café & Tea|Unicode]]
[[Field Notes#**Bold**|Formatted heading]]
`${query[[from index.pages() limit 1]]}`
${query[[from index.pages() limit 1]]}
```lua
local example = "[[Field Notes]]"
```
"#,
            ),
        ] {
            state.space.write_file(name, text.as_bytes(), None).unwrap();
        }
        let router = build_router(Arc::new(state));
        let response = router
            .clone()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        let anchors: Vec<String> = regex::Regex::new(r#"<a\b[^>]*href="([^"]+)""#)
            .unwrap()
            .captures_iter(&body)
            .map(|capture| capture[1].replace("&amp;", "&"))
            .collect();
        assert_eq!(anchors.len(), 5, "{body}");
        assert!(
            anchors.contains(&"/wiki/Library/Config".into()),
            "{anchors:?}"
        );
        assert_eq!(
            anchors
                .iter()
                .filter(|url| *url == "/wiki/Field%20Notes")
                .count(),
            2,
            "{anchors:?}"
        );
        assert!(anchors.contains(&"/wiki/Field%20Notes#%2A%2ABold%2A%2A".into()));
        for url in anchors {
            let path = url
                .strip_prefix("/wiki")
                .unwrap()
                .split('#')
                .next()
                .unwrap();
            let response = router
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{url}");
            if url.contains('#') {
                let html = String::from_utf8(
                    to_bytes(response.into_body(), usize::MAX)
                        .await
                        .unwrap()
                        .to_vec(),
                )
                .unwrap();
                assert!(html.contains("id=\"**Bold**\""), "{html}");
            }
        }
        for sync in [false, true] {
            let mut request = Request::builder().uri("/.fs/index.md");
            if sync {
                request = request.header("X-Sync-Mode", "true");
            }
            let response = router
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let raw = String::from_utf8(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .to_vec(),
            )
            .unwrap();
            assert!(
                raw.starts_with("[[^Library/Config|Configuration]]"),
                "{raw}"
            );
            assert!(raw.contains("${query[[from index.pages() limit 1]]}"));
            assert!(!raw.contains("<html"));
        }
        let unknown = router
            .oneshot(
                Request::builder()
                    .uri("/Actually%20Missing")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn documentation_catalogs_publish_crawlable_links_in_initial_html() {
        fn load_pages(folder: &std::path::Path, root: &std::path::Path, state: &ServerState) {
            for entry in std::fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    load_pages(&path, root, state);
                } else if path.extension().is_some_and(|extension| extension == "md") {
                    let name = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    state
                        .space
                        .write_file(&name, &std::fs::read(&path).unwrap(), None)
                        .unwrap();
                }
            }
        }
        let state = public_state_with_shell();
        let docs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs");
        load_pages(&docs, &docs, &state);
        let router = build_router(Arc::new(state));
        let pattern = regex::Regex::new(r#"<a\b[^>]*href="([^"]+)""#).unwrap();
        for (hub, expected) in [
            (
                "API",
                vec!["/wiki/API/editor", "/wiki/API/global", "/wiki/API/js"],
            ),
            ("ADR", vec!["/wiki/ADR/005%20Space%20Lua"]),
            (
                "Architecture",
                vec![
                    "/wiki/Architecture/Client%20Bundle%20Cache",
                    "/wiki/Architecture/Server",
                ],
            ),
            (
                "Development",
                vec!["/wiki/Library/Development", "/wiki/Plugs/Development"],
            ),
        ] {
            let response = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/{hub}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{hub}");
            let body = String::from_utf8(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .to_vec(),
            )
            .unwrap();
            let links: Vec<String> = pattern
                .captures_iter(&body)
                .map(|capture| capture[1].replace("&amp;", "&"))
                .collect();
            for expected in expected {
                assert!(
                    links.contains(&expected.to_string()),
                    "{hub} lacks {expected}: {links:?}"
                );
            }
            for link in links.iter().filter(|link| link.starts_with("/wiki/")) {
                let path = link
                    .strip_prefix("/wiki")
                    .unwrap()
                    .split('#')
                    .next()
                    .unwrap();
                let response = router
                    .clone()
                    .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK, "{hub} -> {link}");
            }
        }
    }
}
