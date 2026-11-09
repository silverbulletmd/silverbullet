//! `lua` and `screenshot`: tools that go through the space's client runtime
//! (`/.runtime/*`), so they only work where the caller may use it.

use tokio::time::Instant;

use axum::http::Method;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{json, Value};
use silverbullet_server::runtime::fullpage;

use server_space_tools::lua_text::{
    console_section, lint_section, list_section, value_section, EvalMode,
};
use server_space_tools::ops::{
    self, lint_values, IndexStatus, ReloadReport, RunOptions, SpaceApi, SpaceRequest, SpaceResponse,
};
use server_space_tools::page_text::{line_range, slice_lines, truncate_to_boundary};
use server_space_tools::paths::{page_to_path, path_to_page, MAX_RESULT_BYTES};

use super::api::HostApi;
use super::args::{input_schema, SPACE};
use super::reply::{Outcome, Reply, ToolError};
use super::{annotations, Tools};
use crate::tool::{Caller, ToolDef};

const CALL_TIMEOUT_SECS: u64 = 60;
/// Calls that read the index ask the server to let it catch up first.
const RUN_OPTIONS: RunOptions = RunOptions {
    timeout_secs: CALL_TIMEOUT_SECS,
    await_index: true,
};
/// A script reload after a write: the reload itself picks up the files.
const RELOAD_OPTIONS: RunOptions = RunOptions {
    timeout_secs: CALL_TIMEOUT_SECS,
    await_index: false,
};
/// What a write's result says when its script reload failed: the next runtime
/// call retries it.
const RELOAD_FAILED: &str = "The page has Space Lua or Space Style; reloading it failed, so it is \
                             retried before your next `lua` or `screenshot` call.";
const STILL_USABLE: &str = "you can still use read, write, edit and search";
const INDEX_NOTE: &str = "Note: index may not reflect your last write yet.";
/// Reloads scripts, styles and configuration: for writes to pages with Space
/// Lua or Space Style whose reload failed.
const RELOAD: &str = "system.reboot()";

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct LuaArgs {
    #[schemars(description = SPACE)]
    space: String,
    /// Space Lua code.
    code: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(super) struct ScreenshotArgs {
    #[schemars(description = SPACE)]
    space: String,
    /// Page to open before capturing; "Page#Heading" scrolls to that heading.
    page: Option<String>,
    /// CSS selector of one element.
    selector: Option<String>,
    /// Capture the whole page, not just the viewport.
    full_page: Option<bool>,
}

pub(super) fn definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "lua",
            title: "Run Space Lua",
            description: "Run Space Lua in the space's runtime and return the JSON result. An \
                expression (`1 + 1`, a `query[[...]]`) returns its value; statements run as a \
                script (use `return` for a value). Console output from the call is appended. \
                Calls can change the space; keep queries narrow and add a limit."
                .into(),
            input_schema: input_schema::<LuaArgs>(),
            annotations: annotations(false, true, false),
        },
        ToolDef {
            name: "screenshot",
            title: "Screenshot the editor",
            description:
                "Take a PNG screenshot of the space's editor in its runtime. With `page`, \
                navigate there first. `selector` (CSS) captures one element; `fullPage` stitches \
                the whole page and cannot be combined with `selector`."
                    .into(),
            input_schema: input_schema::<ScreenshotArgs>(),
            annotations: annotations(true, false, true),
        },
    ]
}

fn runtime_failure(response: &SpaceResponse) -> String {
    server_space_tools::lua_text::runtime_failure(
        response.status,
        &response.body,
        CALL_TIMEOUT_SECS,
        STILL_USABLE,
    )
}

