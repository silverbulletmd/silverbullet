mod api;
mod args;
mod help;
mod pages;
mod reply;
mod runtime;
mod search;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::time::Instant;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::host::{McpHost, SpaceInfo};
use crate::tool::{Caller, ExtraTool, ToolDef, ToolResult, ToolSet};
use args::parse;
pub use args::SPACE as SPACE_DESCRIPTION;
use help::PathHelpArgs;
pub use pages::PAGE as PAGE_DESCRIPTION;
use reply::{into_result, Outcome, ToolError};
use server_space_tools::skills::{bundled_skills, Skill};
use server_space_tools::spaces::{
    ambiguous_message, not_available_message, resolve_space, SpaceLookupError, SpaceRef,
};

/// How long a failed script reload is retried before runtime calls.
const PENDING_RELOAD_WINDOW: Duration = Duration::from_secs(30);

/// Per (user, space): when each write to a page with scripts happened, until
/// a script reload has succeeded since.
type PendingReloads = HashMap<(String, String), Vec<Instant>>;

pub struct Tools {
    host: Arc<dyn McpHost>,
    pending_reloads: Mutex<PendingReloads>,
    bundled: Vec<Skill>,
    /// Markdown of each bundled skill page, by page name, so `help` can
    /// return one without a space.
    bundled_text: HashMap<String, String>,
    instructions: String,
    version: String,
    extra: Vec<Arc<dyn ExtraTool>>,
}

impl Tools {
    /// `version` is the server build (`git describe` style); it picks the
    /// documentation channel and is reported as `serverInfo.version`.
    pub fn new(host: Arc<dyn McpHost>, version: &str) -> Self {
        Self {
            host,
            pending_reloads: Mutex::new(HashMap::new()),
            bundled: Vec::new(),
            bundled_text: HashMap::new(),
            instructions: crate::instructions::instructions(version),
            version: version.to_owned(),
            extra: Vec::new(),
        }
    }

    /// Adds a tool of the embedder's own. Its name must differ from every
    /// other tool's: a clash would list it twice and shadow the other.
    pub fn with_tool(mut self, tool: Arc<dyn ExtraTool>) -> Self {
        debug_assert!(
            !self
                .tools()
                .iter()
                .any(|existing| existing.name == tool.def().name),
            "tool \"{}\" is already defined",
            tool.def().name
        );
        self.extra.push(tool);
        self
    }

    /// Replaces the default instructions.
    pub fn with_instructions(mut self, instructions: String) -> Self {
        self.instructions = instructions;
        self
    }

    /// The embedded `Library/Std` pages (`(path, bytes)`): the skills every
    /// space has unless its own page of the same name replaces one.
    pub fn with_bundled_pages(mut self, pages: Vec<(String, Vec<u8>)>) -> Self {
        self.bundled = bundled_skills(pages.iter().cloned());
        self.bundled_text = pages
            .into_iter()
            .filter_map(|(path, bytes)| {
                let page = server_space_tools::paths::path_to_page(&path);
                self.bundled
                    .iter()
                    .any(|s| s.page == page)
                    .then(|| Some((page, String::from_utf8(bytes).ok()?)))
                    .flatten()
            })
            .collect();
        self
    }

    /// Remembers a write to a page with scripts until a reload succeeds.
    fn reload_pending_since(&self, user: &str, space: &str, written: Instant) {
        let mut pending = self
            .pending_reloads
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        prune(&mut pending);
        pending
            .entry((user.to_owned(), space.to_owned()))
            .or_default()
            .push(written);
    }

    /// Forgets the writes a reload that started at `at` picked up.
    fn reloaded_at(&self, user: &str, space: &str, at: Instant) {
        let mut pending = self
            .pending_reloads
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(writes) = pending.get_mut(&(user.to_owned(), space.to_owned())) {
            writes.retain(|written| *written >= at);
        }
        prune(&mut pending);
    }

    /// Whether a recent write to a page with Space Lua or Space Style still
    /// waits for a successful reload.
    fn reload_pending(&self, user: &str, space: &str) -> bool {
        let mut pending = self
            .pending_reloads
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        prune(&mut pending);
        pending.contains_key(&(user.to_owned(), space.to_owned()))
    }

