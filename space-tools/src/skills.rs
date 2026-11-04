//! Skills: pages tagged `meta/skill` or `meta/library` in their frontmatter,
//! whose `description` tells an assistant when to read them.

use serde::{Deserialize, Serialize};

use crate::paths::path_to_page;

const STD_PREFIX: &str = "Library/Std/";
const LIBRARY_PREFIX: &str = "Library/";
const SKILL_TAG: &str = "meta/skill";
const LIBRARY_TAG: &str = "meta/library";
const STD_PAGE: &str = "Library/Std";
/// A library summary's length, in characters, before it is cut.
const SUMMARY_CHARS: usize = 160;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillSource {
    Std,
    Library,
    Space,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub page: String,
    pub description: Option<String>,
    pub source: SkillSource,
    /// A user file replaces the bundled `Library/Std` page of this name.
    pub overrides_bundled: bool,
}

fn classify(page: &str) -> SkillSource {
    if page.starts_with(STD_PREFIX) {
        SkillSource::Std
    } else if page.starts_with(LIBRARY_PREFIX) {
        SkillSource::Library
    } else {
        SkillSource::Space
    }
}

/// The YAML between the leading `---` line and the next `---` line.
fn frontmatter(markdown: &str) -> Option<&str> {
    let rest = markdown.strip_prefix("---")?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))?;
    let mut end = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some(&rest[..end]);
        }
        end += line.len();
    }
    None
}

fn tags_of(value: &serde_yaml::Value) -> Vec<String> {
    let tag = |s: &str| s.trim().trim_start_matches('#').to_owned();
    match value {
        serde_yaml::Value::String(s) => s
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|t| !t.is_empty())
            .map(tag)
            .collect(),
        serde_yaml::Value::Sequence(items) => {
            items.iter().filter_map(|v| v.as_str()).map(tag).collect()
        }
        _ => Vec::new(),
    }
}

/// What a page's frontmatter declares: its tags and its other keys.
#[derive(Debug, Clone, PartialEq)]
pub struct PageData {
    pub tags: Vec<String>,
    pub attributes: Vec<String>,
}

/// `Some` when the page has frontmatter that parses as a mapping.
pub fn page_data(markdown: &str) -> Option<PageData> {
    let meta: serde_yaml::Mapping = serde_yaml::from_str(frontmatter(markdown)?).ok()?;
    let tags = meta.get("tags").map(tags_of).unwrap_or_default();
    let attributes = meta
        .keys()
        .filter_map(|k| k.as_str())
        .filter(|k| *k != "tags")
        .map(str::to_owned)
        .collect();
    Some(PageData { tags, attributes })
}

/// `Some` when the page's frontmatter tags include `meta/skill`, or
/// `meta/library` outside the bundled `Library/Std` (its curated skills cover
/// it). A library without a `description` is described by its first sentence.
pub fn parse_skill(path: &str, markdown: &str) -> Option<Skill> {
    let yaml = frontmatter(markdown)?;
    let meta: serde_yaml::Value = serde_yaml::from_str(yaml).ok()?;
    let tags = tags_of(meta.get("tags")?);
    let skill = tags.iter().any(|t| t == SKILL_TAG);
    let library = tags.iter().any(|t| t == LIBRARY_TAG);
    let page = path_to_page(path);
    let std = page == STD_PAGE || page.starts_with(STD_PREFIX);
    if !skill && (!library || std) {
        return None;
    }
    let description = meta
        .get("description")
        .and_then(|d| d.as_str())
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            library.then(|| {
                let body = body_after(markdown, yaml);
                library_summary(body).unwrap_or_else(|| page.clone())
            })
        });
    Some(Skill {
        source: classify(&page),
        page,
        description,
        overrides_bundled: false,
    })
}

/// The text after the frontmatter's closing `---` line; `yaml` is the slice
/// of `markdown` that [`frontmatter`] returned.
fn body_after<'a>(markdown: &'a str, yaml: &str) -> &'a str {
    let end = yaml.as_ptr() as usize - markdown.as_ptr() as usize + yaml.len();
    markdown[end..]
        .split_once('\n')
        .map_or("", |(_, body)| body)
}

