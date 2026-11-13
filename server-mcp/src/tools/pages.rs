use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use server_space_tools::edit::{unified_diff, Edit, EditOpts};
use server_space_tools::ops::pages::{self, EditPageError, FileError, Precondition};
use server_space_tools::page_text::{conflict_message, line_range, outline, slice_lines};
use server_space_tools::paths::{page_to_path, path_to_page, MAX_RESULT_BYTES};

use super::args::{input_schema, Count, SPACE};
use super::reply::{Outcome, Reply, ToolError};
use super::{annotations, Tools};
use crate::tool::{Caller, ToolDef};

const LIST_LIMIT: usize = 500;
/// Pages one `read` with `pages` takes.
const MAX_PAGES_PER_READ: usize = 20;
/// Up to this many pages, a listing names them all.
const FLAT_LIMIT: usize = 60;
const MAX_IMAGE_BYTES: usize = MAX_RESULT_BYTES * 7;
/// Shared by the tools that take a page.
pub const PAGE: &str = "Page name, e.g. \"Projects/Garden Plan\". The .md extension is optional, except for a name ending in a dot and letters or digits (\"Notes v1.2\"), which otherwise names a document.";
const IF_REVISION: &str =
    "Revision from a previous read; the call fails instead of overwriting a newer change.";
const WRITE_IF_REVISION: &str =
    "Revision from a plain (not `rendered`) `read`. Required to replace a page; omit it to create one.";

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ReadArgs {
    #[schemars(description = SPACE)]
    space: String,
    #[schemars(description = PAGE)]
    page: Option<String>,
    /// Several whole pages, instead of `page`.
    #[schemars(length(min = 1, max = MAX_PAGES_PER_READ))]
    pages: Option<Vec<String>>,
    /// First line to return (1-based).
    offset: Option<Count>,
    /// Maximum number of lines.
    limit: Option<Count>,
    /// Evaluate the page as it displays, and list lint problems.
    rendered: Option<bool>,
    /// Headings, code blocks and Lua functions with line numbers, instead of the text.
    outline: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(super) struct WriteArgs {
    #[schemars(description = SPACE)]
    space: String,
    #[schemars(description = PAGE)]
    page: String,
    /// Full Markdown content of the page.
    content: String,
    #[schemars(description = WRITE_IF_REVISION)]
    if_revision: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(super) struct EditArgs {
    #[schemars(description = SPACE)]
    space: String,
    #[schemars(description = PAGE)]
    page: String,
    #[schemars(length(min = 1))]
    edits: Vec<EditArg>,
    /// Return the diff without writing.
    dry_run: Option<bool>,
    #[schemars(description = IF_REVISION)]
    if_revision: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct EditArg {
    old_text: String,
    new_text: String,
}

pub(super) fn definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "read",
            title: "Read a page",
            description: "Read a page's Markdown and revision. `offset`/`limit` read a numbered \
                slice; `outline` maps a long page first; `rendered` shows it as displayed, with lint \
                problems (needs the runtime); `pages` reads several; a name ending in \"/\" lists \
                the pages under it. Output is capped."
                .into(),
            input_schema: input_schema::<ReadArgs>(),
            annotations: annotations(true, false, true),
        },
        ToolDef {
            name: "write",
            title: "Write a page",
            description: "Create a page, or replace one entirely. Without `ifRevision` it only \
                creates. To change part of a page use `edit` instead."
                .into(),
            input_schema: input_schema::<WriteArgs>(),
            annotations: annotations(false, false, true),
        },
        ToolDef {
            name: "edit",
            title: "Edit a page",
            description: "Replace exact text in a page. Each edit's oldText must match exactly once \
                in the page as read (line endings are normalized), and edits must not overlap; all \
                apply or none does. With dryRun the unified diff is returned and nothing is written."
                .into(),
            input_schema: input_schema::<EditArgs>(),
            annotations: annotations(false, false, false),
        },
    ]
}

