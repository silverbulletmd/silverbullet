mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use axum::http::{HeaderMap, Method, StatusCode};
use serde_json::{json, Value};
use server_space_tools::help::{
    render_overview, FolderCount, HelpData, Outline, SpaceRow, TagSummary, Voice,
};
use server_space_tools::skills::{bundled_skills, Skill, SkillSource};
use silverbullet_server_mcp::{
    Caller, CallerCredential, HostError, McpHost, SpaceInfo, SpaceRequest, SpaceResponse, ToolSet,
    Tools,
};
use support::{Fixture, Script};

fn std_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../libraries/Library/Std")
}

fn read_dir(dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            read_dir(&path, out);
        } else {
            let rel = path
                .strip_prefix(std_dir().parent().unwrap().parent().unwrap())
                .unwrap();
            out.push((
                rel.to_string_lossy().replace('\\', "/"),
                std::fs::read(&path).unwrap(),
            ));
        }
    }
}

fn bundled_pages() -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    read_dir(&std_dir(), &mut out);
    out
}

struct Env {
    fixture: Fixture,
    script: Arc<Script>,
    tools: Tools,
    alpha: String,
    beta: String,
}

fn rows(value: Value) -> Script {
    Script::new(move |_, _, _| Ok(value.clone()))
}

fn env(script: Script) -> Env {
    let script = Arc::new(script);
    let fixture = Fixture::with_runtime_and_bundled(script.clone(), bundled_pages());
    let members = json!({
        "writer-one": {"role": "write"},
        "runtime-off": {"role": "write", "runtimeApi": false},
    });
    let alpha = fixture.space("Alpha", "/alpha", "none", members.clone());
    // `reader` may write only in Beta: an account with a single space.
    let mut beta_members = members;
    beta_members["reader"] = json!({"role": "write"});
    let beta = fixture.space("Beta", "/beta", "none", beta_members);
    let tools = Tools::new(fixture.host.clone(), "2.12.1").with_bundled_pages(bundled_pages());
    Env {
        fixture,
        script,
        tools,
        alpha,
        beta,
    }
}

impl Env {
    fn caller(&self, name: &str) -> Caller {
        self.fixture.caller(name)
    }

    async fn call_as(&self, user: &str, tool: &str, args: Value) -> Value {
        self.tools.call(&self.caller(user), tool, args).await
    }

    async fn help(&self, args: Value) -> Value {
        self.call_as("writer-one", "help", args).await
    }
}

fn text(result: &Value) -> &str {
    result["content"][0]["text"].as_str().unwrap()
}

fn is_error(result: &Value) -> bool {
    result["isError"] == true
}

/// Skill pages in the space itself; `Library/Std` comes bundled.
const SPACE_SKILLS: &[(&str, &str)] = &[
    (
        "Library/Acme/Garden Tools",
        "---\ndescription: Garden helpers.\ntags: meta/skill\n---\nBody of Library/Acme/Garden Tools",
    ),
    ("Notes/House Style", "---\ntags: meta/skill\n---\nBody"),
    ("Notes/Plain", "---\ntags: notes\n---\nNot a skill"),
];

impl Env {
    async fn write(&self, page: &str, content: &str) {
        let r = self
            .help_write(json!({"space": self.alpha, "page": page, "content": content}))
            .await;
        assert!(!is_error(&r), "{r}");
    }

    /// Replaces an existing page over the revision a plain read gives.
    async fn replace(&self, page: &str, content: &str) {
        let read = self
            .call_as(
                "writer-one",
                "read",
                json!({"space": self.alpha, "page": page}),
            )
            .await;
        let revision = read["structuredContent"]["revision"].clone();
        let r = self
            .help_write(
                json!({"space": self.alpha, "page": page, "content": content,
                               "ifRevision": revision}),
            )
            .await;
        assert!(!is_error(&r), "{r}");
    }

    async fn help_write(&self, args: Value) -> Value {
        self.call_as("writer-one", "write", args).await
    }