/// The first sentence of the body's first prose paragraph, links reduced to
/// their text; `None` when the body has no prose.
fn library_summary(body: &str) -> Option<String> {
    let mut paragraph: Vec<&str> = Vec::new();
    let mut fence: Option<&str> = None;
    let mut directive_depth = 0usize;
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(marker) = fence {
            if trimmed.starts_with(marker) {
                fence = None;
            }
            continue;
        }
        if directive_depth > 0 {
            directive_depth = brace_depth(trimmed, directive_depth);
            continue;
        }
        let prose = if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fence = Some(&trimmed[..3]);
            false
        } else if trimmed.starts_with("${") {
            directive_depth = brace_depth(trimmed, 0);
            false
        } else {
            !trimmed.is_empty() && !is_heading(trimmed) && !is_hashtags(trimmed)
        };
        if prose {
            paragraph.push(trimmed);
        } else if !paragraph.is_empty() {
            break;
        }
    }
    let text = strip_links(&paragraph.join(" "));
    let sentence = first_sentence(text.trim());
    (!sentence.is_empty()).then(|| cap(sentence))
}

fn brace_depth(line: &str, mut depth: usize) -> usize {
    for c in line.chars() {
        match c {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    depth
}

fn is_heading(line: &str) -> bool {
    let rest = line.trim_start_matches('#');
    let level = line.len() - rest.len();
    (1..=6).contains(&level) && (rest.is_empty() || rest.starts_with(' '))
}

/// A line of only hashtags, such as `#meta`, which tags the page.
fn is_hashtags(line: &str) -> bool {
    line.split_whitespace()
        .all(|word| word.len() > 1 && word.starts_with('#'))
}

/// `[text](url)` and `![text](url)` become `text`; `[[Page|alias]]` becomes
/// `alias` and `[[Page]]` becomes `Page`.
fn strip_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('[') {
        let (before, from) = rest.split_at(at);
        if let Some(inner) = from.strip_prefix("[[") {
            if let Some(end) = inner.find("]]") {
                let link = &inner[..end];
                out.push_str(before);
                out.push_str(link.rsplit('|').next().unwrap_or(link));
                rest = &inner[end + 2..];
                continue;
            }
        } else if let Some(close) = from.find("](") {
            if let Some(end) = from[close..].find(')') {
                out.push_str(before.strip_suffix('!').unwrap_or(before));
                out.push_str(&from[1..close]);
                rest = &from[close + end + 1..];
                continue;
            }
        }
        out.push_str(before);
        out.push('[');
        rest = &from[1..];
    }
    out.push_str(rest);
    out
}

/// Up to and including the first `.`, `!` or `?` followed by a space or the end.
fn first_sentence(text: &str) -> &str {
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        if matches!(c, '.' | '!' | '?') && chars.peek().is_none_or(|(_, next)| next.is_whitespace())
        {
            return &text[..at + c.len_utf8()];
        }
    }
    text
}

/// `text` cut at a word boundary to about [`SUMMARY_CHARS`], with `…` when cut.
fn cap(text: &str) -> String {
    if text.chars().count() <= SUMMARY_CHARS {
        return text.to_owned();
    }
    let limit = text
        .char_indices()
        .nth(SUMMARY_CHARS)
        .map_or(text.len(), |(at, _)| at);
    let cut = text[..limit]
        .rfind(char::is_whitespace)
        .filter(|at| *at > 0)
        .unwrap_or(limit);
    format!("{}…", text[..cut].trim_end())
}

/// Skills among bundled `(path, bytes)` pages, sorted by page name. Non-Markdown
/// files and non-UTF-8 content are skipped.
pub fn bundled_skills(files: impl Iterator<Item = (String, Vec<u8>)>) -> Vec<Skill> {
    let mut skills: Vec<Skill> = files
        .filter(|(path, _)| path.ends_with(".md"))
        .filter_map(|(path, bytes)| parse_skill(&path, std::str::from_utf8(&bytes).ok()?))
        .collect();
    skills.sort_by(|a, b| a.page.cmp(&b.page));
    skills
}

