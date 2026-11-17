//! Slides browser sessions on use: any request carrying the host-wide
//! `auth_<host>` cookie of a session that is due gets a fresh cookie with a
//! later expiry.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::Router;

use crate::auth::cookie::set_cookie_value;
use crate::auth::{
    cookie_value, is_secure_request, request_host, scoped_auth_cookie_name, Authenticator,
    CookieOptions,
};
use crate::multi::users::UserStore;

pub struct SessionRenewal {
    pub authenticator: Arc<Authenticator>,
    pub users: Arc<UserStore>,
    /// Idle window for sessions recorded before sessions slid.
    pub default_idle_secs: u64,
}

/// Wraps `router` so every response may carry a renewed session cookie.
pub fn with_session_renewal(router: Router, renewal: Arc<SessionRenewal>) -> Router {
    router.layer(middleware::from_fn_with_state(
        renewal,
        renew_browser_session,
    ))
}

pub async fn renew_browser_session(
    State(renewal): State<Arc<SessionRenewal>>,
    req: Request,
    next: Next,
) -> Response {
    let headers = req.headers().clone();
    let name = scoped_auth_cookie_name(&request_host(&headers), "");
    let token = cookie_value(&headers, &name);
    let mut response = next.run(req).await;
    let Some(token) = token else {
        return response;
    };
    if response.status() == StatusCode::UNAUTHORIZED
        || sets_cookie(&response, &name)
        || publicly_cacheable(&response)
    {
        return response;
    }
    // Renewal must never outlast a password change, disabled account or
    // "sign out everywhere": the same check every request already passes.
    let Ok(claims) = renewal.authenticator.verify_browser_jwt(&token) else {
        return response;
    };
    if !renewal
        .users
        .session_is_current(&claims.username, claims.credential_version.as_deref())
    {
        return response;
    }
    let renewal_auth = renewal.clone();
    let renewed = tokio::task::spawn_blocking(move || {
        renewal_auth
            .authenticator
            .renew_browser_jwt(&token, renewal_auth.default_idle_secs)
    })
    .await
    .ok()
    .flatten();
    let Some(renewed) = renewed else {
        return response;
    };
    let options = CookieOptions {
        path: "/".into(),
        max_age_secs: renewed.max_age_secs.map(|secs| secs as i64),
        http_only: true,
        secure: is_secure_request(&headers),
        same_site: "Lax",
    };
    if let Ok(value) = set_cookie_value(&name, &renewed.jwt, &options).parse() {
        response.headers_mut().append(header::SET_COOKIE, value);
    }
    response
}

/// A shared cache may store such a response, `Set-Cookie` included, and hand
/// the session to someone else. The next private request renews instead.
fn publicly_cacheable(response: &Response) -> bool {
    response
        .headers()
        .get_all(header::CACHE_CONTROL)
        .iter()
        .any(|value| {
            value
                .to_str()
                .is_ok_and(|v| v.to_ascii_lowercase().contains("public"))
        })
}