    /// Writes pages straight into Alpha's folder: a bundled path is
    /// read-only through the space, so a space's own copy is a file there.
    fn seed_on_disk(&self, pages: &[(&str, &str)]) {
        let config = self.fixture.config(&self.alpha);
        let folder = silverbullet_server::multi::instance::resolve_folder(
            self.fixture.root(),
            &self.alpha,
            &config.folder,
        );
        for (page, content) in pages {
            let path = folder.join(format!("{page}.md"));
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }
    }

    async fn seed(&self, pages: &[(&str, &str)]) {
        for (page, content) in pages {
            self.write(page, content).await;
        }
    }

    /// `help` for the space once `done` holds for its text, as change events
    /// reach the skill catalog asynchronously.
    async fn help_until(&self, done: impl Fn(&str) -> bool) -> String {
        let started = std::time::Instant::now();
        let caller = self.caller("writer-one");
        loop {
            let help = self
                .tools
                .call(&caller, "help", json!({"space": self.alpha}))
                .await;
            let t = text(&help).to_owned();
            if done(&t) {
                return t;
            }
            // Generous: a loaded CI runner indexes far slower than a laptop.
            assert!(
                started.elapsed() < std::time::Duration::from_secs(30),
                "help never reached the expected state:\n{t}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }
}

#[tokio::test]
async fn help_without_space_lists_spaces_and_built_in_skills_only() {
    let env = env(rows(Value::Null));
    let r = env.help(json!({})).await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.contains(&format!("| Alpha | `{}` | yes |", env.alpha)),
        "{t}"
    );
    assert!(
        t.contains(&format!("| Beta | `{}` | yes |", env.beta)),
        "{t}"
    );
    assert!(t.contains("help(topic: \"<skill>\")"), "{t}");
    assert!(
        t.contains("Skills differ per space: call help again with `space` after switching."),
        "{t}"
    );
    assert!(!t.to_lowercase().contains("manual"), "{t}");
    // Space skills are not listed without `space`, and nothing queried the runtime.
    assert!(!t.contains("Garden Tools"), "{t}");
    assert!(env.script.calls.lock().unwrap().is_empty());
    assert!(!help_description(&env).to_lowercase().contains("manual"));
}

fn help_description(env: &Env) -> String {
    env.tools.tools()[0].description.clone()
}

#[tokio::test]
async fn there_is_no_manual_space() {
    let env = env(rows(Value::Null));
    for (tool, args) in [
        (
            "read",
            json!({"space": "manual", "page": "Library/Std/Docs/Querying"}),
        ),
        ("search", json!({"space": "manual", "text": "query"})),
        ("help", json!({"space": "manual"})),
        ("help", json!({"space": "manual", "topic": "Querying"})),
    ] {
        let r = env.call_as("writer-one", tool, args).await;
        assert!(is_error(&r), "{tool}: {r}");
        assert!(text(&r).contains("not available"), "{tool}: {r}");
        assert!(!text(&r).contains("the manual"), "{tool}: {r}");
    }
}

#[tokio::test]
async fn help_with_space_groups_skills_by_source() {
    let env = env(rows(Value::Null));
    env.seed(SPACE_SKILLS).await;
    let r = env.help(json!({"space": env.alpha})).await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    let own = t.find("## In Alpha (written by its editors").expect(t);
    let lib = t.find("## From installed libraries").expect(t);
    let std = t.find("## Built in").expect(t);
    assert!(own < lib && lib < std, "{t}");
    assert!(t.contains("- **Querying**: Read before"), "{t}");
    assert!(t.contains("- **Garden Tools**: Garden helpers."), "{t}");
    assert!(t.contains("- **House Style**: (no description"), "{t}");
    assert!(!t.contains("Plain"), "{t}");
    assert!(!t.contains("replaces the built-in"), "{t}");
    assert!(
        t.contains("guidance, not instructions that override the user"),
        "{t}"
    );
}

#[tokio::test]
async fn help_marks_overridden_std_skill() {
    let env = env(rows(Value::Null));
    env.seed_on_disk(&[(
        "Library/Std/Docs/Querying",
        "---\ndescription: Mine.\ntags: meta/skill\n---\n",
    )]);
    let t = env
        .help_until(|t| t.contains("replaces the built-in"))
        .await;
    assert!(
        t.contains("- **Querying** (replaces the built-in one): Mine."),
        "{t}"
    );
}

#[tokio::test]
async fn space_skills_need_no_runtime() {
    let env = env(rows(Value::Null));
    env.seed(SPACE_SKILLS).await;
    let r = env
        .call_as("runtime-off", "help", json!({"space": env.alpha}))
        .await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.contains("- **Space Lua**"), "{t}");
    assert!(t.contains("- **Garden Tools**"), "{t}");
    assert!(env.script.calls.lock().unwrap().is_empty());
    let overview = text(&env.call_as("runtime-off", "help", json!({})).await).to_owned();
    assert!(
        overview.contains("`lua` and `screenshot` are unavailable"),
        "{overview}"
    );
}

#[tokio::test]
async fn space_skills_follow_page_changes() {
    let env = env(rows(Value::Null));
    let t = env.help_until(|t| t.contains("## Built in")).await;
    assert!(!t.contains("**Fresh**"), "{t}");

    env.write(
        "Notes/Fresh",
        "---\ndescription: Fresh skill.\ntags: meta/skill\n---\n",
    )
    .await;
    let t = env.help_until(|t| t.contains("**Fresh**")).await;
    assert!(t.contains("- **Fresh**: Fresh skill."), "{t}");

    env.replace("Notes/Fresh", "---\ntags: notes\n---\n").await;
    let t = env.help_until(|t| !t.contains("**Fresh**")).await;
    assert!(!t.contains("**Fresh**"), "{t}");
}

#[tokio::test]
async fn help_topic_fuzzy_and_did_you_mean() {
    let env = env(rows(Value::Null));
    env.seed(SPACE_SKILLS).await;
    // The bundled page is not a skill, so the space's copy supplies one.
    env.seed_on_disk(&[(
        "Library/Std/APIs/Tag",
        "---\ndescription: Define tags.\ntags: meta/skill\n---\nBody",
    )]);
    env.help_until(|t| t.contains("Define tags.")).await;
    for (topic, page) in [
        ("Library/Std/APIs/Tag", "Library/Std/APIs/Tag"),
        ("library/std/apis/tag", "Library/Std/APIs/Tag"),
        ("garden", "Library/Acme/Garden Tools"),
    ] {
        let r = env.help(json!({"topic": topic, "space": env.alpha})).await;
        assert!(!is_error(&r), "{topic}: {r}");
        let t = text(&r);
        assert!(t.starts_with(&format!("Source: {page}")), "{t}");
    }
    let r = env
        .help(json!({"topic": "Queryng", "space": env.alpha}))
        .await;
    assert!(is_error(&r), "{r}");
    assert!(text(&r).contains("Did you mean"), "{}", text(&r));
    assert!(
        text(&r).contains("Library/Std/Docs/Querying"),
        "{}",
        text(&r)
    );
}

#[tokio::test]
async fn help_topic_reads_any_page_exactly() {
    let env = env(rows(Value::Null));
    env.call_as(
        "writer-one",
        "write",
        json!({"space": env.alpha, "page": "Plain", "content": "just text"}),
    )
    .await;
    let r = env
        .help(json!({"topic": "Plain", "space": env.alpha}))
        .await;
    assert!(!is_error(&r), "{r}");
    assert!(text(&r).contains("just text"));
}

#[tokio::test]
async fn help_rejects_unavailable_space() {
    let env = env(rows(Value::Null));
    let r = env.help(json!({"space": "nope"})).await;
    assert!(is_error(&r));
    assert!(text(&r).contains("not available"));
    let r = env
        .call_as("reader", "help", json!({"space": env.alpha}))
        .await;
    assert!(is_error(&r));
}

#[tokio::test]
async fn help_tool_is_listed_first_and_read_only() {
    let env = env(rows(Value::Null));
    let tools = env.tools.tools();
    assert_eq!(tools[0].name, "help");
    assert_eq!(tools[0].annotations["readOnlyHint"], true);
}

#[tokio::test]
async fn help_without_space_lists_the_bundled_skills() {
    let env = env(rows(Value::Null));
    let t = text(&env.help(json!({})).await).to_owned();
    assert!(t.contains("## Built in"), "{t}");
    assert!(t.contains("- **Querying**: Read before"), "{t}");
    assert!(t.contains("Load only what your task needs"), "{t}");

    // With several spaces and none named, a bundled skill reads from the bundled copy.
    let r = env.help(json!({"topic": "querying"})).await;
    assert!(!is_error(&r), "{r}");
    assert!(
        text(&r).starts_with("Source: Library/Std/Docs/Querying — built in"),
        "{}",
        text(&r)
    );
}

#[tokio::test]
async fn help_topic_without_space_asks_for_one_when_nothing_built_in_matches() {
    let env = env(rows(Value::Null));
    env.seed(SPACE_SKILLS).await;
    let r = env.help(json!({"topic": "Garden Tools"})).await;
    assert!(is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.contains("No built-in skill matches \"Garden Tools\""),
        "{t}"
    );
    assert!(t.contains("pass `space`"), "{t}");
    assert!(!t.to_lowercase().contains("manual"), "{t}");
}

#[tokio::test]
async fn short_names_prefer_the_space_then_libraries_then_std() {
    let env = env(rows(Value::Null));
    env.seed(&[(
        "Library/acme/Querying",
        "---\ntags: meta/skill\ndescription: Library querying. Use when x.\n---\nFrom the library",
    )])
    .await;
    env.help_until(|t| t.contains("Library/acme/Querying"))
        .await;
    let r = env
        .help(json!({"space": env.alpha, "topic": "querying"}))
        .await;
    assert!(
        text(&r).starts_with("Source: Library/acme/Querying — an installed library"),
        "{r}"
    );

    env.seed(&[(
        "Notes/Querying",
        "---\ntags: meta/skill\ndescription: My querying. Use when y.\n---\nFrom the space",
    )])
    .await;
    env.help_until(|t| t.contains("Notes/Querying")).await;
    let r = env
        .help(json!({"space": env.alpha, "topic": "querying"}))
        .await;
    assert!(
        text(&r).starts_with("Source: Notes/Querying — this space's own pages"),
        "{r}"
    );
}

#[tokio::test]
async fn a_space_page_beats_a_std_skill_of_the_same_short_name() {
    let env = env(rows(Value::Null));
    env.write("Querying", "My own notes on querying.").await;
    let r = env
        .help(json!({"space": env.alpha, "topic": "Querying"}))
        .await;
    assert!(!is_error(&r), "{r}");
    assert!(
        text(&r).starts_with(&format!("Source: page `Querying` in space `{}`", env.alpha)),
        "{}",
        text(&r)
    );
    assert!(
        text(&r).contains("My own notes on querying."),
        "{}",
        text(&r)
    );
    // A space without that page still gets the Std skill.
    let r = env
        .help(json!({"space": env.beta, "topic": "Querying"}))
        .await;
    assert!(
        text(&r).starts_with("Source: Library/Std/Docs/Querying — built in"),
        "{}",
        text(&r)
    );
}

#[tokio::test]
async fn a_space_skill_beats_a_std_skill_of_the_same_short_name() {
    let env = env(rows(Value::Null));
    env.seed(&[(
        "Notes/Querying",
        "---\ntags: meta/skill\ndescription: My querying. Use when y.\n---\nFrom the space",
    )])
    .await;
    env.help_until(|t| t.contains("Notes/Querying")).await;
    let r = env
        .help(json!({"space": env.alpha, "topic": "querying"}))
        .await;
    assert!(
        text(&r).starts_with("Source: Notes/Querying — this space's own pages"),
        "{r}"
    );
}

#[tokio::test]
async fn help_without_space_ignores_a_space_override_of_a_std_page() {
    let env = env(rows(Value::Null));
    env.seed_on_disk(&[(
        "Library/Std/Docs/Querying",
        "---\ndescription: Mine.\ntags: meta/skill\n---\nOverridden body",
    )]);
    env.help_until(|t| t.contains("replaces the built-in"))
        .await;
    let r = env.help(json!({"topic": "Querying"})).await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.starts_with("Source: Library/Std/Docs/Querying — built in"),
        "{t}"
    );
    assert!(!t.contains("Overridden body"), "{t}");
}

