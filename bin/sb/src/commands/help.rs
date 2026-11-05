//! `sb help`: the saved spaces, the skills of the selected space and its
//! outline, or one skill by topic. Rendered by `server_space_tools::help`, as the
//! MCP's `help` tool is.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;

use serde_json::json;
use server_space_tools::docs::docs_url;
use server_space_tools::help::{
    after_read, find_skill, first_step, no_match_message, or_bundled_copy, render_overview,
    source_label, topic_header, HelpData, Searched, SpaceRow, Topic, TopicStep, Voice,
};
use server_space_tools::paths::page_to_path;
use server_space_tools::skills::{bundled_skills, Skill, SkillSource};

use crate::cli::GlobalFlags;
use crate::config::{self, Config};
use crate::conn::{self, ConnectionError, SpaceConnection};
use crate::local::{self, Need};

mod embedded {
    include!(concat!(env!("OUT_DIR"), "/std_skills.rs"));
}

/// Opens a connection to the space `flags` select.
type Connect<'a> = dyn Fn(&GlobalFlags) -> Result<SpaceConnection, ConnectionError> + 'a;

/// The visible top-level `sb` commands and their visible aliases, without `help`.
fn command_names() -> Vec<String> {
    use clap::CommandFactory;
    crate::cli::Cli::command()
        .get_subcommands()
        .filter(|command| !command.is_hide_set() && command.get_name() != "help")
        .flat_map(|command| {
            std::iter::once(command.get_name())
                .chain(command.get_visible_aliases())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Whether `name` is a top-level `sb` command (or a visible alias of one), so
/// `sb help <name>` can point at its `--help`.
fn is_command(name: &str) -> bool {
    command_names().iter().any(|candidate| candidate == name)
}

/// The error for a topic that is neither a skill nor a page, which also
/// points a command's name at its flag help.
fn no_match(topic: &str, searched: Searched, skills: &[Skill]) -> String {
    let mut message = no_match_message(topic, searched, skills, &Voice::CLI);
    let lower = topic.trim().to_lowercase();
    if is_command(&lower) {
        message.push_str(&format!(
            " `{lower}` is a command: run `sb {lower} --help`."
        ));
    }
    message
}

const MAX_PAGE_BYTES: u64 = 16 * 1024 * 1024;
/// Help reads files and `/.help` only, never the Lua runtime.
pub const NEED: Need = Need::Server;

pub fn run(
    g: &GlobalFlags,
    topic: &[String],
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<ExitCode, String> {
    let cfg = if g.url.is_some() {
        Config::default()
    } else {
        config::load()?
    };
    let cwd = std::env::current_dir()
        .ok()
        .map(|cwd| std::fs::canonicalize(&cwd).unwrap_or(cwd));
    let connect = |flags: &GlobalFlags| {
        let mut flags = flags.clone();
        local::prepare(&mut flags, NEED)?;
        conn::resolve_typed(&flags, &cfg)
    };
    help_in(g, &cfg, cwd.as_deref(), &connect, topic, out, err)
}

/// The built-in skills embedded at build time, with their text by page.
struct BuiltIn {
    skills: Vec<Skill>,
    text: HashMap<String, &'static str>,
}

fn built_in() -> BuiltIn {
    let skills = bundled_skills(
        embedded::STD_SKILLS
            .iter()
            .map(|(path, text)| ((*path).to_owned(), text.as_bytes().to_vec())),
    );
    let text = embedded::STD_SKILLS
        .iter()
        .map(|(path, text)| (server_space_tools::paths::path_to_page(path), *text))
        .collect();
    BuiltIn { skills, text }
}

/// The selected space, connected, with its `/.help` data or why there is none.
struct Selected {
    row: SpaceRow,
    connection: Option<SpaceConnection>,
    data: Result<HelpData, String>,
}

impl Selected {
    fn unreadable_note(&self) -> Option<String> {
        let reason = self.data.as_ref().err()?.trim_end_matches('.');
        Some(format!(
            "Could not read {}'s own skills: {reason}. Only the built-in skills are listed.",
            self.row.name
        ))
    }
}

fn help_in(
    g: &GlobalFlags,
    cfg: &Config,
    cwd: Option<&Path>,
    connect: &Connect,
    topic: &[String],
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<ExitCode, String> {
    let json = g.json || matches!(g.output.as_str(), "json" | "jsonl");
    let (mut rows, selected_index) = spaces(g, cfg, cwd)?;
    let selected = selected_index.map(|index| {
        let row = rows[index].clone();
        let mut flags = g.clone();
        if flags.url.is_none() {
            flags.space = Some(row.id.clone());
        }
        match connect(&flags) {
            Ok(connection) => {
                let data = fetch_help(&connection);
                Selected {
                    row,
                    connection: Some(connection),
                    data,
                }
            }
            Err(error) => Selected {
                row,
                connection: None,
                data: Err(error.message),
            },
        }
    });
    let built_in = built_in();
    let topic = topic.join(" ");
    let topic = topic.trim();
    if topic.is_empty() {
        overview(&mut rows, selected.as_ref(), &built_in, json, out, err)?;
    } else {
        let searched = if rows.is_empty() {
            Searched::BuiltInNoSpaces
        } else {
            Searched::BuiltIn
        };
        read_topic(
            topic,
            selected.as_ref(),
            &built_in,
            searched,
            json,
            out,
            err,
        )?;
    }
    Ok(ExitCode::SUCCESS)
}

/// The visible saved spaces as rows, and which one commands would use. With
/// `--url`, that URL is the only row.
fn spaces(
    g: &GlobalFlags,
    cfg: &Config,
    cwd: Option<&Path>,
) -> Result<(Vec<SpaceRow>, Option<usize>), String> {
    if let Some(url) = &g.url {
        let url = url.trim_end_matches('/').to_owned();
        let row = SpaceRow {
            id: url.clone(),
            name: url.clone(),
            location: Some(url),
            runtime: None,
            selected: true,
        };
        return Ok((vec![row], Some(0)));
    }
    let selected = match config::resolve_space_at(cfg, g.space.as_deref(), cwd) {
        Ok(space) => Some(space.id.clone()),
        Err(error) if g.space.is_some() => return Err(error),
        Err(_) => None,
    };
    let rows: Vec<SpaceRow> = cfg
        .spaces
        .iter()
        .filter(|s| !config::is_hidden(s) || selected.as_deref() == Some(s.id.as_str()))
        .map(|s| SpaceRow {
            id: s.id.clone(),
            name: s.name.clone(),
            location: Some(if s.url.is_empty() {
                s.folder_path.clone()
            } else {
                s.url.clone()
            }),
            runtime: None,
            selected: selected.as_deref() == Some(s.id.as_str()),
        })
        .collect();
    let index = rows.iter().position(|row| row.selected);
    Ok((rows, index))
}

fn fetch_help(connection: &SpaceConnection) -> Result<HelpData, String> {
    let request = connection
        .client
        .get(format!("{}/.help", connection.base_url))
        .header("Accept", "application/json");
    let response = connection
        .apply_auth(request)
        .send()
        .map_err(|error| format!("{error}"))?;
    let status = response.status();
    match status.as_u16() {
        200..=299 => {}
        404 => {
            return Err(
                "its server has no skill listing (it is older than this sb; upgrade it to see them)"
                    .into(),
            )
        }
        401 | 403 => {
            return Err(
                "its server lists them only for signed-in users; connect with credentials (for example --token) to see them"
                    .into(),
            )
        }
        _ => return Err(format!("its server answered HTTP {status}")),
    }
    let data: HelpData = response
        .json()
        .map_err(|error| format!("its server sent an unreadable skill listing ({error})"))?;
    if data.version != 1 {
        return Err(format!(
            "its server sent a skill listing of version {}; run `sb upgrade`",
            data.version
        ));
    }
    Ok(data)
}

fn overview(
    rows: &mut [SpaceRow],
    selected: Option<&Selected>,
    built_in: &BuiltIn,
    json: bool,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), String> {
    let data = selected.and_then(|s| s.data.as_ref().ok());
    let note = selected.and_then(Selected::unreadable_note);
    if json {
        if let Some(note) = &note {
            writeln!(err, "{note}").map_err(write_error)?;
        }
        let mut value = json!({
            "spaces": rows,
            "selected": selected.map(|s| s.row.id.as_str()),
            "help": data,
        });
        if data.is_none() {
            value["builtIn"] = json!(built_in.skills);
        }
        return writeln!(out, "{value}").map_err(write_error);
    }
    let docs = docs_url(crate::VERSION);
    let shown = selected
        .zip(data)
        .map(|(selected, data)| (&selected.row, data));
    let text = render_overview(
        rows,
        shown,
        &built_in.skills,
        &Voice::CLI,
        docs,
        note.as_deref(),
    );
    writeln!(out, "{text}").map_err(write_error)
}

fn read_topic(
    topic: &str,
    selected: Option<&Selected>,
    built_in: &BuiltIn,
    searched: Searched,
    json: bool,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), String> {
    let space = selected.and_then(|s| Some((s, s.connection.as_ref()?, s.data.as_ref().ok()?)));
    let (page, source, label, text) = match space {
        Some((selected, connection, data)) => {
            space_topic(topic, selected, connection, data, built_in)?
        }
        None => {
            if let Some(note) = selected.and_then(Selected::unreadable_note) {
                writeln!(err, "{note}").map_err(write_error)?;
            }
            let skill = find_skill(&built_in.skills, topic);
            let found = skill.and_then(|skill| Some((skill, *built_in.text.get(&skill.page)?)));
            let Some((skill, text)) = found else {
                return Err(no_match(topic, searched, &built_in.skills));
            };
            (
                skill.page.clone(),
                source_name(skill.source),
                source_label(skill),
                text.to_owned(),
            )
        }
    };
    let written = if json {
        writeln!(
            out,
            "{}",
            json!({ "page": page, "source": source, "text": text })
        )
    } else {
        let header = topic_header(&page, label, &Voice::CLI);
        let newline = if text.ends_with('\n') { "" } else { "\n" };
        let command = topic.to_lowercase();
        let hint = if is_command(&command) {
            format!("\nFor the `sb {command}` command's flags, run `sb {command} --help`.\n")
        } else {
            String::new()
        };
        write!(out, "{header}\n\n{text}{newline}{hint}")
    };
    written.map_err(write_error)
}

/// A topic in a space, resolved as the MCP's `help` does.
fn space_topic(
    topic: &str,
    selected: &Selected,
    connection: &SpaceConnection,
    data: &HelpData,
    built_in: &BuiltIn,
) -> Result<(String, &'static str, &'static str, String), String> {
    let page = match first_step(&data.skills, topic) {
        TopicStep::Skill(skill) => return skill_text(skill, connection, built_in),
        TopicStep::ReadPage(page) => page,
    };
    let read = match page_to_path(&page).map(|path| connection.fs_read(&path, MAX_PAGE_BYTES)) {
        Err(_) => Ok(None),
        Ok(Ok(file)) => Ok(Some(String::from_utf8_lossy(&file.bytes).into_owned())),
        Ok(Err(error)) if error.code == "not_found" || error.code == "invalid_path" => Ok(None),
        Ok(Err(error)) => Err(error.message),
    };
    match after_read(&data.skills, topic, read) {
        Topic::Skill(skill) => skill_text(skill, connection, built_in),
        Topic::Page(text) => {
            let page = Skill {
                page,
                description: None,
                source: SkillSource::Space,
                overrides_bundled: false,
            };
            Ok((page.page.clone(), "page", source_label(&page), text))
        }
        Topic::NoMatch(Some(message)) => Err(message),
        Topic::NoMatch(None) => Err(no_match(
            topic,
            Searched::Space(&selected.row.name),
            &data.skills,
        )),
    }
}

/// A skill's text from the space; a built-in one the space does not replace
/// falls back to the copy in `sb`.
fn skill_text(
    skill: &Skill,
    connection: &SpaceConnection,
    built_in: &BuiltIn,
) -> Result<(String, &'static str, &'static str, String), String> {
    let read = page_to_path(&skill.page).and_then(|path| {
        connection
            .fs_read(&path, MAX_PAGE_BYTES)
            .map(|file| String::from_utf8_lossy(&file.bytes).into_owned())
            .map_err(|error| error.message)
    });
    let bundled = || Some((*built_in.text.get(&skill.page)?).to_owned());
    let text = or_bundled_copy(skill, read, bundled)
        .map_err(|error| format!("reading {}: {error}", skill.page))?;
    Ok((
        skill.page.clone(),
        source_name(skill.source),
        source_label(skill),
        text,
    ))
}

fn source_name(source: SkillSource) -> &'static str {
    match source {
        SkillSource::Std => "std",
        SkillSource::Library => "library",
        SkillSource::Space => "space",
    }
}

fn write_error(error: std::io::Error) -> String {
    format!("writing output: {error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, SpaceConfig};
    use std::io::{BufRead, BufReader, Read};
    use std::net::TcpListener;

    const BUILT_IN: [&str; 7] = [
        "Markdown",
        "Querying",
        "Space Lua",
        "Tags and Schemas",
        "Templates",
        "Mentions",
        "Building Interfaces",
    ];

    /// Serves `routes` (request path, status line, body) until the test ends;
    /// any other path answers 404.
    fn mock(routes: Vec<(&'static str, &'static str, String)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                if reader.read_line(&mut request_line).is_err() {
                    continue;
                }
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                }
                let path = request_line.split(' ').nth(1).unwrap_or("").to_owned();
                let (status, body) = routes
                    .iter()
                    .find(|(p, _, _)| *p == path)
                    .map(|(_, status, body)| (*status, body.clone()))
                    .unwrap_or(("404 Not Found", "Not found".into()));
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.flush();
                let _ = stream.read(&mut [0u8; 1]);
            }
        });
        base
    }

    fn flags(space: Option<&str>, json: bool) -> GlobalFlags {
        GlobalFlags {
            space: space.map(str::to_owned),
            url: None,
            token: None,
            timeout: 5,
            json,
            text: !json,
            output: "auto".into(),
        }
    }

    fn remote(id: &str, name: &str, url: &str) -> SpaceConfig {
        SpaceConfig {
            id: id.into(),
            name: name.into(),
            url: url.into(),
            auth: AuthConfig {
                method: "none".into(),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn config(spaces: Vec<SpaceConfig>) -> Config {
        Config { spaces }
    }

    fn connect_plain(
        cfg: &Config,
    ) -> impl Fn(&GlobalFlags) -> Result<SpaceConnection, ConnectionError> + '_ {
        move |flags| conn::resolve_typed(flags, cfg)
    }

    struct Run {
        result: Result<ExitCode, String>,
        out: String,
        err: String,
    }

    fn help(g: &GlobalFlags, cfg: &Config, topic: &[&str]) -> Run {
        let topic: Vec<String> = topic.iter().map(|t| (*t).to_owned()).collect();
        let mut out = Vec::new();
        let mut err = Vec::new();
        let connect = connect_plain(cfg);
        let result = help_in(g, cfg, None, &connect, &topic, &mut out, &mut err);
        Run {
            result,
            out: String::from_utf8(out).unwrap(),
            err: String::from_utf8(err).unwrap(),
        }
    }

    fn help_json(skills: serde_json::Value) -> String {
        serde_json::json!({
            "version": 1,
            "runtime": true,
            "scanning": false,
            "skills": skills,
            "outline": {
                "folders": [{"name": "Guides", "pages": 1}],
                "pages": ["AGENTS", "index"],
                "pageCount": 2,
                "agents": true,
                "tags": [{"tag": "project", "pages": 3, "attributes": ["status"]}]
            }
        })
        .to_string()
    }

    fn filing_skill() -> serde_json::Value {
        serde_json::json!([
            {"page": "Guides/Filing", "description": "House rules. Use when filing a note.", "source": "space", "overridesBundled": false},
            {"page": "Library/Std/Docs/Querying", "description": "Queries. Read before querying.", "source": "std", "overridesBundled": false}
        ])
    }

    #[test]
    fn no_spaces_lists_built_in_skills_and_space_add_hint() {
        let run = help(&flags(None, false), &config(vec![]), &[]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS));
        assert!(run.out.contains("## Built in"), "{}", run.out);
        for name in BUILT_IN {
            assert!(
                run.out.contains(&format!("- **{name}**")),
                "{name}: {}",
                run.out
            );
        }
        assert!(run.out.contains("sb space add"), "{}", run.out);
        assert!(run.out.contains("sb <command> --help"), "{}", run.out);
    }

    #[test]
    fn spaces_table_marks_selected_space() {
        let base = mock(vec![("/.help", "200 OK", help_json(filing_skill()))]);
        let cfg = config(vec![
            remote("id-notes", "notes", &base),
            remote("id-fixture", "fixture", "http://127.0.0.1:9"),
        ]);
        let run = help(&flags(Some("notes"), false), &cfg, &[]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out
                .contains(&format!("| notes | `id-notes` | {base} | selected |")),
            "{}",
            run.out
        );
        assert!(
            run.out
                .contains("| fixture | `id-fixture` | http://127.0.0.1:9 |  |"),
            "{}",
            run.out
        );
        assert!(run.out.contains("## In notes"), "{}", run.out);
        assert!(
            run.out.contains("- **Filing**: Use when filing a note."),
            "{}",
            run.out
        );
        assert!(run.out.contains("# notes"), "{}", run.out);
        assert!(
            run.out
                .contains("sb query 'from p = index.pages(\"project\")"),
            "{}",
            run.out
        );
    }

    #[test]
    fn help_falls_back_to_built_in_skills_when_help_route_is_missing() {
        let base = mock(vec![]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &[]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out.contains("Could not read notes's own skills"),
            "{}",
            run.out
        );
        assert!(run.out.contains("older"), "{}", run.out);
        assert!(!run.out.contains("Select a space with"), "{}", run.out);
        for name in BUILT_IN {
            assert!(
                run.out.contains(&format!("- **{name}**")),
                "{name}: {}",
                run.out
            );
        }
    }

    #[test]
    fn help_falls_back_to_built_in_skills_when_help_requires_sign_in() {
        let base = mock(vec![("/.help", "401 Unauthorized", String::new())]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &[]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out.contains("Could not read notes's own skills"),
            "{}",
            run.out
        );
        assert!(run.out.contains("signed-in"), "{}", run.out);
        assert!(run.out.contains("- **Querying**"), "{}", run.out);
    }

    #[test]
    fn topic_reads_a_space_skill_through_fs() {
        let base = mock(vec![
            ("/.help", "200 OK", help_json(filing_skill())),
            (
                "/.fs/Guides/Filing.md",
                "200 OK",
                "File notes under Inbox.\n".into(),
            ),
        ]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["filing"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out
                .starts_with("Source: Guides/Filing — this space's own pages"),
            "{}",
            run.out
        );
        assert!(run.out.contains("`sb fs read`"), "{}", run.out);
        assert!(
            run.out.ends_with("File notes under Inbox.\n"),
            "{}",
            run.out
        );
    }

    #[test]
    fn topic_reads_a_page_that_is_not_a_skill() {
        let base = mock(vec![
            ("/.help", "200 OK", help_json(filing_skill())),
            ("/.fs/Projects/Launch.md", "200 OK", "Launch plan.\n".into()),
        ]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["Projects/Launch"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out.starts_with("Source: Projects/Launch — "),
            "{}",
            run.out
        );
        assert!(run.out.ends_with("Launch plan.\n"), "{}", run.out);
    }

    #[test]
    fn topic_without_space_reads_embedded_copy() {
        let run = help(&flags(None, false), &config(vec![]), &["querying"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out
                .starts_with("Source: Library/Std/Docs/Querying — built in"),
            "{}",
            run.out
        );
        assert!(run.out.contains("tags: meta/skill"), "{}", run.out);
        let run = help(&flags(None, false), &config(vec![]), &["Space", "Lua"]);
        assert!(
            run.out
                .starts_with("Source: Library/Std/Docs/Space Lua — built in"),
            "{}",
            run.out
        );
    }

    #[test]
    fn unknown_topic_that_is_a_command_points_to_dash_help() {
        let run = help(&flags(None, false), &config(vec![]), &["fs"]);
        let message = run.result.unwrap_err();
        assert!(
            message.contains("No built-in skill matches \"fs\""),
            "{message}"
        );
        assert!(message.contains("run `sb fs --help`"), "{message}");
        assert!(run.out.is_empty(), "{}", run.out);
    }

    #[test]
    fn json_output_has_spaces_selected_and_help() {
        let base = mock(vec![("/.help", "200 OK", help_json(filing_skill()))]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, true), &cfg, &[]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        let value: serde_json::Value = serde_json::from_str(&run.out).unwrap();
        assert_eq!(value["selected"], "id-notes");
        assert_eq!(value["spaces"][0]["name"], "notes");
        assert_eq!(value["spaces"][0]["selected"], true);
        assert_eq!(value["help"]["version"], 1);
        assert_eq!(value["help"]["skills"][0]["page"], "Guides/Filing");

        let run = help(&flags(None, true), &config(vec![]), &[]);
        let value: serde_json::Value = serde_json::from_str(&run.out).unwrap();
        assert_eq!(value["selected"], serde_json::Value::Null);
        assert_eq!(value["help"], serde_json::Value::Null);
        assert_eq!(value["builtIn"].as_array().unwrap().len(), 7);

        let run = help(&flags(None, true), &config(vec![]), &["Querying"]);
        let value: serde_json::Value = serde_json::from_str(&run.out).unwrap();
        assert_eq!(value["page"], "Library/Std/Docs/Querying");
        assert_eq!(value["source"], "std");
        assert!(value["text"].as_str().unwrap().contains("meta/skill"));
    }

    #[test]
    fn an_unknown_space_name_is_an_error() {
        let cfg = config(vec![remote("id-notes", "notes", "http://127.0.0.1:9")]);
        let run = help(&flags(Some("nowhere"), false), &cfg, &[]);
        let message = run.result.unwrap_err();
        assert!(
            message.contains("\"nowhere\" is not available"),
            "{message}"
        );
        assert!(run.out.is_empty(), "{}", run.out);
    }

    #[test]
    fn topic_prefers_the_spaces_own_page_over_a_short_skill_name() {
        let base = mock(vec![
            ("/.help", "200 OK", help_json(filing_skill())),
            (
                "/.fs/Querying.md",
                "200 OK",
                "Our own query notes.\n".into(),
            ),
        ]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["Querying"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(run.out.starts_with("Source: Querying — "), "{}", run.out);
        assert!(run.out.contains("Our own query notes."), "{}", run.out);
    }

    #[test]
    fn std_skill_the_space_cannot_serve_reads_the_embedded_copy() {
        let base = mock(vec![("/.help", "200 OK", help_json(filing_skill()))]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["Querying"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out
                .starts_with("Source: Library/Std/Docs/Querying — built in"),
            "{}",
            run.out
        );
        assert!(run.out.contains("tags: meta/skill"), "{}", run.out);
    }

    #[test]
    fn the_spaces_copy_of_a_std_skill_wins_over_the_embedded_one() {
        let base = mock(vec![
            ("/.help", "200 OK", help_json(filing_skill())),
            (
                "/.fs/Library/Std/Docs/Querying.md",
                "200 OK",
                "The server's own querying notes.\n".into(),
            ),
        ]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["Querying"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out
                .starts_with("Source: Library/Std/Docs/Querying — built in"),
            "{}",
            run.out
        );
        assert!(
            run.out.ends_with("The server's own querying notes.\n"),
            "{}",
            run.out
        );
    }

    #[test]
    fn a_failing_page_read_still_finds_the_matching_skill() {
        let base = mock(vec![
            ("/.help", "200 OK", help_json(filing_skill())),
            ("/.fs/filing.md", "500 Internal Server Error", "boom".into()),
            (
                "/.fs/Guides/Filing.md",
                "200 OK",
                "File notes under Inbox.\n".into(),
            ),
        ]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["filing"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out.starts_with("Source: Guides/Filing — "),
            "{}",
            run.out
        );
    }

    #[test]
    fn overridden_std_skill_that_cannot_be_read_is_an_error() {
        let skills = serde_json::json!([
            {"page": "Library/Std/Docs/Querying", "description": "Ours. Read before querying.", "source": "std", "overridesBundled": true}
        ]);
        let base = mock(vec![("/.help", "200 OK", help_json(skills))]);
        let cfg = config(vec![remote("id-notes", "notes", &base)]);
        let run = help(&flags(None, false), &cfg, &["Querying"]);
        let message = run.result.unwrap_err();
        assert!(
            message.contains("reading Library/Std/Docs/Querying"),
            "{message}"
        );
        assert!(run.out.is_empty(), "{}", run.out);
    }

    #[test]
    fn command_name_topic_that_is_a_skill_ends_with_the_flags_hint() {
        let run = help(&flags(None, false), &config(vec![]), &["query"]);
        assert_eq!(run.result, Ok(ExitCode::SUCCESS), "{}", run.err);
        assert!(
            run.out
                .starts_with("Source: Library/Std/Docs/Querying — built in"),
            "{}",
            run.out
        );
        assert!(
            run.out
                .ends_with("\n\nFor the `sb query` command's flags, run `sb query --help`.\n"),
            "{}",
            run.out
        );
    }

    #[test]
    fn no_match_without_spaces_says_to_add_one() {
        let message = help(&flags(None, false), &config(vec![]), &["nothing"])
            .result
            .unwrap_err();
        assert!(
            message.contains("add one with `sb space add <url or folder>`"),
            "{message}"
        );
    }

    #[test]
    fn commands_are_named_from_the_cli_definition() {
        let mut names = command_names();
        names.sort();
        let mut expected = [
            "open",
            "space",
            "version",
            "fs",
            "eval",
            "lua",
            "script",
            "query",
            "search",
            "related",
            "logs",
            "screenshot",
            "upgrade",
            "upgrade-edge",
        ];
        expected.sort();
        assert_eq!(names, expected);
        assert!(is_command("fs"));
        for name in ["help", "lua-script", "Quering", ""] {
            assert!(!is_command(name), "{name}");
        }
    }

    #[test]
    fn no_match_names_a_commands_help() {
        let skills = [Skill {
            page: "Library/Std/Docs/Querying".into(),
            description: None,
            source: SkillSource::Std,
            overrides_bundled: false,
        }];
        let message = no_match("fs", Searched::Space("Alpha"), &skills);
        assert!(message.contains("run `sb fs --help`"), "{message}");
        let message = no_match("Quering", Searched::BuiltIn, &skills);
        assert!(!message.contains("--help"), "{message}");
    }
}
