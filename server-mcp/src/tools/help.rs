//! `help`: lists spaces and skills, and reads a skill or page by topic.

use axum::http::{header, Method};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
use space_tools::help::{
    after_read, find_skill, first_step, no_match_message, or_bundled_copy, render_overview,
    source_label, topic_header, HelpData, Searched, SpaceRow, Topic, TopicStep, Voice,
};
use space_tools::ops::{SpaceRequest, SpaceResponse};
use space_tools::skills::Skill;

use super::args::{input_schema, SPACE};
use super::pages::{not_found, PageView};
use super::reply::{Outcome, Reply, ToolError};
use super::{annotations, Tools};
use crate::host::{Located, SpaceInfo};
use crate::tool::{Caller, ToolDef};

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct HelpArgs {
    /// Skill or page name; a close match is enough.
    topic: Option<String>,
    #[schemars(description = SPACE)]
    space: Option<String>,
}

/// `help`'s arguments on a host whose spaces are local folders
/// ([`crate::McpHost::locator`]).
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct PathHelpArgs {
    /// Skill or page name; a close match is enough.
    topic: Option<String>,
    #[schemars(description = SPACE)]
    space: Option<String>,
    /// Absolute local file path: says its space and page.
    path: Option<String>,
}

impl PathHelpArgs {
    /// The arguments every host takes, and the path to locate.
    pub(super) fn split(self) -> (HelpArgs, Option<String>) {
        let PathHelpArgs { topic, space, path } = self;
        (HelpArgs { topic, space }, path)
    }
}

/// A local file path `help` was asked about, with where the host found it.
pub(super) type LocatedPath = (String, Located);

pub(super) fn definitions(locates_paths: bool) -> Vec<ToolDef> {
    vec![ToolDef {
        name: "help",
        title: "Spaces and skills",
        description: "Start here. Lists the spaces you can use and the skills available (pages \
            that say when to read them); with `space`, also an outline of that space. With \
            `topic`, returns that skill or page. `space` defaults to your only space when you \
            have one; without a space, `topic` finds built-in skills only."
            .into(),
        input_schema: if locates_paths {
            input_schema::<PathHelpArgs>()
        } else {
            input_schema::<HelpArgs>()
        },
        annotations: annotations(true, false, true),
    }]
}

impl Tools {
    pub(super) async fn help(
        &self,
        caller: &Caller,
        args: HelpArgs,
        path: Option<LocatedPath>,
    ) -> Outcome {
        let HelpArgs { topic, space } = args;
        let spaces = self.host.spaces(caller);
        let located = path.map(|(path, located)| {
            let line = located_line(&path, &located, &spaces);
            (located.space, line)
        });
        let space = located.as_ref().map(|(space, _)| space.clone()).or(space);
        // The host's note answers a path lookup or orients the overview; a
        // skill or page read through `topic` doesn't need it again.
        let wants_note = located.is_some() || topic.is_none();
        let mut reply = self
            .answer(caller, &spaces, topic.as_deref(), space.as_deref())
            .await?;
        if wants_note {
            if let Some(note) = self.host.help_note(caller, space.as_deref()) {
                reply = reply.append(&note);
            }
        }
        Ok(match located {
            Some((_, line)) => reply.prepend(&line),
            None => reply,
        })
    }

    async fn answer(
        &self,
        caller: &Caller,
        spaces: &[SpaceInfo],
        topic: Option<&str>,
        space: Option<&str>,
    ) -> Outcome {
        let only = match spaces {
            [only] => Some(only.id.as_str()),
            _ => None,
        };
        let space = space.or(only);
        match (topic, space) {
            (None, _) => self.overview(caller, spaces, space).await,
            (Some(topic), Some(space)) => self.topic(caller, spaces, topic, space).await,
            (Some(topic), None) => self.built_in_topic(topic),
        }
    }

    /// A built-in skill, read from the bundled copy, when no space is named.
    fn built_in_topic(&self, topic: &str) -> Outcome {
        let skill = find_skill(&self.bundled, topic);
        let text = skill.and_then(|skill| Some((skill, self.bundled_text.get(&skill.page)?)));
        let Some((skill, text)) = text else {
            return Err(
                no_match_message(topic, Searched::BuiltIn, &self.bundled, &Voice::MCP).into(),
            );
        };
        Ok(Reply::text(text.clone()).prepend(&topic_header(
            &skill.page,
            source_label(skill),
            &Voice::MCP,
        )))
    }