/// What `read` returns for a page besides its text. In `structuredContent`
/// it travels together with the text (see [`page_structured`]).
#[derive(Serialize)]
pub(super) struct PageMeta {
    page: String,
    revision: String,
    lines: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outline: Option<bool>,
}

#[derive(Serialize)]
pub(super) struct Listing {
    prefix: String,
    total: usize,
    pages: Vec<String>,
    folders: Vec<Folder>,
}

#[derive(Serialize)]
pub(super) struct Folder {
    name: String,
    pages: usize,
}

/// One page as `read` shows it.
pub(super) enum PageOutput {
    Text { text: String, meta: PageMeta },
    Image { bytes: Vec<u8>, mime: &'static str },
    Listing { text: String, listing: Listing },
}

impl From<PageOutput> for Reply {
    fn from(output: PageOutput) -> Self {
        match output {
            PageOutput::Text { text, meta } => {
                // In its own block, so the first stays exactly the page.
                let revision = format!("[revision {}]", meta.revision);
                let structured = page_structured(&text, meta);
                let mut reply = Reply::text(text).with_structured(structured);
                reply.push_text(revision);
                reply
            }
            PageOutput::Image { bytes, mime } => Reply::image(bytes, mime),
            PageOutput::Listing { text, listing } => Reply::text(text).with_meta(listing),
        }
    }
}

/// `structuredContent` for a page: its metadata plus the same `text` as the
/// `content` block. Some clients (Claude Code among them) show only
/// `structuredContent` when it is present, so it must carry the page itself.
fn page_structured(text: &str, meta: PageMeta) -> Value {
    let mut structured = json!(meta);
    structured["text"] = json!(text);
    structured
}

/// `error` of a request for `page` (at `path`) as the tool reports it;
/// `action` names the request.
fn file_error(error: FileError, action: &str, page: &str, path: &str) -> ToolError {
    ToolError::new(match error {
        FileError::NotFound => not_found(page),
        FileError::Conflict { expected, current } => conflict_message(
            &path_to_page(path),
            &expected,
            current.as_deref(),
            "Please re-read the page and retry.",
        ),
        FileError::Status { status, body } => {
            format!("{action} failed: HTTP {} {body}", status.as_u16())
        }
        FileError::Invalid(e) => format!("{action} returned invalid JSON: {e}"),
        FileError::Transport(e) => e,
        FileError::Exists => format!(
            "page \"{}\" already exists; nothing was written. To replace it, `read` it (without \
             `rendered`) and pass its revision as `ifRevision`, or change part of it with `edit`.",
            path_to_page(path)
        ),
    })
}

pub(super) fn not_found(page: &str) -> String {
    format!("page \"{page}\" not found")
}

fn image_mime(path: &str, content_type: &str) -> Option<&'static str> {
    let by_type = content_type.split(';').next().unwrap_or_default().trim();
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match (by_type, ext.as_str()) {
        ("image/png", _) | (_, "png") => Some("image/png"),
        ("image/jpeg", _) | (_, "jpg" | "jpeg") => Some("image/jpeg"),
        ("image/gif", _) | (_, "gif") => Some("image/gif"),
        ("image/webp", _) | (_, "webp") => Some("image/webp"),
        _ => None,
    }
}

/// How `read` shows one page.
#[derive(Default)]
pub(super) struct PageView {
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    pub outline: bool,
}

impl Tools {
    pub(super) async fn read(&self, caller: &Caller, args: ReadArgs) -> Outcome {
        let ReadArgs {
            space,
            page,
            pages,
            offset,
            limit,
            rendered,
            outline,
        } = args;
        if let Some(pages) = pages {
            if page.is_some() {
                return Err("pass either `page` or `pages`, not both".into());
            }
            let sliced = [
                ("offset", offset.is_some()),
                ("limit", limit.is_some()),
                ("rendered", rendered.is_some()),
            ];
            if let Some((option, _)) = sliced.iter().find(|(_, set)| *set) {
                return Err(format!(
                    "`{option}` works with `page` only; `pages` reads whole pages"
                )
                .into());
            }
            return self.read_several(caller, &space, &pages).await;
        }
        let Some(page) = page else {
            return Err("\"page\" is required and must be a string".into());
        };
        let offset = offset.map(|Count(n)| n);
        let limit = limit.map(|Count(n)| n);
        if !page.ends_with('/') && rendered.unwrap_or(false) {
            return self
                .read_rendered(caller, &space, &page, offset, limit)
                .await;
        }
        let view = PageView {
            offset,
            limit,
            outline: outline.unwrap_or(false),
        };
        match self.read_page(caller, &space, &page, view).await? {
            Some(output) => Ok(output.into()),
            None => Err(not_found(&page).into()),
        }
    }