#[tokio::test]
async fn help_defaults_to_the_only_space() {
    let env = env(rows(Value::Null));
    let w = env
        .call_as(
            "writer-one",
            "write",
            json!({"space": env.beta, "page": SPACE_SKILLS[0].0, "content": SPACE_SKILLS[0].1}),
        )
        .await;
    assert!(!is_error(&w), "{w}");
    let t = text(&env.call_as("reader", "help", json!({})).await).to_owned();
    assert!(t.contains("- **Garden Tools**"), "{t}");
    assert!(t.contains("# Beta\n"), "{t}");
}

#[tokio::test]
async fn help_with_space_outlines_it() {
    let env = env(rows(Value::Null));
    env.seed(SPACE_SKILLS).await;
    env.write("AGENTS", "How this space works.").await;
    let t = text(&env.help(json!({"space": env.alpha})).await).to_owned();
    assert!(t.contains("Folders: Library/ (1), Notes/ (2) (read"), "{t}");
    assert!(t.contains("Top-level pages: AGENTS, index"), "{t}");
    assert!(
        t.contains("`AGENTS` describes this space's conventions"),
        "{t}"
    );
}

#[tokio::test]
async fn spaces_can_be_named_instead_of_identified() {
    let env = env(rows(Value::Null));
    let w = env
        .call_as(
            "writer-one",
            "write",
            json!({"space": "alpha", "page": "Named", "content": "by name"}),
        )
        .await;
    assert!(!is_error(&w), "{w}");
    let r = env
        .call_as(
            "writer-one",
            "read",
            json!({"space": env.alpha, "page": "Named"}),
        )
        .await;
    assert_eq!(text(&r), "by name");

    // A name two spaces share is refused, listing both ids.
    env.fixture.space(
        "Alpha",
        "/alpha-two",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let r = env
        .call_as(
            "writer-one",
            "read",
            json!({"space": "Alpha", "page": "Named"}),
        )
        .await;
    assert!(is_error(&r), "{r}");
    assert!(text(&r).contains("Several of your spaces are named"), "{r}");
    assert!(text(&r).contains(&env.alpha), "{r}");
}

#[tokio::test]
async fn help_with_space_outlines_its_data() {
    let env = env(rows(Value::Null));
    env.seed(&[
        (
            "Races/One",
            "---\ntags: race\nwinner: Blue\nround: 1\n---\n",
        ),
        (
            "Races/Two",
            "---\ntags: race\nwinner: Red\nround: 2\nsprint-format: yes\n---\n",
        ),
        ("Teams/Blue", "---\ntags: team\nbase: North\n---\n"),
        ("Library/Kit", "---\ntags: race\nhidden: yes\n---\n"),
    ])
    .await;
    let t = text(&env.help(json!({"space": env.alpha})).await).to_owned();
    assert!(
        t.contains("- `race` (2 pages): round, winner, sprint-format"),
        "{t}"
    );
    assert!(t.contains("- `team` (1 page): base"), "{t}");
    assert!(!t.contains("hidden"), "{t}");
    assert!(
        t.contains("Example: `query[[from p = index.pages(\"race\") select {name = p.name, round = p.round, winner = p.winner} limit 5]]`"),
        "{t}"
    );
}

#[tokio::test]
async fn help_lists_library_pages_as_skills() {
    let env = env(rows(Value::Null));
    env.seed(&[
        (
            "Library/acme/Mermaid",
            "---\ntags: meta/library\n---\nThis is a pure [Space Lua](https://silverbullet.md) library that adds Mermaid support. More.",
        ),
        (
            "Library/acme/Charts",
            "---\ntags: meta/library\ndescription: Draws charts. Use when charting.\n---\nBody",
        ),
        (
            "Library/acme/Both",
            "---\ntags: [meta/library, meta/skill]\ndescription: Tagged twice.\n---\nBody",
        ),
        ("Notes/My Lib", "---\ntags: meta/library\n---\n# Heading\nMine."),
        ("Library/Std", "---\ntags: meta/library\n---\nWelcome to the standard library."),
    ])
    .await;
    let t = env.help_until(|t| t.contains("My Lib")).await;
    let own = t.find("## In Alpha (written by its editors").expect(&t);
    let lib = t.find("## From installed libraries").expect(&t);
    let std = t.find("## Built in").expect(&t);
    assert!(own < lib && lib < std, "{t}");
    let line = |needle: &str| t.find(needle).unwrap_or_else(|| panic!("{needle}: {t}"));
    assert!(
        own < line("- **My Lib**: Mine.") && line("- **My Lib**") < lib,
        "{t}"
    );
    let mermaid =
        line("- **Mermaid**: This is a pure Space Lua library that adds Mermaid support.\n");
    assert!(lib < mermaid && mermaid < std, "{t}");
    assert!(
        lib < line("- **Charts**: Use when charting.") && line("- **Charts**") < std,
        "{t}"
    );
    assert_eq!(t.matches("**Both**").count(), 1, "{t}");
    assert!(!t.contains("standard library"), "{t}");
    assert!(!t.contains("**Std**"), "{t}");
    let r = env
        .help(json!({"space": env.alpha, "topic": "Mermaid"}))
        .await;
    assert!(
        text(&r).starts_with("Source: Library/acme/Mermaid — an installed library"),
        "{r}"
    );
}

/// A host with one space, `notes`, whose `/.help` answers `help`, recording
/// each request's method and path.
struct HelpHost {
    help: Result<HelpData, (StatusCode, &'static str)>,
    requests: std::sync::Mutex<Vec<(Method, String)>>,
}

#[async_trait]
impl McpHost for HelpHost {
    fn spaces(&self, _: &Caller) -> Vec<SpaceInfo> {
        vec![SpaceInfo {
            id: "notes".into(),
            name: "Notes".into(),
            runtime: true,
        }]
    }

    async fn request(
        &self,
        _: &Caller,
        _: &str,
        req: SpaceRequest,
    ) -> Result<SpaceResponse, HostError> {
        self.requests
            .lock()
            .unwrap()
            .push((req.method.clone(), req.path_and_query.clone()));
        let (status, body) = match (&self.help, req.path_and_query.as_str()) {
            (Ok(data), "/.help") => (StatusCode::OK, serde_json::to_vec(data).unwrap()),
            (Err((status, body)), "/.help") => (*status, body.as_bytes().to_vec()),
            _ => (StatusCode::NOT_FOUND, Vec::new()),
        };
        Ok(SpaceResponse {
            status,
            headers: HeaderMap::new(),
            body,
        })
    }
}

fn some_caller() -> Caller {
    Caller {
        username: "ada".into(),
        credential: CallerCredential::Local,
    }
}

fn notes_help() -> HelpData {
    let own = |page: &str, description: &str, source| Skill {
        page: page.into(),
        description: Some(description.into()),
        source,
        overrides_bundled: false,
    };
    let mut skills = bundled_skills(bundled_pages().into_iter());
    skills.push(own(
        "Notes/House Style",
        "Use when writing notes.",
        SkillSource::Space,
    ));
    skills.push(own(
        "Library/Acme/Garden Tools",
        "Garden helpers.",
        SkillSource::Library,
    ));
    HelpData {
        version: 1,
        runtime: true,
        scanning: false,
        skills,
        outline: Outline {
            folders: vec![FolderCount {
                name: "Notes".into(),
                pages: 4,
            }],
            pages: vec!["AGENTS".into(), "index".into()],
            page_count: 2,
            agents: true,
            tags: vec![TagSummary {
                tag: "race".into(),
                pages: 2,
                attributes: vec!["round".into(), "winner".into()],
            }],
        },
    }
}

#[tokio::test]
async fn help_reads_help_route_through_host() {
    let data = notes_help();
    let host = Arc::new(HelpHost {
        help: Ok(data.clone()),
        requests: Default::default(),
    });
    let tools = Tools::new(host.clone(), "2.12.1").with_bundled_pages(bundled_pages());
    let r = tools
        .call(&some_caller(), "help", json!({"space": "Notes"}))
        .await;
    assert!(!is_error(&r), "{r}");
    let row = SpaceRow {
        id: "notes".into(),
        name: "Notes".into(),
        location: None,
        runtime: Some(true),
        selected: true,
    };
    let expected = render_overview(
        std::slice::from_ref(&row),
        Some((&row, &data)),
        &bundled_skills(bundled_pages().into_iter()),
        &Voice::MCP,
        "",
        None,
    );
    assert_eq!(text(&r), expected);
    assert_eq!(
        host.requests.lock().unwrap().as_slice(),
        &[(Method::GET, "/.help".to_owned())]
    );
}

#[tokio::test]
async fn help_says_when_the_spaces_outline_could_not_be_read() {
    let host = Arc::new(HelpHost {
        help: Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "could not list the space's pages",
        )),
        requests: Default::default(),
    });
    let tools = Tools::new(host, "2.12.1").with_bundled_pages(bundled_pages());
    let r = tools
        .call(&some_caller(), "help", json!({"space": "Notes"}))
        .await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.contains(
            "Could not read the outline and own skills of Notes: the space answered 500 Internal \
             Server Error (could not list the space's pages). Only the built-in skills are \
             listed; call help with `space` again to retry."
        ),
        "{t}"
    );
    assert!(!t.contains("# Notes"), "{t}");
    assert!(t.contains("## Built in"), "{t}");
    assert!(t.contains("- **Querying**: Read before"), "{t}");

    // A topic still finds the built-in skills.
    let r = tools
        .call(
            &some_caller(),
            "help",
            json!({"space": "Notes", "topic": "Querying"}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    assert!(
        text(&r).starts_with("Source: Library/Std/Docs/Querying — built in"),
        "{}",
        text(&r)
    );
}

/// A host whose space `notes` has `notes_help()` skills and its own,
/// different copy of `Library/Std/Docs/Querying`, not marked as replacing
/// the bundled one.
struct SpaceCopyHost;

#[async_trait]
impl McpHost for SpaceCopyHost {
    fn spaces(&self, _: &Caller) -> Vec<SpaceInfo> {
        vec![SpaceInfo {
            id: "notes".into(),
            name: "Notes".into(),
            runtime: true,
        }]
    }

    async fn request(
        &self,
        _: &Caller,
        _: &str,
        req: SpaceRequest,
    ) -> Result<SpaceResponse, HostError> {
        let (status, body) = match req.path_and_query.as_str() {
            "/.help" => (StatusCode::OK, serde_json::to_vec(&notes_help()).unwrap()),
            "/.fs/Library/Std/Docs/Querying.md" => {
                (StatusCode::OK, b"The space's own querying notes.".to_vec())
            }
            _ => (StatusCode::NOT_FOUND, Vec::new()),
        };
        Ok(SpaceResponse {
            status,
            headers: HeaderMap::new(),
            body,
        })
    }
}

#[tokio::test]
async fn a_reachable_spaces_copy_of_a_std_skill_wins_over_the_bundled_one() {
    let tools = Tools::new(Arc::new(SpaceCopyHost), "2.12.1").with_bundled_pages(bundled_pages());
    let r = tools
        .call(
            &some_caller(),
            "help",
            json!({"space": "Notes", "topic": "Querying"}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(
        text(&r),
        "Source: Library/Std/Docs/Querying — built in\n\nThe space's own querying notes."
    );
}