    /// The space's skills and outline, as its `GET /.help` returns them, or
    /// why they could not be read.
    async fn help_data(
        &self,
        caller: &Caller,
        spaces: &[SpaceInfo],
        space: &str,
    ) -> Result<Result<HelpData, String>, ToolError> {
        if !spaces.iter().any(|s| s.id == space) {
            return Err(format!("space \"{space}\" is not available").into());
        }
        let request = SpaceRequest {
            method: Method::GET,
            path_and_query: "/.help".into(),
            body: Vec::new(),
            headers: vec![(header::ACCEPT, "application/json".into())],
        };
        let response = match self.host.request(caller, space, request).await {
            Ok(response) => response,
            Err(e) => return Ok(Err(e.to_string())),
        };
        if !response.status.is_success() {
            return Ok(Err(failure_reason(&response)));
        }
        Ok(serde_json::from_slice(&response.body)
            .map_err(|e| format!("its help data could not be parsed ({e})")))
    }

    /// Skills of one space: its own merged with the built-in ones, or the
    /// built-in ones alone when the space's could not be read.
    async fn skills_in(
        &self,
        caller: &Caller,
        spaces: &[SpaceInfo],
        space: &str,
    ) -> Result<Vec<Skill>, ToolError> {
        Ok(match self.help_data(caller, spaces, space).await? {
            Ok(data) => data.skills,
            Err(_) => self.bundled.clone(),
        })
    }

    async fn overview(
        &self,
        caller: &Caller,
        spaces: &[SpaceInfo],
        space: Option<&str>,
    ) -> Outcome {
        let rows: Vec<SpaceRow> = spaces
            .iter()
            .map(|s| SpaceRow {
                id: s.id.clone(),
                name: s.name.clone(),
                location: None,
                runtime: Some(s.runtime),
                selected: space == Some(s.id.as_str()),
            })
            .collect();
        let (data, note) = match space {
            None => (None, None),
            Some(space) => match self.help_data(caller, spaces, space).await? {
                Ok(data) => (Some(data), None),
                Err(reason) => {
                    let name = spaces
                        .iter()
                        .find(|s| s.id == space)
                        .map_or(space, |s| s.name.as_str());
                    let reason = reason.trim_end_matches('.');
                    (
                        None,
                        Some(format!(
                            "Could not read the outline and own skills of {name}: {reason}. \
                             Only the built-in skills are listed; call help with `space` again \
                             to retry."
                        )),
                    )
                }
            },
        };
        let selected = rows.iter().find(|r| r.selected).zip(data.as_ref());
        Ok(Reply::text(render_overview(
            &rows,
            selected,
            &self.bundled,
            &Voice::MCP,
            "",
            note.as_deref(),
        )))
    }

    async fn topic(
        &self,
        caller: &Caller,
        spaces: &[SpaceInfo],
        topic: &str,
        space: &str,
    ) -> Outcome {
        let skills = self.skills_in(caller, spaces, space).await?;
        let skill = match first_step(&skills, topic) {
            TopicStep::Skill(skill) => skill,
            TopicStep::ReadPage(page) => {
                let read = self
                    .read_page(caller, space, &page, PageView::default())
                    .await;
                match after_read(&skills, topic, read) {
                    Topic::Skill(skill) => skill,
                    Topic::Page(output) => {
                        return Ok(Reply::from(output)
                            .prepend(&format!("Source: page `{page}` in space `{space}`")))
                    }
                    Topic::NoMatch(Some(read_error)) => return Err(read_error),
                    Topic::NoMatch(None) => {
                        return Err(no_match_message(
                            topic,
                            Searched::Space(space),
                            &skills,
                            &Voice::MCP,
                        )
                        .into())
                    }
                }
            }
        };

        let header = topic_header(&skill.page, source_label(skill), &Voice::MCP);
        let read = match self
            .read_page(caller, space, &skill.page, PageView::default())
            .await
        {
            Ok(Some(output)) => Ok(Reply::from(output)),
            Ok(None) => Err(ToolError::new(not_found(&skill.page))),
            Err(error) => Err(error),
        };
        let bundled = || Some(Reply::text(self.bundled_text.get(&skill.page)?.clone()));
        or_bundled_copy(skill, read, bundled).map(|reply| reply.prepend(&header))
    }
}

/// Which space and page a local `path` is in.
fn located_line(path: &str, located: &Located, spaces: &[SpaceInfo]) -> String {
    let id = &located.space;
    let name = spaces
        .iter()
        .find(|s| &s.id == id)
        .map_or(id.as_str(), |s| s.name.as_str());
    let page = located
        .page
        .as_deref()
        .map(|page| format!(", page `{page}`"))
        .unwrap_or_default();
    format!("`{path}` is in space `{name}` (id `{id}`{page}).")
}

/// Why `GET /.help` failed, from its answer.
fn failure_reason(response: &SpaceResponse) -> String {
    let body = String::from_utf8_lossy(&response.body);
    let detail = serde_json::from_slice::<Value>(&response.body)
        .ok()
        .and_then(|v| v["error"].as_str().map(str::to_owned))
        .unwrap_or_else(|| body.trim().to_owned());
    if detail.is_empty() || detail.len() > 200 || detail.contains('\n') {
        format!("the space answered {}", response.status)
    } else {
        format!("the space answered {} ({detail})", response.status)
    }
}