    /// Page `page` as `read` shows it, or the listing of a name ending in
    /// "/"; `None` when there is no such page.
    pub(super) async fn read_page(
        &self,
        caller: &Caller,
        space: &str,
        page: &str,
        PageView {
            offset,
            limit,
            outline: show_outline,
        }: PageView,
    ) -> Result<Option<PageOutput>, ToolError> {
        if page.ends_with('/') {
            return self.list_pages(caller, space, page).await.map(Some);
        }
        let path = page_to_path(page)?;
        let file = match pages::read_file(&self.api(caller, space), &path).await {
            Ok(file) => file,
            Err(FileError::NotFound) => return Ok(None),
            Err(e) => return Err(file_error(e, "read", page, &path)),
        };
        if !path.ends_with(".md") {
            let content_type = &file.content_type;
            if let Some(mime) = image_mime(&path, content_type) {
                if file.bytes.len() > MAX_IMAGE_BYTES {
                    return Err(format!(
                        "image \"{path}\" is {} bytes, over the {MAX_IMAGE_BYTES} byte limit; use `screenshot` or a smaller file.",
                        file.bytes.len()
                    )
                    .into());
                }
                return Ok(Some(PageOutput::Image {
                    bytes: file.bytes,
                    mime,
                }));
            }
            if content_type.starts_with("image/") || std::str::from_utf8(&file.bytes).is_err() {
                return Err(format!(
                    "\"{path}\" is a binary document ({} bytes, {content_type}); it cannot be returned as text. Use `lua` to process it.",
                    file.bytes.len()
                )
                .into());
            }
        }

        let revision = file.revision;
        let content = String::from_utf8_lossy(&file.bytes);
        let lines: Vec<&str> = content.lines().collect();
        let total = lines.len();
        let mut meta = PageMeta {
            page: path_to_page(&path),
            revision,
            lines: total,
            truncated: None,
            outline: None,
        };
        if show_outline {
            meta.outline = Some(true);
            return Ok(Some(PageOutput::Text {
                text: outline(&lines),
                meta,
            }));
        }
        let numbered_output = offset.is_some() || limit.is_some();
        let range = line_range(total, offset, limit, "page")?;
        let (mut text, next_line) = if !numbered_output && content.len() <= MAX_RESULT_BYTES {
            (content.to_string(), None)
        } else {
            let slice = slice_lines(&lines, range, numbered_output, MAX_RESULT_BYTES);
            (slice.text, slice.next_line)
        };
        if let Some(next_line) = next_line {
            text.push_str(&format!(
                "\n\n[truncated at {MAX_RESULT_BYTES} bytes; continue with offset={next_line} and a limit to read the rest, or use outline to find the part you need]"
            ));
        }
        meta.truncated = Some(next_line.is_some());
        Ok(Some(PageOutput::Text { text, meta }))
    }