/// Whether the handler already set (or cleared) this cookie, as login and
/// logout do.
fn sets_cookie(response: &Response, name: &str) -> bool {
    let prefix = format!("{name}=");
    response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .any(|value| value.to_str().is_ok_and(|v| v.starts_with(&prefix)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Authenticator;
    use crate::multi::users::{Profile, UserStore};
    use axum::body::Body;
    use axum::http::{header, Request, StatusCode};
    use axum::routing::{get, post};
    use axum::Router;
    use std::sync::Arc;
    use tower::ServiceExt;

    const DAY: u64 = 86_400;

    struct Fixture {
        _dir: tempfile::TempDir,
        users: Arc<UserStore>,
        authenticator: Arc<Authenticator>,
        router: Router,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let users = UserStore::create_empty(dir.path()).unwrap();
        users
            .create_user("river", "secret", false, Profile::default())
            .unwrap();
        let authenticator = Arc::new(Authenticator::in_memory());
        let router = Router::new()
            .route("/page", get(|| async { "ok" }))
            .route("/denied", get(|| async { StatusCode::UNAUTHORIZED }))
            .route(
                "/asset.js",
                get(|| async {
                    (
                        [(header::CACHE_CONTROL, "public, max-age=31536000, immutable")],
                        "asset",
                    )
                }),
            )
            .route(
                "/logout",
                post(|| async {
                    (
                        [(header::SET_COOKIE, "auth_notes_test=; Path=/; Max-Age=0")],
                        "bye",
                    )
                }),
            );
        let router = with_session_renewal(
            router,
            Arc::new(SessionRenewal {
                authenticator: authenticator.clone(),
                users: users.clone(),
                default_idle_secs: 30 * DAY,
            }),
        );
        Fixture {
            _dir: dir,
            users,
            authenticator,
            router,
        }
    }

    impl Fixture {
        /// A cookie for a session that started `age` seconds ago.
        fn cookie(&self, shared: bool, age: u64) -> String {
            let idle = if shared { 12 * 3600 } else { 30 * DAY };
            let first = self
                .authenticator
                .issue_browser_jwt(
                    "river",
                    self.users.credential_version("river"),
                    None,
                    idle,
                    shared,
                )
                .unwrap();
            let claims = self.authenticator.verify_browser_jwt(&first).unwrap();
            let id = claims.session_id.unwrap();
            self.authenticator
                .browser_sessions()
                .unwrap()
                .backdate_for_test(&id, age);
            let jwt = self
                .authenticator
                .issue_browser_jwt_for_session(
                    "river",
                    self.users.credential_version("river"),
                    &id,
                    u64::MAX,
                )
                .unwrap();
            format!("auth_notes_test={jwt}")
        }

        async fn send(&self, method: &str, uri: &str, cookie: &str) -> Vec<String> {
            let response = self
                .router
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(uri)
                        .header("host", "notes.test")
                        .header(header::COOKIE, cookie)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            response
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .map(|v| v.to_str().unwrap().to_string())
                .collect()
        }
    }

    fn max_age(cookie: &str) -> Option<u64> {
        cookie
            .split(';')
            .find_map(|part| part.trim().strip_prefix("Max-Age="))
            .map(|v| v.parse().unwrap())
    }

    #[tokio::test]
    async fn an_old_session_gets_a_renewed_cookie_on_any_request() {
        let f = fixture();
        let old = f.cookie(false, 2 * DAY);
        let cookies = f.send("GET", "/page", &old).await;
        assert_eq!(cookies.len(), 1, "{cookies:?}");
        let cookie = &cookies[0];
        assert!(cookie.starts_with("auth_notes_test="), "{cookie}");
        assert!(cookie.contains("Path=/"), "{cookie}");
        assert!(cookie.contains("HttpOnly"), "{cookie}");
        assert!(cookie.contains("SameSite=Lax"), "{cookie}");
        assert!(max_age(cookie).unwrap().abs_diff(30 * DAY) <= 2, "{cookie}");
        let renewed = cookie.split(';').next().unwrap().split_once('=').unwrap().1;
        let old_exp = f
            .authenticator
            .verify_browser_jwt(old.split_once('=').unwrap().1)
            .unwrap()
            .exp;
        assert!(f.authenticator.verify_browser_jwt(renewed).unwrap().exp > old_exp);
    }

    #[tokio::test]
    async fn a_fresh_session_gets_no_cookie() {
        let f = fixture();
        let fresh = f.cookie(false, 0);
        assert!(f.send("GET", "/page", &fresh).await.is_empty());
    }

    #[tokio::test]
    async fn a_shared_session_is_renewed_as_a_browser_session_cookie() {
        let f = fixture();
        let old = f.cookie(true, 2 * 3600);
        let cookies = f.send("GET", "/page", &old).await;
        assert_eq!(cookies.len(), 1, "{cookies:?}");
        assert_eq!(max_age(&cookies[0]), None, "{}", cookies[0]);
    }

    #[tokio::test]
    async fn a_password_change_is_not_undone_by_renewal() {
        let f = fixture();
        let old = f.cookie(false, 2 * DAY);
        f.users.set_password("river", "changed-secret").unwrap();
        assert!(f.send("GET", "/page", &old).await.is_empty());
    }

    #[tokio::test]
    async fn a_refused_request_is_not_renewed() {
        let f = fixture();
        let old = f.cookie(false, 2 * DAY);
        assert!(f.send("GET", "/denied", &old).await.is_empty());
    }

    /// A shared cache could hand a publicly cacheable response, cookie and
    /// all, to someone else.
    #[tokio::test]
    async fn a_publicly_cacheable_response_never_carries_a_renewal() {
        let f = fixture();
        let old = f.cookie(false, 2 * DAY);
        assert!(f.send("GET", "/asset.js", &old).await.is_empty());
        assert_eq!(f.send("GET", "/page", &old).await.len(), 1);
    }

    #[tokio::test]
    async fn logout_response_is_not_followed_by_a_renewal() {
        let f = fixture();
        let old = f.cookie(false, 2 * DAY);
        let cookies = f.send("POST", "/logout", &old).await;
        assert_eq!(cookies.len(), 1, "{cookies:?}");
        assert_eq!(max_age(&cookies[0]), Some(0));
    }
}
