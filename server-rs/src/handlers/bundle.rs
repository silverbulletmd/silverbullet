use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::router::run_blocking;
use crate::ssr::{convert_wiki_links, render_markdown};
use crate::state::AppState;

/// SPA fallback: serve a bundle asset by request path verbatim, or fall back to
/// the templated `index.html` shell for any unknown path (client-side routing).
/// For a public, read-only space the shell is filled with server-side-rendered
/// page markdown (SEO); otherwise the empty shell is served and the JS client
/// renders.
pub async fn handle_client_bundle(
    State(state): State<Arc<AppState>>,
    req: axum::http::Request<Body>,
) -> impl IntoResponse {
    if state.client_bundle.is_none() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("No client bundle configured"))
            .unwrap();
    }

    let path = req.uri().path().trim_start_matches('/').to_string();

    // Try the requested asset first — served verbatim, no templating.
    let s = state.clone();
    let p = path.clone();
    let direct = run_blocking(move || s.client_bundle.as_ref().unwrap().read_file(&p)).await;
    if let Ok((data, meta)) = direct {
        return Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", &meta.content_type)
            .body(Body::from(data))
            .unwrap();
    }

    // Fallback: the SPA shell (`.client/index.html`), templated.
    let s = state.clone();
    let shell = run_blocking(move || {
        s.client_bundle
            .as_ref()
            .unwrap()
            .read_file(".client/index.html")
    })
    .await;
    let shell = match shell {
        Ok((data, _)) => data,
        Err(_) => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from("Not found"))
                .unwrap();
        }
    };

    let (title, content_html) = server_side_content(&state, &path).await;
    let body = template_index_html(
        &shell,
        &state.host_url_prefix,
        &title,
        &state.additional_head_html,
        &content_html,
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/html")
        .body(Body::from(body))
        .unwrap()
}

/// Decide the `<title>` and content HTML for the fallback shell. Only a public
/// (read-only, unauthenticated) space renders real page content; everything
/// else gets the plain shell with an empty body for the JS client to take over.
async fn server_side_content(state: &Arc<AppState>, path: &str) -> (String, String) {
    let public = state.boot_config.read_only && state.authorizer.is_none();
    if !public {
        return ("SilverBullet".to_string(), String::new());
    }

    let page_name = if path.is_empty() {
        state.boot_config.index_page.clone()
    } else {
        path.to_string()
    };
    let title = page_name
        .rsplit('/')
        .next()
        .unwrap_or(&page_name)
        .to_string();

    let md_path = format!("{page_name}.md");
    let s = state.clone();
    let content = match run_blocking(move || s.space.read_file(&md_path)).await {
        Ok((data, _)) => {
            let text = String::from_utf8_lossy(&data);
            render_markdown(&convert_wiki_links(&text))
        }
        Err(_) => String::new(),
    };
    (title, content)
}