impl Tools {
    pub(super) fn api<'a>(&'a self, caller: &'a Caller, space: &'a str) -> HostApi<'a> {
        HostApi {
            host: self.host.as_ref(),
            caller,
            space,
        }
    }

    /// Degraded mode: without a usable runtime the tool says so instead of failing.
    fn ensure_runtime(&self, caller: &Caller, space: &str) -> Result<(), ToolError> {
        let unusable = self
            .host
            .spaces(caller)
            .into_iter()
            .any(|s| s.id == space && !s.runtime);
        if unusable {
            return Err(format!(
                "The runtime API is not available for you in this space; {STILL_USABLE}."
            )
            .into());
        }
        Ok(())
    }

    /// Retries the script reload of a recent write whose reload failed,
    /// returning a note when that fails again. The server catches the index up
    /// with file changes itself (`X-Await-Index`).
    async fn retry_pending_reload(&self, caller: &Caller, space: &str) -> Option<String> {
        if !self.reload_pending(&caller.username, space) {
            return None;
        }
        let started = Instant::now();
        let api = self.api(caller, space);
        let (outcome, _) = ops::eval(
            &api,
            RELOAD,
            EvalMode::Expression,
            RELOAD_OPTIONS,
            STILL_USABLE,
        )
        .await;
        match outcome {
            Ok(_) => {
                // Writes made while reloading may have missed the file listing
                self.reloaded_at(&caller.username, space, started);
                None
            }
            Err(_) => Some(INDEX_NOTE.to_owned()),
        }
    }

    /// After a write to a page with Space Lua or Space Style: reloads them
    /// now, so the open editor does not run stale scripts until the next
    /// runtime call. Returns the note for the write's result.
    pub(super) async fn reload_after_write(
        &self,
        caller: &Caller,
        space: &str,
        page: &str,
    ) -> String {
        self.reload_pending_since(&caller.username, space, Instant::now());
        if self.ensure_runtime(caller, space).is_err() {
            return ReloadReport::NoRuntime.note(RELOAD_FAILED);
        }
        let started = Instant::now();
        let report = ops::reload_after_write(&self.api(caller, space), page, RELOAD_OPTIONS).await;
        if !matches!(report, ReloadReport::Failed | ReloadReport::NoRuntime) {
            // Writes made while reloading may have missed the file listing
            self.reloaded_at(&caller.username, space, started);
        }
        report.note(RELOAD_FAILED)
    }

    /// `read` with `rendered`: the page with its directives evaluated, and its
    /// lint problems.
    pub(super) async fn read_rendered(
        &self,
        caller: &Caller,
        space: &str,
        page: &str,
        offset: Option<usize>,
        limit: Option<usize>,
    ) -> Outcome {
        self.ensure_runtime(caller, space)?;
        let name = path_to_page(&page_to_path(page)?);
        let index_note = self.retry_pending_reload(caller, space).await;
        let ops::Rendered {
            text: rendered,
            had_html,
            lint,
            index,
        } = ops::read_rendered(&self.api(caller, space), &name, RUN_OPTIONS, STILL_USABLE).await?;
        let lines: Vec<&str> = rendered.lines().collect();
        let range = line_range(lines.len(), offset, limit, "rendered page")?;
        let body = if offset.is_some() || limit.is_some() {
            slice_lines(&lines, range, true, usize::MAX).text
        } else {
            rendered.clone()
        };
        let truncated = body.len() > MAX_RESULT_BYTES;
        let mut sections = vec![truncate_to_boundary(&body, MAX_RESULT_BYTES).to_owned()];
        if truncated {
            sections.push(format!(
                "[rendered page truncated at {MAX_RESULT_BYTES} bytes; {} lines in all, \
                 continue with offset and limit]",
                lines.len()
            ));
        }
        if had_html {
            sections.push(
                "Widgets are shown as their text; use `screenshot` to see how they look."
                    .to_owned(),
            );
        }
        let problems = lint_values(&lint);
        sections.push(lint_section(&problems));
        sections.extend(index_note);
        sections.extend(index.note().map(str::to_owned));
        Ok(Reply::text(sections.join("\n\n")).with_meta(json!({
            "page": name,
            "rendered": true,
            "problems": problems.len(),
            "lines": lines.len(),
            "truncated": truncated,
        })))
    }

    pub(super) async fn lua(&self, caller: &Caller, args: LuaArgs) -> Outcome {
        let LuaArgs { space, code } = args;
        if code.trim().is_empty() {
            return Err("\"code\" must not be empty".into());
        }
        self.ensure_runtime(caller, &space)?;
        let index_note = self.retry_pending_reload(caller, &space).await;

        let run = ops::run_lua(&self.api(caller, &space), &code, RUN_OPTIONS, STILL_USABLE).await;
        let outcome = run.outcome;
        let console: Vec<Value> = run.console.iter().map(|e| json!(e)).collect();

        let console_section = console_section(&console);
        let mut structured = json!({});
        let value = match outcome {
            Ok(Value::Array(rows)) => list_section(rows, &mut structured),
            Ok(value) => value_section(value, &mut structured),
            Err(message) => {
                let sections: Vec<String> = [message].into_iter().chain(console_section).collect();
                return Err(sections.join("\n\n").into());
            }
        };
        let mut sections = vec![value];
        if let Some(section) = console_section {
            sections.push(section);
            structured["console"] = json!(console);
        }
        sections.extend(index_note);
        sections.extend(run.index.note().map(str::to_owned));
        Ok(Reply::text(sections.join("\n\n")).with_structured(structured))
    }

    pub(super) async fn screenshot(&self, caller: &Caller, args: ScreenshotArgs) -> Outcome {
        let ScreenshotArgs {
            space,
            page,
            selector,
            full_page,
        } = args;
        if page.as_ref().is_some_and(|p| p.trim().is_empty()) {
            return Err("\"page\" must not be empty".into());
        }
        self.ensure_runtime(caller, &space)?;
        let mut notes: Vec<String> = Vec::new();
        notes.extend(self.retry_pending_reload(caller, &space).await);

        let api = self.api(caller, &space);
        let mut page_note = None;
        if let Some(page) = &page {
            page_note = ops::open_page(&api, page, RUN_OPTIONS, STILL_USABLE).await?;
        }

        let mut query = Vec::new();
        if let Some(selector) = selector.filter(|s| !s.trim().is_empty()) {
            query.push(format!(
                "selector={}",
                utf8_percent_encode(&selector, NON_ALPHANUMERIC)
            ));
        }
        if full_page.unwrap_or(false) {
            query.push("fullPage=1".to_owned());
        }
        let path = if query.is_empty() {
            "/.runtime/screenshot".to_owned()
        } else {
            format!("/.runtime/screenshot?{}", query.join("&"))
        };
        let response = api
            .send(SpaceRequest {
                method: Method::GET,
                path_and_query: path,
                body: Vec::new(),
                headers: ops::runtime_headers(RUN_OPTIONS),
            })
            .await?;
        if !response.status.is_success() {
            return Err(runtime_failure(&response).into());
        }
        notes.extend(
            IndexStatus::from_headers(&response.headers)
                .note()
                .map(str::to_owned),
        );
        notes.extend(page_note);
        if response.headers.contains_key("x-screenshot-truncated") {
            notes.push(
                "The screenshot was truncated: the page is longer than the capture limit, so the \
                 image stops before its end."
                    .to_owned(),
            );
        }
        // A full page is one narrow strip; viewers shrink it until it is
        // unreadable, so it goes out in parts no taller than 1.5 widths.
        let parts = match full_page {
            Some(true) => fullpage::bands(&response.body, 1.5).unwrap_or_default(),
            _ => Vec::new(),
        };
        let mut reply = if parts.len() > 1 {
            notes.insert(
                0,
                format!("The full page in {} parts, top to bottom.", parts.len()),
            );
            let mut parts = parts.into_iter();
            let mut reply = Reply::image(parts.next().unwrap_or_default(), "image/png");
            for part in parts {
                reply.push_image(part, "image/png");
            }
            reply
        } else {
            Reply::image(response.body, "image/png")
        };
        if !notes.is_empty() {
            reply.push_text(notes.join("\n"));
        }
        Ok(reply)
    }
}
