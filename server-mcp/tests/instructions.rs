mod support;

use silverbullet_server_mcp::{instructions, ToolSet, Tools};
use support::Fixture;

const TOOLS: [&str; 7] = [
    "help",
    "read",
    "write",
    "edit",
    "search",
    "lua",
    "screenshot",
];

#[test]
fn instructions_under_450_words() {
    let words = instructions("2.12.1").split_whitespace().count();
    assert!(words <= 450, "{words} words");
}

#[test]
fn instructions_mention_every_tool() {
    let text = instructions("2.12.1");
    for tool in TOOLS {
        assert!(text.contains(&format!("`{tool}`")), "missing {tool}");
    }
}

#[test]
fn instructions_link_the_docs_and_name_no_manual() {
    let text = instructions("2.12.1");
    assert!(!text.to_lowercase().contains("manual"), "{text}");
    assert!(text.contains(
        "When unsure how something works, read the documentation at https://docs.silverbullet.md before answering."
    ));
    assert!(!text.contains("{docs_url}"));
}

#[test]
fn instructions_docs_url_follows_the_build_channel() {
    assert!(instructions("2.12.1").contains("https://docs.silverbullet.md"));
    let release = instructions("2.12.1-0-g4d5eac537-2026-11-02T07-41-34Z");
    assert!(release.contains("https://docs.silverbullet.md"));
    assert!(!release.contains("edge.silverbullet.md"));
    let edge = instructions("2.12.0-188-g5efb22056-2026-11-02T07-41-34Z");
    assert!(edge.contains("https://edge.silverbullet.md"));
    assert!(!edge.contains("docs.silverbullet.md"));
    assert!(instructions("2.12.1-3-g4d5eac537-2026-11-02T07-41-34Z")
        .contains("https://edge.silverbullet.md"));
    assert!(instructions("garbage").contains("https://edge.silverbullet.md"));
    assert!(instructions("0.0.0").contains("https://edge.silverbullet.md"));
}

#[test]
fn tools_list_and_instructions_under_2000_tokens_estimate() {
    let fixture = Fixture::new();
    let tools = Tools::new(fixture.host.clone(), "2.12.1");
    let list: usize = tools
        .tools()
        .iter()
        .map(|t| {
            t.name.len()
                + t.title.len()
                + t.description.len()
                + t.input_schema.to_string().len()
                + t.annotations.to_string().len()
        })
        .sum();
    let total = list + tools.instructions().len();
    assert!(total / 4 < 2000, "{} estimated tokens", total / 4);
}

#[test]
fn with_instructions_replaces_the_default() {
    let fixture = Fixture::new();
    let tools = Tools::new(fixture.host.clone(), "2.12.1").with_instructions("Custom.".into());
    assert_eq!(tools.instructions(), "Custom.");
}
