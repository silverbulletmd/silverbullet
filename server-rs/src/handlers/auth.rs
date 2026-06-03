use std::sync::Arc;

use axum::extract::State;
use axum::http::{header::SET_COOKIE, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Form, Json};
use serde::Deserialize;
use serde_json::json;

use crate::auth::{auth_cookie_name, is_secure_request, request_host, CookieOptions};
use crate::router::run_blocking;
use crate::state::AppState;

/// `GET /.auth` — render the login page from `.client/auth.html`. Returns 403
/// when authentication is not enabled (no `LoginManager`).
pub async fn handle_auth_get(State(state): State<Arc<AppState>>) -> Response {
    let Some(login) = state.login.clone() else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };

    let s = state.clone();
    let shell = run_blocking(move || s.client_bundle.read_file(".client/auth.html")).await;
    let shell = match shell {
        Ok((data, _)) => data,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "Auth page not found").into_response();
        }
    };

    let body = render_auth_page(
        &shell,
        login.host_url_prefix(),
        &state.boot_config.space_name,
        login.salt(),
        login.remember_me_days(),
    );
    ([(axum::http::header::CONTENT_TYPE, "text/html")], body).into_response()
}

/// Render `auth.html` with minijinja. `host_prefix` is emitted raw (`| safe`),
/// `space_name` is autoescaped (it lands in the title/heading), and
/// `encryption_salt` is a base64 string injected inside a quoted JS literal.
fn render_auth_page(
    shell: &[u8],
    host_prefix: &str,
    space_name: &str,
    encryption_salt: &str,
    remember_me_days: u64,
) -> Vec<u8> {
    let shell = String::from_utf8_lossy(shell);
    let mut env = minijinja::Environment::new();
    env.set_auto_escape_callback(|_| minijinja::AutoEscape::Html);
    let ctx = minijinja::context! {
        host_prefix => host_prefix,
        space_name => space_name,
        encryption_salt => encryption_salt,
        remember_me_days => remember_me_days,
    };
    match env.render_str(&shell, ctx) {
        Ok(rendered) => rendered.into_bytes(),
        Err(err) => {
            tracing::error!("auth.html template render failed: {err}");
            shell.into_owned().into_bytes()
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct LoginForm {
    username: String,
    password: String,
    #[serde(rename = "rememberMe")]
    remember_me: String,
    from: String,
}

/// `POST /.auth` — verify credentials and, on success, set the session cookie.
/// Always answers with JSON (the page submits via `fetch`): `{"status":"ok",
/// "redirect": …}` or `{"status":"error","error": …}`. Lockout and empty-field
/// cases are JSON errors.
pub async fn handle_auth_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Form(form): Form<LoginForm>,
) -> Response {
    let Some(login) = state.login.clone() else {
        return (StatusCode::FORBIDDEN, "Authentication not enabled").into_response();
    };

    if form.username.is_empty() || form.password.is_empty() {
        return json_error("Please enter a username and password");
    }
    if login.is_locked() {
        return json_error("Too many failed attempts — please wait and try again");
    }
    if !login.authorize(&form.username, &form.password) {
        login.record_failure();
        return json_error("Invalid username and/or password");
    }

    let remember = !form.remember_me.is_empty();
    let (jwt, secs) = match login.issue_session(&form.username, remember) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!("failed to mint session JWT: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response();
        }
    };

    let host = request_host(&headers);
    let secure = is_secure_request(&headers);
    let path = format!("{}/", login.host_url_prefix());
    let opts = CookieOptions {
        path,
        max_age_secs: Some(secs as i64),
        http_only: true,
        secure,
        same_site: "Lax",
    };

    let redirect = if form.from.is_empty() {
        format!("{}/", login.host_url_prefix())
    } else {
        form.from.clone()
    };

    let mut resp = Json(json!({ "status": "ok", "redirect": redirect })).into_response();
    let cookie_name = auth_cookie_name(&host);
    append_cookie(&mut resp, &cookie_name, &jwt, &opts);
    if remember {
        append_cookie(&mut resp, "refreshLogin", "true", &opts);
    }
    resp
}

fn json_error(message: &str) -> Response {
    Json(json!({ "status": "error", "error": message })).into_response()
}

fn append_cookie(resp: &mut Response, name: &str, value: &str, opts: &CookieOptions) {
    let header = crate::auth::cookie::set_cookie_value(name, value, opts);
    if let Ok(v) = header.parse() {
        resp.headers_mut().append(SET_COOKIE, v);
    }
}

/// `GET /.logout` — clear the session + refresh cookies and 302 to `/.auth`.
pub async fn handle_logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let prefix = state
        .login
        .as_ref()
        .map(|l| l.host_url_prefix().to_string())
        .unwrap_or_else(|| state.host_url_prefix.clone());

    let host = request_host(&headers);
    let secure = is_secure_request(&headers);
    let del = CookieOptions {
        path: format!("{prefix}/"),
        max_age_secs: Some(0),
        http_only: true,
        secure,
        same_site: "Lax",
    };

    let location = format!("{prefix}/.auth");
    let mut resp = Response::builder()
        .status(StatusCode::FOUND)
        .header(axum::http::header::LOCATION, location)
        .body(axum::body::Body::empty())
        .unwrap();
    append_cookie(&mut resp, &auth_cookie_name(&host), "", &del);
    append_cookie(&mut resp, "refreshLogin", "", &del);
    resp
}

