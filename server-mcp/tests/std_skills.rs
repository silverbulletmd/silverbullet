//! The skill pages bundled in `Library/Std` stay parseable, discoverable and
//! free of the `tags.` API, which skills must not teach.

use std::path::{Path, PathBuf};

use silverbullet_server_mcp::{parse_skill, SkillSource};

fn std_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../libraries/Library/Std")
}

fn pages(dir: &Path, out: &mut Vec<(String, String)>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            pages(&path, out);
        } else if path.extension().is_some_and(|e| e == "md") {
            let rel = path.strip_prefix(std_dir().parent().unwrap().parent().unwrap());
            out.push((
                rel.unwrap().to_string_lossy().replace('\\', "/"),
                std::fs::read_to_string(&path).unwrap(),
            ));
        }
    }
}

fn all_pages() -> Vec<(String, String)> {
    let mut out = Vec::new();
    pages(&std_dir(), &mut out);
    out
}

const NEW_PAGES: [&str; 7] = [
    "Docs/Markdown",
    "Docs/Querying",
    "Docs/Space Lua",
    "Docs/Tags and Schemas",
    "Docs/Templates",
    "Widgets/Building Interfaces",
    "Editor/Mentions",
];

#[test]
fn skill_pages_parse_with_a_usable_description() {
    let mut skills = Vec::new();
    for (path, markdown) in all_pages() {
        let tagged = markdown.lines().take(6).any(|l| l.contains("meta/skill"));
        let parsed = parse_skill(&path, &markdown);
        assert_eq!(parsed.is_some(), tagged, "{path}");
        if let Some(skill) = parsed {
            skills.push(skill);
        }
    }
    for page in NEW_PAGES {
        let page = format!("Library/Std/{page}");
        assert!(
            skills.iter().any(|s| s.page == page),
            "{page} is not a skill"
        );
    }
    assert_eq!(skills.len(), NEW_PAGES.len(), "only these pages are skills");
    for skill in skills {
        assert_eq!(skill.source, SkillSource::Std);
        let description = skill
            .description
            .unwrap_or_else(|| panic!("{} has no description", skill.page));
        let chars = description.chars().count();
        assert!((40..=400).contains(&chars), "{}: {chars} chars", skill.page);
        assert!(
            description.contains("Read before") || description.contains("Use when"),
            "{}: {description}",
            skill.page
        );
    }
}

#[test]
fn new_skill_pages_do_not_use_the_tags_api() {
    let pages = all_pages();
    for page in NEW_PAGES {
        let path = format!("Library/Std/{page}.md");
        let (_, markdown) = pages
            .iter()
            .find(|(p, _)| *p == path)
            .unwrap_or_else(|| panic!("missing {path}"));
        // Prose may name them as aliases found in existing pages; examples
        // must not teach them.
        let mut in_code = false;
        for line in markdown.lines() {
            if line.trim_start().starts_with("```") {
                in_code = !in_code;
                continue;
            }
            if !in_code {
                continue;
            }
            for needle in ["tags.", "index.tag ", "index.tag("] {
                assert!(
                    !line.contains(needle),
                    "{path} example uses {needle:?}: {line}"
                );
            }
        }
    }
}

fn page_text(name: &str) -> String {
    let path = format!("Library/Std/{name}.md");
    all_pages()
        .into_iter()
        .find(|(p, _)| *p == path)
        .unwrap_or_else(|| panic!("missing {path}"))
        .1
}

#[test]
fn skill_pages_cover_moved_topics() {
    let expected = [
        ("Docs/Querying", "distinct"),
        ("Docs/Querying", "null"),
        ("Docs/Querying", "1000"),
        ("Docs/Querying", "mode = \"words\""),
        ("Docs/Space Lua", "spacelua.describe"),
        ("Docs/Tags and Schemas", "Styling a kind of page"),
        ("Widgets/Building Interfaces", "dom."),
        ("Editor/Mentions", "identity.mentions"),
    ];
    for (page, phrase) in expected {
        assert!(
            page_text(page).contains(phrase),
            "{page} does not mention {phrase:?}"
        );
    }
}

#[test]
fn skill_pages_say_sb_writes_reload_too() {
    for page in NEW_PAGES {
        assert!(
            !page_text(page).contains("Elsewhere (the `sb` CLI"),
            "{page} still says the sb CLI does not reload"
        );
    }
}