/// Render the `index.html` SPA shell with minijinja. The template exposes
/// `host_prefix`, `title`, `description`, `additional_head_html` and `content`;
/// HTML autoescaping is on, so `title`/`description` are escaped while the
/// pre-rendered `additional_head_html` and `content` are emitted via the
/// template's `| safe` filter. The latter two are NOT sanitized: raw HTML in a
/// page passes straight through. That is acceptable here because SSR only ever
/// runs for a public, read-only space, where the content is the space owner's
/// own pages; do not reuse `render_markdown` for untrusted input.
///
/// On a template error (e.g. a malformed shell) the raw shell bytes are served
/// so the client JS can still boot, mirroring the legacy server's best-effort
/// behavior.
fn template_index_html(
    shell: &[u8],
    host_prefix: &str,
    title: &str,
    additional_head: &str,
    content_html: &str,
) -> Vec<u8> {
    let shell = String::from_utf8_lossy(shell);
    let mut env = minijinja::Environment::new();
    env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
    let ctx = minijinja::context! {
        host_prefix => host_prefix,
        title => title,
        description => "",
        additional_head_html => additional_head,
        content => content_html,
    };
    match env.render_str(&shell, ctx) {
        Ok(rendered) => rendered.into_bytes(),
        Err(err) => {
            tracing::error!("index.html template render failed: {err}");
            shell.into_owned().into_bytes()
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::state::AppState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    fn seed_bundle(state: &AppState, path: &str, body: &[u8]) {
        state
            .client_bundle
            .as_ref()
            .unwrap()
            .write_file(path, body, None)
            .unwrap();
    }

    fn seed_space(state: &AppState, path: &str, body: &[u8]) {
        state.space.write_file(path, body, None).unwrap();
    }

    async fn body_string(resp: axum::response::Response) -> String {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    const INDEX_TPL: &[u8] = br#"<base href="{{ host_prefix | safe }}/"><title>{{ title }}</title><meta content="{{ description }}">{{ additional_head_html | safe }}<div class="cm-content">{{ content | safe }}</div>"#;

    #[tokio::test]
    async fn serves_a_bundle_asset_raw() {
        let state = test_state();
        seed_bundle(&state, ".client/app.js", b"console.log(1)");
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.client/app.js")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_string(resp).await, "console.log(1)");
    }

    #[tokio::test]
    async fn html_assets_are_served_raw_on_the_direct_path() {
        // Direct path: no templating (matches the legacy Go server).
        let state = test_state();
        seed_bundle(&state, "raw.html", b"<title>{{.Title}}</title>");
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/raw.html")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(body_string(resp).await, "<title>{{.Title}}</title>");
    }

    #[tokio::test]
    async fn fallback_templates_the_spa_shell() {
        // Writable space (read_only=false): the SPA shell, no SSR content.
        let state = test_state();
        seed_bundle(&state, ".client/index.html", INDEX_TPL);
        seed_space(&state, "Home.md", b"# Should not render");
        let resp = crate::build_router(state)
            .oneshot(Request::builder().uri("/Home").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let html = body_string(resp).await;
        assert!(html.contains("<title>SilverBullet</title>"), "{html}");
        // Placeholders resolved, content empty (client renders).
        assert!(!html.contains("{{"), "unresolved placeholder: {html}");
        assert!(
            html.contains(r#"<div class="cm-content"></div>"#),
            "content should be empty: {html}"
        );
    }

    fn read_only_public_state() -> Arc<AppState> {
        let mut s = Arc::try_unwrap(test_state()).ok().expect("unique");
        s.boot_config.read_only = true;
        s.authorizer = None;
        Arc::new(s)
    }

    #[tokio::test]
    async fn public_read_only_space_renders_page_markdown() {
        let state = read_only_public_state();
        seed_bundle(&state, ".client/index.html", INDEX_TPL);
        seed_space(&state, "Home.md", b"# Welcome\n\nSee [[Other]].");
        let resp = crate::build_router(state)
            .oneshot(Request::builder().uri("/Home").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let html = body_string(resp).await;
        // Title is the page basename.
        assert!(html.contains("<title>Home</title>"), "{html}");
        // Markdown rendered into the content div.
        assert!(html.contains("<h1"), "expected rendered h1: {html}");
        assert!(html.contains("Welcome"), "{html}");
        // Wiki link became an anchor.
        assert!(html.contains(r#"href="Other""#), "{html}");
    }

    #[tokio::test]
    async fn public_read_only_empty_path_uses_index_page() {
        let state = read_only_public_state(); // index_page == "index"
        seed_bundle(&state, ".client/index.html", INDEX_TPL);
        seed_space(&state, "index.md", b"# Front page");
        let resp = crate::build_router(state)
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let html = body_string(resp).await;
        assert!(html.contains("<title>index</title>"), "{html}");
        assert!(html.contains("Front page"), "{html}");
    }

    #[tokio::test]
    async fn public_read_only_missing_page_renders_empty_content() {
        let state = read_only_public_state();
        seed_bundle(&state, ".client/index.html", INDEX_TPL);
        // No matching .md in the space.
        let resp = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/Nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let html = body_string(resp).await;
        assert!(
            html.contains(r#"<div class="cm-content"></div>"#),
            "missing page → empty content: {html}"
        );
    }

    #[test]
    fn templating_escapes_title_but_passes_content_raw() {
        // `title` is autoescaped; `content`/`additional_head_html` use `| safe`
        // and are emitted verbatim (markdown output / config HTML).
        let out = super::template_index_html(
            br#"<title>{{ title }}</title>{{ additional_head_html | safe }}<div>{{ content | safe }}</div>"#,
            "",
            "a<script>b",
            "<meta name=\"x\">",
            "<b>bold</b>",
        );
        let html = String::from_utf8(out).unwrap();
        assert!(html.contains("<title>a&lt;script&gt;b</title>"), "{html}");
        assert!(html.contains(r#"<meta name="x">"#), "{html}");
        assert!(html.contains("<div><b>bold</b></div>"), "{html}");
    }

    #[test]
    fn renders_the_real_shipped_index_html_without_leftover_placeholders() {
        // Guard against the renderer and the shipped template drifting apart:
        // render the ACTUAL bundled `index.html` (not a synthetic fixture) and
        // assert every placeholder resolved.
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../client_bundle/client/.client/index.html"
        );
        let shell = std::fs::read(path).expect("shipped client bundle index.html must exist");
        let out = super::template_index_html(
            &shell,
            "/prefix",
            "MyTitle",
            "<meta name=\"sb\">",
            "<p>hello</p>",
        );
        let html = String::from_utf8(out).unwrap();
        assert!(!html.contains("{{"), "leftover placeholder: {html}");
        assert!(html.contains(r#"<base href="/prefix/""#), "{html}");
        assert!(html.contains("<title>MyTitle</title>"), "{html}");
        assert!(html.contains("<meta name=\"sb\">"), "{html}");
        assert!(html.contains("<p>hello</p>"), "{html}");
    }

    #[test]
    fn malformed_template_falls_back_to_raw_shell() {
        // An unbalanced tag is a render error → serve the shell bytes as-is so
        // the client JS still loads.
        let raw = br#"<html>{{ oops"#;
        let out = super::template_index_html(raw, "", "T", "", "");
        assert_eq!(out, raw);
    }

    #[tokio::test]
    async fn no_bundle_configured_is_404() {
        let mut s = Arc::try_unwrap(test_state()).ok().expect("unique");
        s.client_bundle = None;
        let state = Arc::new(s);
        let resp = crate::build_router(state)
            .oneshot(Request::builder().uri("/x").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