#[cfg(test)]
mod tests {
    use crate::auth::lockout::LockoutTimer;
    use crate::auth::{AuthConfig, Authenticator, JwtAuthorizer, LoginManager};
    use crate::state::AppState;
    use crate::test_support::test_state;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tower::ServiceExt;

    #[test]
    fn renders_the_real_shipped_auth_html_without_leftover_placeholders() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../client_bundle/client/.client/auth.html"
        );
        let shell = std::fs::read(path).expect("shipped auth.html must exist");
        let out = super::render_auth_page(&shell, "/prefix", "My Space", "c2FsdA==", 7);
        let html = String::from_utf8(out).unwrap();
        assert!(!html.contains("{{"), "leftover placeholder: {html}");
        assert!(html.contains(r#"<base href="/prefix/""#), "{html}");
        assert!(html.contains("My Space"), "space name rendered: {html}");
        assert!(
            html.contains(r#"base64Decode("c2FsdA==")"#),
            "salt injected: {html}"
        );
        assert!(html.contains("7 days"), "remember-me days rendered: {html}");
    }

    fn auth_state(user_pass: &str) -> Arc<AppState> {
        let authenticator = Arc::new(Authenticator::from_parts(
            vec![4u8; 32],
            "c2FsdA==".into(),
            "h".into(),
        ));
        let config = AuthConfig::try_parse(Some(user_pass), None, None, None, None)
            .unwrap()
            .unwrap();
        let lockout = LockoutTimer::from_config(config.lockout_time_secs, config.lockout_limit);
        let login = Arc::new(LoginManager::new(
            authenticator.clone(),
            config,
            lockout,
            String::new(),
        ));
        let mut s = test_state();
        s.authorizer = Some(Arc::new(JwtAuthorizer::new(authenticator, String::new())));
        s.login = Some(login);
        s.client_bundle
            .write_file(
                ".client/auth.html",
                b"<base href=\"{{ host_prefix | safe }}/\">",
                None,
            )
            .unwrap();
        Arc::new(s)
    }

    async fn post_login(state: Arc<AppState>, body: &'static str) -> axum::response::Response {
        crate::build_router(state)
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/.auth")
                    .header("host", "localhost:3000")
                    .header("content-type", "application/x-www-form-urlencoded")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn good_credentials_set_a_host_cookie_and_return_ok() {
        let resp = post_login(auth_state("alice:s3cret"), "username=alice&password=s3cret").await;
        assert_eq!(resp.status(), StatusCode::OK);
        let cookie = resp
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie.starts_with("auth_localhost_3000="), "{cookie}");
        assert!(cookie.contains("HttpOnly"));
        assert!(cookie.contains("SameSite=Lax"));
    }

    #[tokio::test]
    async fn bad_credentials_return_json_error_and_no_cookie() {
        let resp = post_login(auth_state("alice:s3cret"), "username=alice&password=nope").await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert!(resp.headers().get(axum::http::header::SET_COOKIE).is_none());
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["status"], "error");
    }

    #[tokio::test]
    async fn remember_me_also_sets_refresh_cookie() {
        let resp = post_login(
            auth_state("alice:s3cret"),
            "username=alice&password=s3cret&rememberMe=true",
        )
        .await;
        let cookies: Vec<_> = resp
            .headers()
            .get_all(axum::http::header::SET_COOKIE)
            .iter()
            .map(|v| v.to_str().unwrap().to_string())
            .collect();
        assert!(cookies
            .iter()
            .any(|c| c.starts_with("auth_localhost_3000=")));
        assert!(cookies.iter().any(|c| c.starts_with("refreshLogin=true")));
    }

    #[tokio::test]
    async fn cookie_round_trips_into_authorization() {
        let state = auth_state("alice:s3cret");
        let resp = post_login(state.clone(), "username=alice&password=s3cret").await;
        let cookie = resp
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let r = crate::build_router(state)
            .oneshot(
                Request::builder()
                    .uri("/.config")
                    .header("host", "localhost:3000")
                    .header("cookie", cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn logout_clears_cookie_and_redirects() {
        let resp = crate::build_router(auth_state("alice:s3cret"))
            .oneshot(
                Request::builder()
                    .uri("/.logout")
                    .header("host", "localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FOUND);
        assert_eq!(
            resp.headers().get(axum::http::header::LOCATION).unwrap(),
            "/.auth"
        );
        let cookie = resp
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(
            cookie.starts_with("auth_localhost_3000=;"),
            "cleared: {cookie}"
        );
        assert!(cookie.contains("Max-Age=0"));
    }
}