    /// `read` with `pages`: each page under its own header, until the output
    /// cap; the rest are named so they can be read separately.
    async fn read_several(&self, caller: &Caller, space: &str, names: &[String]) -> Outcome {
        if names.is_empty() {
            return Err("`pages` must be a non-empty list of page names".into());
        }
        if names.len() > MAX_PAGES_PER_READ {
            return Err(
                format!("`pages` takes at most {MAX_PAGES_PER_READ} pages per call").into(),
            );
        }
        let mut sections = Vec::new();
        let mut structured = Vec::new();
        let mut used = 0;
        let mut skipped = Vec::new();
        for name in names {
            // Boxed: a listing in `pages` recurses through `read_page`.
            let read = Box::pin(self.read_page(caller, space, name, PageView::default())).await;
            let (header, body, item) = match read {
                Ok(Some(PageOutput::Text { text, meta })) => (
                    format!("=== {} (revision {}) ===", meta.page, meta.revision),
                    text.clone(),
                    page_structured(&text, meta),
                ),
                // Neither has a revision, and an image no text
                Ok(Some(PageOutput::Image { .. })) => (
                    format!("=== {name} (revision ) ==="),
                    String::new(),
                    json!(null),
                ),
                Ok(Some(PageOutput::Listing { text, listing })) => {
                    (format!("=== {name} (revision ) ==="), text, json!(listing))
                }
                Ok(None) => {
                    let error = not_found(name);
                    (
                        format!("=== {name} (error) ==="),
                        error.clone(),
                        json!({ "page": name, "error": error }),
                    )
                }
                Err(error) => (
                    format!("=== {name} (error) ==="),
                    error.message().to_owned(),
                    json!({ "page": name, "error": error.message() }),
                ),
            };
            let section = format!("{header}\n{body}");
            if used + section.len() > MAX_RESULT_BYTES && !sections.is_empty() {
                skipped.push(name.clone());
                continue;
            }
            used += section.len();
            sections.push(section);
            structured.push(item);
        }
        if !skipped.is_empty() {
            sections.push(format!(
                "[output cap reached; not shown: {}. Read them in another call.]",
                skipped.join(", ")
            ));
        }
        Ok(Reply::text(sections.join("\n\n"))
            .with_structured(json!({ "pages": structured, "skipped": skipped })))
    }

    async fn list_pages(
        &self,
        caller: &Caller,
        space: &str,
        prefix: &str,
    ) -> Result<PageOutput, ToolError> {
        let prefix = prefix.trim_start_matches('/');
        let pages = pages::list_pages(&self.api(caller, space), prefix)
            .await
            .map_err(|e| file_error(e, "listing", prefix, prefix))?;
        Ok(listing(prefix, &pages))
    }

    pub(super) async fn write(&self, caller: &Caller, args: WriteArgs) -> Outcome {
        let WriteArgs {
            space,
            page,
            content,
            if_revision,
        } = args;
        let path = page_to_path(&page)?;
        let written = pages::write_page(
            &self.api(caller, &space),
            &path,
            &content,
            if_revision
                .as_deref()
                .map_or(Precondition::Absent, Precondition::Revision),
        )
        .await
        .map_err(|e| file_error(e, "write", &page, &path))?;
        let name = path_to_page(&path);
        let mut text = format!("Wrote {name} ({} bytes).", content.len());
        if let Some(note) = self
            .after_write(caller, &space, &path, written.scripts)
            .await
        {
            text = format!("{text} {note}");
        }
        Ok(Reply::text(text).with_meta(json!({ "page": name, "revision": written.revision })))
    }

    /// Reloads a page's scripts after a write that changed them; the
    /// reload's note, if any.
    async fn after_write(
        &self,
        caller: &Caller,
        space: &str,
        path: &str,
        scripts: bool,
    ) -> Option<String> {
        if !scripts {
            return None;
        }
        Some(
            self.reload_after_write(caller, space, &path_to_page(path))
                .await,
        )
    }

