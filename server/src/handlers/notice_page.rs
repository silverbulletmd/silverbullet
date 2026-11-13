//! A server-rendered page in the standalone shell (the login page's header,
//! stylesheet and light/dark theme) for answers that have no client screen of
//! their own: an address with no space, or a single-space server's Dashboard.

use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use minijinja::{context, AutoEscape, Environment};

const TEMPLATE: &str = include_str!("../../../client/html/notice.html");

pub enum NoticeMessage<'a> {
    Text(&'a str),
    MissingSpace { path: &'a str },
}

/// What the page says and where it points.
pub struct NoticePage<'a> {
    /// Where the client bundle's `.client/` files are served, ending in `/`
    /// (`/.dashboard/assets/` in multi-space mode, `<prefix>/.client/` for a
    /// space).
    pub assets: &'a str,
    pub title: &'a str,
    pub message: NoticeMessage<'a>,
    /// A primary button: label and href.
    pub action: Option<(&'a str, &'a str)>,
}

impl NoticePage<'_> {
    fn render(&self) -> Result<String, minijinja::Error> {
        let (message, missing_path) = match self.message {
            NoticeMessage::Text(text) => (Some(text), None),
            NoticeMessage::MissingSpace { path } => (None, Some(path)),
        };
        let mut env = Environment::new();
        env.set_auto_escape_callback(|_| AutoEscape::Html);
        env.render_str(
            TEMPLATE,
            context! {
                assets => self.assets,
                title => self.title,
                message,
                missing_path,
                action => self.action,
            },
        )
    }

    pub fn into_response(self, status: StatusCode) -> Response {
        match self.render() {
            Ok(body) => (status, Html(body)).into_response(),
            Err(err) => {
                tracing::error!("notice.html template render failed: {err}");
                (status, self.title.to_owned()).into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_the_standalone_shell_and_escapes_its_inputs() {
        let html = NoticePage {
            assets: "/.dashboard/assets/",
            title: "No space at this address",
            message: NoticeMessage::MissingSpace { path: "/<x>\"/" },
            action: Some(("Open the Dashboard", "/.dashboard/")),
        }
        .render()
        .unwrap();
        assert!(html.contains("name=\"viewport\""));
        assert!(html.contains("<body class=\"sb-standalone sb-page\">"));
        assert!(html.contains("href=\"&#x2f;.dashboard&#x2f;assets&#x2f;app.css\""));
        assert!(html.contains("<code>&#x2f;&lt;x&gt;&quot;&#x2f;</code>"));
        assert!(!html.contains("<x>"));
        assert!(html.contains("class=\"sb-button-primary\" href=\"&#x2f;.dashboard&#x2f;\""));
    }
}