/// The bundled skills with the space's own: a space page replaces the
/// bundled page of the same name. Sorted by page name.
pub fn merge_skills(bundled: &[Skill], space: Vec<Skill>) -> Vec<Skill> {
    let mut merged: std::collections::BTreeMap<String, Skill> = bundled
        .iter()
        .map(|skill| (skill.page.clone(), skill.clone()))
        .collect();
    for mut skill in space {
        skill.overrides_bundled = merged.contains_key(&skill.page);
        merged.insert(skill.page.clone(), skill);
    }
    merged.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skills_serialize_with_lowercase_sources_and_camel_case_fields() {
        let skill = Skill {
            page: "Library/Std/Skills/Query".into(),
            description: Some("Use when querying.".into()),
            source: SkillSource::Std,
            overrides_bundled: true,
        };
        let json = serde_json::to_value(&skill).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "page": "Library/Std/Skills/Query",
                "description": "Use when querying.",
                "source": "std",
                "overridesBundled": true,
            })
        );
        assert_eq!(serde_json::from_value::<Skill>(json).unwrap(), skill);
    }

    #[test]
    fn parse_skill_space_separated_tags() {
        let md =
            "---\ndescription: Do the thing. Use when asked.\ntags: meta/api meta/skill\n---\nBody";
        let skill = parse_skill("Library/Std/APIs/Tag.md", md).unwrap();
        assert_eq!(skill.page, "Library/Std/APIs/Tag");
        assert_eq!(skill.source, SkillSource::Std);
        assert_eq!(
            skill.description.as_deref(),
            Some("Do the thing. Use when asked.")
        );
        assert!(!skill.overrides_bundled);
    }

    #[test]
    fn parse_skill_yaml_list_tags() {
        let md = "---\ntags:\n  - meta/skill\n  - other\ndescription: Hi\n---\n";
        let skill = parse_skill("Library/Acme/Tool", md).unwrap();
        assert_eq!(skill.source, SkillSource::Library);
        let md = "---\ntags: [meta/skill]\n---\n";
        assert_eq!(
            parse_skill("Notes/Mine", md).unwrap().source,
            SkillSource::Space
        );
    }

    #[test]
    fn parse_skill_requires_meta_skill() {
        assert!(parse_skill("A", "---\ntags: meta/api\n---\n").is_none());
        assert!(parse_skill("A", "---\ndescription: x\n---\n").is_none());
        assert!(parse_skill("A", "no frontmatter").is_none());
        assert!(parse_skill("A", "---\ntags: meta/skill\nno closing").is_none());
        assert!(parse_skill("A", "---\ntags: [unclosed\n---\n").is_none());
    }

    #[test]
    fn parse_skill_missing_description_is_listed() {
        let skill = parse_skill("A", "---\ntags: meta/skill\n---\n").unwrap();
        assert_eq!(skill.description, None);
    }

    #[test]
    fn library_page_with_description_is_a_skill() {
        let md = "---\ntags: meta/library\ndescription: Draws charts. Use when charting.\n---\nThis is ignored.";
        let skill = parse_skill("Library/acme/Charts.md", md).unwrap();
        assert_eq!(skill.page, "Library/acme/Charts");
        assert_eq!(skill.source, SkillSource::Library);
        assert_eq!(
            skill.description.as_deref(),
            Some("Draws charts. Use when charting.")
        );
    }

    #[test]
    fn library_page_without_description_uses_its_first_sentence() {
        let md = "---\nname: \"Library/acme/Mermaid\"\ntags: meta/library\n---\nThis is a pure [Space Lua](https://silverbullet.md) library that adds [[Mermaid|diagrams]] to [[SilverBullet]]. \nMore text.\n\nSecond paragraph.";
        let skill = parse_skill("Library/acme/Mermaid.md", md).unwrap();
        assert_eq!(
            skill.description.as_deref(),
            Some("This is a pure Space Lua library that adds diagrams to SilverBullet.")
        );
    }

    #[test]
    fn library_first_sentence_spans_lines_of_one_paragraph() {
        let md = "---\ntags: [meta/library]\n---\nAdds a\ncalendar widget\n\nNot this.";
        let skill = parse_skill("Library/acme/Calendar.md", md).unwrap();
        assert_eq!(skill.description.as_deref(), Some("Adds a calendar widget"));
    }

    #[test]
    fn library_summary_skips_headings_code_and_directives() {
        let md = "---\ntags: meta/library\n---\n\n# Charts\n```space-lua\n-- This is code.\n```\n${widgets.thing({\n  a = 1,\n})}\n#meta\n\nDraws charts in pages. Then more.";
        let skill = parse_skill("Library/acme/Charts.md", md).unwrap();
        assert_eq!(skill.description.as_deref(), Some("Draws charts in pages."));
    }

    #[test]
    fn library_summary_is_capped() {
        let long = "word ".repeat(60);
        let md = format!("---\ntags: meta/library\n---\n{long}");
        let description = parse_skill("Library/acme/Long.md", &md)
            .unwrap()
            .description
            .unwrap();
        assert!(description.chars().count() <= 161, "{description}");
        assert!(description.ends_with("word…"), "{description}");
    }

    #[test]
    fn library_without_prose_is_described_by_its_name() {
        let md = "---\ntags: meta/library\n---\n# Only a heading\n```lua\nx = 1\n```\n";
        let skill = parse_skill("Library/acme/Bare.md", md).unwrap();
        assert_eq!(skill.description.as_deref(), Some("Library/acme/Bare"));
        let skill = parse_skill("Library/acme/Empty.md", "---\ntags: meta/library\n---\n").unwrap();
        assert_eq!(skill.description.as_deref(), Some("Library/acme/Empty"));
    }

    #[test]
    fn std_library_pages_are_not_skills() {
        let md = "---\ntags: meta/library\n---\nWelcome to the standard library.";
        assert!(parse_skill("Library/Std.md", md).is_none());
        assert!(parse_skill("Library/Std/Infrastructure/Share.md", md).is_none());
        // A curated Std skill still is one.
        let md = "---\ntags: meta/library meta/skill\ndescription: Use when x.\n---\n";
        assert!(parse_skill("Library/Std/Docs/X.md", md).is_some());
    }

    #[test]
    fn page_with_both_tags_is_one_skill() {
        let files = vec![(
            "Library/acme/Both.md".to_owned(),
            b"---\ntags: [meta/skill, meta/library]\ndescription: Use when both.\n---\nBody"
                .to_vec(),
        )];
        let skills = bundled_skills(files.into_iter());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].description.as_deref(), Some("Use when both."));
    }

    #[test]
    fn bundled_skills_filters_and_sorts() {
        let files = vec![
            (
                "Library/Std/B.md".to_owned(),
                b"---\ntags: meta/skill\n---\n".to_vec(),
            ),
            (
                "Library/Std/A.md".to_owned(),
                b"---\ntags: meta/skill\n---\n".to_vec(),
            ),
            ("Library/Std/C.md".to_owned(), b"plain".to_vec()),
            ("Library/Std/D.png".to_owned(), vec![0xff, 0xfe]),
        ];
        let pages: Vec<String> = bundled_skills(files.into_iter())
            .into_iter()
            .map(|s| s.page)
            .collect();
        assert_eq!(pages, ["Library/Std/A", "Library/Std/B"]);
    }

    #[test]
    fn space_pages_replace_bundled_ones() {
        let skill = |page: &str, description: &str| Skill {
            page: page.into(),
            description: Some(description.into()),
            source: classify(page),
            overrides_bundled: false,
        };
        let bundled = vec![
            skill("Library/Std/APIs/Tag", "bundled"),
            skill("Library/Std/APIs/Widget", "bundled"),
        ];
        let merged = merge_skills(
            &bundled,
            vec![
                skill("Library/Std/APIs/Tag", "mine"),
                skill("Notes/House Style", "house"),
            ],
        );
        let pages: Vec<(&str, &str, bool)> = merged
            .iter()
            .map(|s| {
                (
                    s.page.as_str(),
                    s.description.as_deref().unwrap(),
                    s.overrides_bundled,
                )
            })
            .collect();
        assert_eq!(
            pages,
            [
                ("Library/Std/APIs/Tag", "mine", true),
                ("Library/Std/APIs/Widget", "bundled", false),
                ("Notes/House Style", "house", false),
            ]
        );
    }
}
