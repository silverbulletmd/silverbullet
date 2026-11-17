//! What a finished migration did: returned to the migration page and written
//! to `<root>/MIGRATION.md` for whoever looks at the folder later.

use std::path::Path;

use serde::Serialize;

use super::plan::{AdminPlan, MigrationPlan, Move};
use crate::multi::config::SpaceAccess;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub moved: Vec<Move>,
    pub env_to_remove: Vec<String>,
    /// The space or the old install lives under a URL prefix, so a reverse
    /// proxy may forward only that prefix and hide the Dashboard.
    pub prefix_note: bool,
    /// The space's URL path, `/` for the root, so a page that lost the run's
    /// answer can still link to the space.
    pub space_prefix: String,
}

/// The token name `SB_AUTH_TOKEN` gets in the admin's account.
pub const MIGRATED_TOKEN_NAME: &str = "migrated";

/// The space's prefix, `/` for the root (stored as empty).
pub(super) fn display_prefix(plan: &MigrationPlan) -> &str {
    match plan.space.binding.prefix() {
        "" => "/",
        prefix => prefix,
    }
}

pub(super) fn needs_prefix_note(plan: &MigrationPlan) -> bool {
    display_prefix(plan) != "/"
        || plan
            .space
            .former_prefixes
            .iter()
            .any(|prefix| prefix != "/")
}

/// `0` never stops a runtime.
fn idle_timeout_label(minutes: u64) -> String {
    match minutes {
        0 => "never".into(),
        1 => "1 minute".into(),
        n => format!("{n} minutes"),
    }
}

fn relative<'a>(root: &Path, path: &'a Path) -> std::borrow::Cow<'a, str> {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy()
}

/// The contents of `MIGRATION.md`.
/// `kept_auth_file`: the single-space auth file couldn't be read, so its
/// salt wasn't carried over and the file was left in place.
/// `chrome_data`: the old Runtime API's browser profiles stayed in the root.
pub(super) fn markdown(
    root: &Path,
    plan: &MigrationPlan,
    kept_auth_file: bool,
    chrome_data: bool,
) -> String {
    let space = &plan.space;
    let prefix = display_prefix(plan);
    let mut out = String::new();
    out.push_str("# Migration to multi-space\n\n");
    out.push_str(&format!(
        "On {}, SilverBullet moved this folder's contents into the space \"{}\" in `{}`, served at `{}`. This folder is now the server's data root, and `spaces.json` lists its spaces.\n\n",
        crate::multi::users::now_rfc3339(),
        space.name,
        space.folder,
        prefix,
    ));

    out.push_str("## What moved\n\n");
    if plan.moves.is_empty() {
        out.push_str("Nothing: the folder held no entries to move.\n");
    }
    for m in &plan.moves {
        out.push_str(&format!(
            "- `{}` → `{}`\n",
            relative(root, &m.from),
            relative(root, &m.to)
        ));
    }
    out.push('\n');

    out.push_str("## Settings carried over\n\n");
    out.push_str(&format!("- Space name: {}\n", space.name));
    out.push_str(&format!("- URL prefix: `{prefix}`"));
    if let Some(old) = space.former_prefixes.first() {
        out.push_str(&format!(
            " (was `{old}`; requests there redirect to the new prefix)"
        ));
    }
    out.push('\n');
    let visitors = match space.access() {
        SpaceAccess::None => "none (sign-in required)",
        SpaceAccess::Read => "read",
        SpaceAccess::Write => "read & write",
    };
    out.push_str(&format!("- Visitors without an account: {visitors}\n"));
    if space.read_only {
        out.push_str("- The space is read-only\n");
    }
    match &plan.admin {
        AdminPlan::FromEnv { username } => out.push_str(&format!(
            "- Administrator: `{username}`, with the password from `SB_USER`\n"
        )),
        AdminPlan::New { username } => out.push_str(&format!(
            "- Administrator: `{username}`, with the password chosen during the migration\n"
        )),
        AdminPlan::NoAccounts => {
            out.push_str("- No accounts: `users.json` is empty, so there is no Dashboard login\n")
        }
    }
    if plan.api_token {
        out.push_str(&format!(
            "- `SB_AUTH_TOKEN` is now the administrator's API token \"{MIGRATED_TOKEN_NAME}\"\n"
        ));
    }
    if plan.admin == AdminPlan::NoAccounts
        && plan.env_to_remove.iter().any(|var| var == "SB_AUTH_TOKEN")
    {
        out.push_str("- `SB_AUTH_TOKEN` is not carried over: without accounts, no one can own an API token\n");
    }
    if let Some(model) = &plan.search_model {
        out.push_str(&format!(
            "- Semantic search model: `{model}` (in `server.json`)\n"
        ));
    }
    if !plan.runtime_api {
        out.push_str("- Runtime API: off (in `server.json`)\n");
    }
    if let Some(minutes) = plan.runtime_idle_timeout {
        out.push_str(&format!(
            "- Runtime idle timeout: {} (in `server.json`)\n",
            idle_timeout_label(minutes)
        ));
    }
    out.push('\n');

    out.push_str("## Environment variables you can remove\n\n");
    if plan.env_to_remove.is_empty() {
        out.push_str("None.\n");
    }
    for var in &plan.env_to_remove {
        out.push_str(&format!("- `{var}`\n"));
    }
    out.push_str("\nThe server ignores them now that `spaces.json` exists.\n\n");

    out.push_str("## Devices\n\n");
    if plan.url_changed {
        out.push_str("The space's URL changed. Devices will need to sign in and download the space again. Edits made offline and not yet synced will not carry over.\n");
    } else {
        out.push_str("Devices need to sign in again. They keep their downloaded copy of the space, and edits made offline sync once they have signed in.\n");
    }

    if kept_auth_file {
        out.push_str(&format!(
            "\n`{auth}` could not be read, so its client-encryption key salt was not carried over and the file was left in this folder. Devices that used client encryption download the space again after signing in; edits made offline and not yet synced will not carry over. Once you no longer need it, you can delete `{auth}`.\n",
            auth = crate::auth::AUTH_FILE_NAME
        ));
    }

    if chrome_data {
        out.push_str(&format!(
            "\n`{dir}` stayed in this folder: it holds the headless browser profiles of the Runtime API. The old server's profile is no longer used, so `{dir}` is safe to delete while the server is stopped; the server recreates what it needs.\n",
            dir = super::plan::CHROME_DATA_DIR
        ));
    }

    if needs_prefix_note(plan) {
        let forwarded = if prefix != "/" {
            prefix
        } else {
            space
                .former_prefixes
                .iter()
                .map(String::as_str)
                .find(|old| *old != "/")
                .unwrap_or(prefix)
        };
        out.push_str("\n## Reverse proxy\n\n");
        out.push_str(&format!(
            "The Dashboard and the server's own pages live at the root, not under the space's prefix. If a reverse proxy forwards only `{forwarded}` to this server, it must also forward `/.dashboard`, `/.instance` and `/.setup` for the Dashboard to be reachable"
        ));
        if prefix == "/" {
            out.push_str(", and now the root for the space itself");
        }
        out.push_str(".\n");
    }
    out
}