    /// The id of the caller's space that `wanted` names: an exact id wins,
    /// then a name (ignoring case) that only one of the caller's spaces has.
    pub fn resolve_space_id(&self, caller: &Caller, wanted: &str) -> Option<String> {
        resolve_space(&space_refs(&self.host.spaces(caller)), wanted).ok()
    }

    /// Lets `space` name a space as well as give its id (see
    /// [`Self::resolve_space_id`]). Anything else is refused with the spaces
    /// the caller can use.
    fn resolve_space(&self, caller: &Caller, args: &mut Value) -> Result<(), ToolError> {
        let Some(wanted) = args.get("space").and_then(Value::as_str) else {
            return Ok(());
        };
        let spaces = space_refs(&self.host.spaces(caller));
        match resolve_space(&spaces, wanted) {
            Ok(id) => {
                args["space"] = json!(id);
                Ok(())
            }
            Err(SpaceLookupError::NotFound) => Err(not_available_message(wanted, &spaces).into()),
            Err(SpaceLookupError::Ambiguous(several)) => {
                Err(ambiguous_message(wanted, &several).into())
            }
        }
    }
}

fn space_refs(spaces: &[SpaceInfo]) -> Vec<SpaceRef> {
    spaces
        .iter()
        .map(|s| SpaceRef {
            id: s.id.clone(),
            name: s.name.clone(),
        })
        .collect()
}

fn prune(pending: &mut PendingReloads) {
    let now = Instant::now();
    pending.retain(|_, writes| {
        writes.retain(|written| now.duration_since(*written) < PENDING_RELOAD_WINDOW);
        !writes.is_empty()
    });
}

#[async_trait]
impl ToolSet for Tools {
    fn tools(&self) -> Vec<ToolDef> {
        let mut tools = help::definitions(self.host.locator().is_some());
        tools.extend(pages::definitions());
        tools.extend(search::definitions());
        tools.extend(runtime::definitions());
        tools.extend(self.extra.iter().map(|tool| tool.def()));
        tools
    }

    fn instructions(&self) -> String {
        self.instructions.clone()
    }

    fn version(&self) -> String {
        self.version.clone()
    }

    async fn call(&self, caller: &Caller, name: &str, args: Value) -> ToolResult {
        if let Some(tool) = self.extra.iter().find(|tool| tool.def().name == name) {
            return tool.call(caller, args).await;
        }
        into_result(self.dispatch(caller, name, args).await)
    }
}

impl Tools {
    async fn dispatch(&self, caller: &Caller, name: &str, mut args: Value) -> Outcome {
        self.resolve_space(caller, &mut args)?;
        match name {
            "help" => match self.host.locator() {
                None => self.help(caller, parse(args)?, None).await,
                Some(locator) => {
                    let (args, path) = parse::<PathHelpArgs>(args)?.split();
                    let path = match path {
                        Some(path) => Some({
                            let located = locator.locate(caller, &path)?;
                            (path, located)
                        }),
                        None => None,
                    };
                    self.help(caller, args, path).await
                }
            },
            "read" => self.read(caller, parse(args)?).await,
            "write" => self.write(caller, parse(args)?).await,
            "edit" => self.edit(caller, parse(args)?).await,
            "search" => self.search(caller, parse(args)?).await,
            "lua" => self.lua(caller, parse(args)?).await,
            "screenshot" => self.screenshot(caller, parse(args)?).await,
            _ => Err(format!("unknown tool \"{name}\"").into()),
        }
    }
}

/// `T`'s JSON Schema as a tool's `inputSchema`, as the built-in tools build
/// theirs, for an [`ExtraTool`] whose arguments are a struct.
pub fn tool_input_schema<T: schemars::JsonSchema>() -> Value {
    args::input_schema::<T>()
}

/// Parses an [`ExtraTool`]'s arguments as the built-in tools do: the error
/// names the argument at fault (give `T` `deny_unknown_fields` to refuse
/// unlisted ones).
pub fn parse_tool_args<T: serde::de::DeserializeOwned>(args: Value) -> Result<T, String> {
    parse(args).map_err(|e| e.message().to_owned())
}

pub(crate) fn annotations(read_only: bool, destructive: bool, idempotent: bool) -> Value {
    if read_only {
        json!({ "readOnlyHint": true })
    } else {
        json!({ "readOnlyHint": false, "destructiveHint": destructive, "idempotentHint": idempotent })
    }
}