    pub(super) async fn edit(&self, caller: &Caller, args: EditArgs) -> Outcome {
        let EditArgs {
            space,
            page,
            edits,
            dry_run,
            if_revision,
        } = args;
        let edits = to_edits(edits)?;
        let path = page_to_path(&page)?;
        let opts = EditOpts {
            all: false,
            old_text: "oldText",
        };
        let edited = pages::edit_page(
            &self.api(caller, &space),
            &path,
            &edits,
            opts,
            if_revision.as_deref(),
            dry_run.unwrap_or(false),
        )
        .await
        .map_err(|error| match error {
            EditPageError::Read(e) => file_error(e, "edit", &page, &path),
            EditPageError::NotUtf8 => ToolError::new(format!(
                "\"{page}\" is not valid UTF-8 text; use `lua` for binary documents. Nothing was changed."
            )),
            EditPageError::Edit(e) => ToolError::new(e.message),
            EditPageError::Write(e) => file_error(e, "write", &page, &path),
        })?;

        let name = path_to_page(&path);
        let Some(written) = edited.written else {
            let diff = unified_diff(
                &edited.before,
                &edited.after,
                &format!("a/{name}"),
                &format!("b/{name}"),
            );
            let text = if diff.is_empty() {
                "No changes (dry run).".to_owned()
            } else {
                diff
            };
            return Ok(Reply::text(text).with_meta(json!({
                "page": name, "revision": edited.read_revision, "dryRun": true, "edits": edits.len()
            })));
        };
        let mut text = format!("Applied {} edit(s) to {name}.", edits.len());
        if let Some(note) = self
            .after_write(caller, &space, &path, written.scripts)
            .await
        {
            text = format!("{text} {note}");
        }
        Ok(Reply::text(text).with_meta(json!({
            "page": name, "revision": written.revision, "edits": edits.len()
        })))
    }
}

/// Pages under `prefix`, by name only. A long listing shows the pages at
/// this level and the subfolders with their page counts instead.
fn listing(prefix: &str, pages: &[String]) -> PageOutput {
    let total = pages.len();
    let shown = if prefix.is_empty() {
        "the space".to_owned()
    } else {
        format!("\"{prefix}\"")
    };
    let mut out = Vec::new();
    let mut listed: Vec<&str> = Vec::new();
    let mut folders: Vec<(String, usize)> = Vec::new();
    if total <= FLAT_LIMIT {
        out.push(format!("{total} page(s) in {shown}:"));
        listed.extend(pages.iter().map(String::as_str));
        out.extend(listed.iter().map(|page| format!("- {page}")));
    } else {
        let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
        for page in pages {
            match page[prefix.len()..].split_once('/') {
                Some((folder, _)) => *counts.entry(format!("{prefix}{folder}/")).or_default() += 1,
                None => listed.push(page),
            }
        }
        folders = counts.into_iter().collect();
        out.push(format!(
            "{total} pages in {shown}; read a folder (\"Name/\") to list it."
        ));
        if !folders.is_empty() {
            out.push(String::new());
            out.push("Folders:".into());
            out.extend(folders.iter().map(|(f, n)| format!("- {f} ({n})")));
        }
        if !listed.is_empty() {
            out.push(String::new());
            out.push(format!("Pages at this level ({}):", listed.len()));
            out.extend(
                listed
                    .iter()
                    .take(LIST_LIMIT)
                    .map(|page| format!("- {page}")),
            );
            if listed.len() > LIST_LIMIT {
                out.push(format!("- ... {} more", listed.len() - LIST_LIMIT));
            }
        }
    }
    out.push(String::new());
    out.push("To find pages by tag or attribute, query them with `lua`, e.g. `query[[from p = index.pages(\"tag\") select p.name]]`.".into());
    PageOutput::Listing {
        text: out.join("\n"),
        listing: Listing {
            prefix: prefix.to_owned(),
            total,
            pages: listed
                .iter()
                .take(LIST_LIMIT)
                .map(|page| (*page).to_owned())
                .collect(),
            folders: folders
                .into_iter()
                .map(|(name, pages)| Folder { name, pages })
                .collect(),
        },
    }
}

fn to_edits(edits: Vec<EditArg>) -> Result<Vec<Edit>, ToolError> {
    if edits.is_empty() {
        return Err("\"edits\" must contain at least one edit".into());
    }
    edits
        .into_iter()
        .enumerate()
        .map(|(i, edit)| {
            if edit.old_text.is_empty() {
                return Err(format!("edit {}: oldText must not be empty", i + 1).into());
            }
            Ok(Edit {
                old: edit.old_text,
                new: edit.new_text,
            })
        })
        .collect()
}
