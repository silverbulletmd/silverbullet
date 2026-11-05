//! What a `help` topic names, without I/O: each surface reads the page that
//! [`first_step`] asks for its own way and passes the outcome to
//! [`after_read`]. The order: a skill by its full page name, the space's own
//! page of exactly that name, a skill by short name (Space > Library > Std),
//! then a skill whose page contains it.

use super::{find_page, find_substring, lookup};
use crate::skills::{Skill, SkillSource};

fn page_name(topic: &str) -> &str {
    topic.strip_suffix(".md").unwrap_or(topic)
}

/// The skill a topic names without a space page to match: by full page or
/// short name (see [`lookup`]), else the shortest page containing it.
pub fn find_skill<'a>(skills: &'a [Skill], topic: &str) -> Option<&'a Skill> {
    let wanted = page_name(topic);
    lookup(skills, wanted).or_else(|| find_substring(skills, wanted))
}

pub enum TopicStep<'a> {
    /// A skill by its full page name.
    Skill(&'a Skill),
    /// Read the space's page of this name, then call [`after_read`].
    ReadPage(String),
}

pub fn first_step<'a>(skills: &'a [Skill], topic: &str) -> TopicStep<'a> {
    let wanted = page_name(topic);
    match find_page(skills, wanted) {
        Some(skill) => TopicStep::Skill(skill),
        None => TopicStep::ReadPage(wanted.to_owned()),
    }
}

/// What a topic names in a space.
#[derive(Debug, PartialEq, Eq)]
pub enum Topic<'a, P, E> {
    Skill(&'a Skill),
    /// The space's own page of that name.
    Page(P),
    /// Nothing; the error reading the page of that name, if it was not just
    /// missing.
    NoMatch(Option<E>),
}

/// The topic after reading the page [`first_step`] asked for: `Ok(None)`
/// when there is no such page.
pub fn after_read<'a, P, E>(
    skills: &'a [Skill],
    topic: &str,
    read: Result<Option<P>, E>,
) -> Topic<'a, P, E> {
    let error = match read {
        Ok(Some(page)) => return Topic::Page(page),
        Ok(None) => None,
        Err(error) => Some(error),
    };
    match find_skill(skills, topic) {
        Some(skill) => Topic::Skill(skill),
        None => Topic::NoMatch(error),
    }
}

/// Whether a skill has a bundled copy to fall back on: a built-in one that
/// no page of the space replaces.
pub fn serves_bundled_copy(skill: &Skill) -> bool {
    skill.source == SkillSource::Std && !skill.overrides_bundled
}

/// A skill's text as the space serves it: a reachable space's own copy
/// wins; the bundled copy only stands in when the space's read failed.
pub fn or_bundled_copy<T, E>(
    skill: &Skill,
    read: Result<T, E>,
    bundled: impl FnOnce() -> Option<T>,
) -> Result<T, E> {
    match read {
        Ok(text) => Ok(text),
        Err(error) if serves_bundled_copy(skill) => bundled().ok_or(error),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(page: &str, source: SkillSource) -> Skill {
        Skill {
            page: page.into(),
            description: None,
            source,
            overrides_bundled: false,
        }
    }

    fn skills() -> Vec<Skill> {
        vec![
            skill("Library/Std/Docs/Querying", SkillSource::Std),
            skill("Library/Acme/Querying", SkillSource::Library),
            skill("Library/Std/Docs/Space Lua", SkillSource::Std),
        ]
    }

    /// Resolves `topic` against a space with pages `pages`; reading "Broken" fails.
    fn resolve(skills: &[Skill], topic: &str) -> String {
        let page = match first_step(skills, topic) {
            TopicStep::Skill(skill) => return format!("skill {}", skill.page),
            TopicStep::ReadPage(page) => page,
        };
        let read = match page.as_str() {
            "Querying" | "Notes" => Ok(Some(page)),
            "Broken" => Err("HTTP 500"),
            _ => Ok(None),
        };
        match after_read(skills, topic, read) {
            Topic::Skill(skill) => format!("skill {}", skill.page),
            Topic::Page(page) => format!("page {page}"),
            Topic::NoMatch(error) => format!("none {error:?}"),
        }
    }

    #[test]
    fn topics_resolve_full_name_then_space_page_then_short_name_then_substring() {
        let skills = skills();
        assert_eq!(
            resolve(&skills, "library/std/docs/querying.md"),
            "skill Library/Std/Docs/Querying"
        );
        assert_eq!(resolve(&skills, "Querying"), "page Querying");
        assert_eq!(resolve(&skills, "Notes.md"), "page Notes");
        assert_eq!(
            resolve(&skills, "space lua"),
            "skill Library/Std/Docs/Space Lua"
        );
        assert_eq!(
            resolve(&skills, "acme/query"),
            "skill Library/Acme/Querying"
        );
        assert_eq!(resolve(&skills, "Elsewhere"), "none None");
        assert_eq!(resolve(&skills, "Broken"), "none Some(\"HTTP 500\")");
    }

    #[test]
    fn a_failed_page_read_still_finds_a_matching_skill() {
        let mut skills = skills();
        skills.push(skill("Library/Std/Docs/Broken Links", SkillSource::Std));
        assert_eq!(
            resolve(&skills, "Broken"),
            "skill Library/Std/Docs/Broken Links"
        );
    }

    #[test]
    fn the_spaces_copy_wins_and_the_bundled_one_stands_in_for_built_in_skills() {
        let std = skill("Library/Std/Docs/Querying", SkillSource::Std);
        let bundled = || Some("bundled");
        assert_eq!(
            or_bundled_copy(&std, Ok::<_, &str>("space"), bundled),
            Ok("space")
        );
        assert_eq!(
            or_bundled_copy(&std, Err("offline"), bundled),
            Ok("bundled")
        );
        assert_eq!(
            or_bundled_copy(&std, Err("offline"), || None::<&str>),
            Err("offline")
        );

        let overridden = Skill {
            overrides_bundled: true,
            ..std.clone()
        };
        let own = skill("Notes/Style", SkillSource::Space);
        for skill in [&overridden, &own] {
            assert_eq!(
                or_bundled_copy(skill, Err("offline"), bundled),
                Err("offline")
            );
        }
    }
}
