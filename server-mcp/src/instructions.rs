//! The server-level instructions sent on `initialize` and `server/discover`.

use server_space_tools::docs::docs_url;

const TEMPLATE: &str = include_str!("instructions.md");

/// The instructions, linking the documentation site for `version`'s channel.
pub fn instructions(version: &str) -> String {
    TEMPLATE.trim_end().replace("{docs_url}", docs_url(version))
}
