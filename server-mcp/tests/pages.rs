mod support;

use std::sync::Arc;

use axum::http::Method;
use serde_json::{json, Value};
use silverbullet_server_mcp::{Caller, McpHost, SpaceRequest, ToolSet, Tools, MAX_RESULT_BYTES};
use support::Fixture;

struct Env {
    fixture: Fixture,
    tools: Tools,
    caller: Caller,
    space: String,
}

fn env() -> Env {
    let fixture = Fixture::new();
    let space = fixture.space(
        "Alpha",
        "/alpha",
        "none",
        json!({"writer-one": {"role": "write"}}),
    );
    let tools = Tools::new(fixture.host.clone(), "2.12.1");
    let caller = fixture.caller("writer-one");
    Env {
        fixture,
        tools,
        caller,
        space,
    }
}

impl Env {
    async fn call(&self, tool: &str, mut args: Value) -> Value {
        args["space"] = json!(self.space);
        self.tools.call(&self.caller, tool, args).await
    }

    async fn write(&self, page: &str, content: &str) -> Value {
        self.call("write", json!({"page": page, "content": content}))
            .await
    }

    async fn put_raw(&self, path: &str, body: Vec<u8>) {
        let response = self
            .fixture
            .host
            .request(
                &self.caller,
                &self.space,
                SpaceRequest {
                    method: Method::PUT,
                    path_and_query: format!("/.fs/{path}"),
                    body,
                    headers: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert!(response.status.is_success());
    }

    async fn revision(&self, page: &str) -> String {
        let r = self.call("read", json!({"page": page})).await;
        r["structuredContent"]["revision"].as_str().unwrap().into()
    }
}

fn text(result: &Value) -> &str {
    result["content"][0]["text"].as_str().unwrap()
}

fn is_error(result: &Value) -> bool {
    result["isError"] == true
}

#[tokio::test]
async fn read_returns_markdown_and_revision() {
    let env = env();
    let r = env.call("read", json!({"page": "index"})).await;
    assert!(!is_error(&r), "{r}");
    assert!(text(&r).contains("# Fixture"));
    let s = &r["structuredContent"];
    assert_eq!(s["page"], "index");
    assert_eq!(s["truncated"], false);
    assert!(s["lines"].as_u64().unwrap() >= 1);
    assert!(s["revision"].as_str().unwrap().contains("sha256:"));

    let missing = env.call("read", json!({"page": "Nope/Missing"})).await;
    assert!(is_error(&missing));
    assert!(text(&missing).contains("not found"));
}

#[tokio::test]
async fn read_with_offset_numbers_lines() {
    let env = env();
    env.write("Numbers", "one\ntwo\nthree\nfour\nfive\n").await;
    let r = env
        .call("read", json!({"page": "Numbers", "offset": 2, "limit": 2}))
        .await;
    assert_eq!(text(&r), "    2\ttwo\n    3\tthree");
    assert_eq!(r["structuredContent"]["lines"], 5);
    let r = env
        .call("read", json!({"page": "Numbers", "limit": 1}))
        .await;
    assert_eq!(text(&r), "    1\tone");
}

#[tokio::test]
async fn read_listing_prefix() {
    let env = env();
    env.write("Projects/Garden Plan", "x").await;
    env.write("Projects/Roof", "y").await;
    env.write("Other", "z").await;
    let r = env.call("read", json!({"page": "Projects/"})).await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(
        t.starts_with("2 page(s) in \"Projects/\":\n- Projects/Garden Plan\n- Projects/Roof"),
        "{t}"
    );
    assert!(!t.contains("lastModified"), "{t}");

    let all = env.call("read", json!({"page": "/"})).await;
    let names: Vec<_> = all["structuredContent"]["pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_owned())
        .collect();
    assert!(names.contains(&"Other".to_owned()));
    assert!(names.contains(&"index".to_owned()));
}

#[tokio::test]
async fn long_listing_groups_subfolders() {
    let env = env();
    for i in 0..70 {
        env.write(&format!("Races/Round {i:02}"), "x").await;
    }
    env.write("Teams/Blue", "x").await;
    env.write("Season", "x").await;
    let r = env.call("read", json!({"page": "/"})).await;
    let t = text(&r);
    assert!(t.contains("- Races/ (70)\n- Teams/ (1)"), "{t}");
    assert!(t.contains("- Season"), "{t}");
    assert!(!t.contains("Round 05"), "{t}");
    assert_eq!(r["structuredContent"]["total"], 73);
}

#[tokio::test]
async fn read_truncates_over_max_result_bytes() {
    let env = env();
    let content = "0123456789abcdef\n".repeat(300_000 / 17);
    env.write("Big", &content).await;
    let r = env.call("read", json!({"page": "Big"})).await;
    assert!(!is_error(&r));
    assert_eq!(r["structuredContent"]["truncated"], true);
    let t = text(&r);
    assert!(t.len() < MAX_RESULT_BYTES + 400);
    assert!(t.contains("offset"));
    assert!(t.contains("limit"));

    let next = env
        .call("read", json!({"page": "Big", "offset": 6000, "limit": 3}))
        .await;
    assert_eq!(next["structuredContent"]["truncated"], false);
}

#[tokio::test]
async fn write_creates_and_replaces() {
    let env = env();
    let created = env.write("Café/Menü", "first").await;
    assert!(!is_error(&created), "{created}");
    let r = env.call("read", json!({"page": "Café/Menü"})).await;
    assert_eq!(text(&r), "first");
    let rev1 = created["structuredContent"]["revision"].clone();
    assert_eq!(rev1, r["structuredContent"]["revision"]);

    env.write("Café/Menü", "second").await;
    let r = env.call("read", json!({"page": "Café/Menü"})).await;
    assert_eq!(text(&r), "second");

    for page in ["has space #1?", "Q&A 100%"] {
        env.write(page, page).await;
        assert_eq!(text(&env.call("read", json!({"page": page})).await), page);
    }
}

#[tokio::test]
async fn write_with_stale_if_revision_reports_conflict() {
    let env = env();
    env.write("Doc", "v1").await;
    let stale = env.revision("Doc").await;
    env.write("Doc", "v2").await;
    let current = env.revision("Doc").await;

    let r = env
        .call(
            "write",
            json!({"page": "Doc", "content": "v3", "ifRevision": stale}),
        )
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("changed since revision"));
    assert!(text(&r).contains(&current));
    assert!(text(&r).contains("re-read the page"));
    assert_eq!(text(&env.call("read", json!({"page": "Doc"})).await), "v2");

    let ok = env
        .call(
            "write",
            json!({"page": "Doc", "content": "v3", "ifRevision": current}),
        )
        .await;
    assert!(!is_error(&ok), "{ok}");
}

#[tokio::test]
async fn edit_applies_multiple_edits_atomically() {
    let env = env();
    env.write("Doc", "alpha\nbeta\ngamma\n").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [
                {"oldText": "gamma", "newText": "GAMMA"},
                {"oldText": "alpha", "newText": "ALPHA"},
            ]}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(
        text(&env.call("read", json!({"page": "Doc"})).await),
        "ALPHA\nbeta\nGAMMA\n"
    );

    let bad = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [
                {"oldText": "GAMMA", "newText": "G"},
                {"oldText": "absent", "newText": "x"},
            ]}),
        )
        .await;
    assert!(is_error(&bad));
    assert_eq!(
        text(&env.call("read", json!({"page": "Doc"})).await),
        "ALPHA\nbeta\nGAMMA\n"
    );
}

#[tokio::test]
async fn edits_are_located_in_the_page_as_read() {
    let env = env();
    env.write("Doc", "alpha\nbeta\n").await;
    // The second edit's text only exists once the first is applied.
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [
                {"oldText": "alpha", "newText": "ALPHA"},
                {"oldText": "ALPHA\nbeta", "newText": "joined"},
            ]}),
        )
        .await;
    assert!(is_error(&r));
    assert!(
        text(&r).starts_with("edit 2: oldText not found."),
        "{}",
        text(&r)
    );

    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [
                {"oldText": "alpha\nbeta", "newText": "joined"},
                {"oldText": "beta", "newText": "B"},
            ]}),
        )
        .await;
    assert!(is_error(&r));
    assert_eq!(text(&r), "edits 1 and 2 overlap. Nothing was changed.");
    assert_eq!(
        text(&env.call("read", json!({"page": "Doc"})).await),
        "alpha\nbeta\n"
    );
}

#[tokio::test]
async fn edit_zero_match_reports_closest_and_changes_nothing() {
    let env = env();
    let body = "l1\nl2\nl3\nThe quick brown fox\njumps over\nl6\nl7\nl8\n";
    env.write("Doc", body).await;
    let rev = env.revision("Doc").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [
                {"oldText": "The quick brown fax\njumps over", "newText": "x"},
            ]}),
        )
        .await;
    assert!(is_error(&r));
    let t = text(&r);
    assert!(t.contains("lines 4-5"), "{t}");
    assert!(t.contains("The quick brown fox"));
    assert!(t.contains("l2"), "context lines shown: {t}");
    assert_eq!(env.revision("Doc").await, rev);
}

#[tokio::test]
async fn edit_multi_match_reports_count() {
    let env = env();
    env.write("Doc", "x\ny\nx\nz\nx\n").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [{"oldText": "x", "newText": "w"}]}),
        )
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("matches 3 times; add surrounding context"));
    assert_eq!(
        text(&env.call("read", json!({"page": "Doc"})).await),
        "x\ny\nx\nz\nx\n"
    );
}

#[tokio::test]
async fn edit_preserves_crlf() {
    let env = env();
    env.write("Doc", "one\r\ntwo\r\nthree\r\n").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [{"oldText": "one\ntwo", "newText": "1\n2\n2b"}]}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    assert_eq!(
        text(&env.call("read", json!({"page": "Doc"})).await),
        "1\r\n2\r\n2b\r\nthree\r\n"
    );
}

#[tokio::test]
async fn edit_dry_run_returns_diff_without_writing() {
    let env = env();
    env.write("Doc", "a\nb\nc\n").await;
    let rev = env.revision("Doc").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "dryRun": true,
                   "edits": [{"oldText": "b", "newText": "B"}]}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.contains("-b"), "{t}");
    assert!(t.contains("+B"), "{t}");
    assert!(t.contains("@@"));
    assert_eq!(env.revision("Doc").await, rev);
}

#[tokio::test]
async fn edit_with_stale_if_revision_reports_conflict() {
    let env = env();
    env.write("Doc", "a\n").await;
    let stale = env.revision("Doc").await;
    env.write("Doc", "a\nb\n").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "ifRevision": stale,
                   "edits": [{"oldText": "a", "newText": "A"}]}),
        )
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("changed since revision"));
}

#[tokio::test]
async fn write_to_read_only_space_is_refused() {
    let fixture = Fixture::new();
    let read_only = fixture.space(
        "Beta",
        "/beta",
        "none",
        json!({"writer-one": {"role": "read"}}),
    );
    let tools = Tools::new(Arc::clone(&fixture.host) as _, "2.12.1");
    let caller = fixture.caller("writer-one");
    let r = tools
        .call(
            &caller,
            "write",
            json!({"space": read_only, "page": "x", "content": "y"}),
        )
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("not available"));
}

#[tokio::test]
async fn a_misspelled_option_is_refused_and_nothing_is_written() {
    let env = env();
    env.write("Doc", "a").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "dry_run": true, "edits": [{"oldText": "a", "newText": "b"}]}),
        )
        .await;
    assert!(is_error(&r), "{r}");
    assert!(text(&r).contains("unknown field `dry_run`"), "{}", text(&r));
    assert!(text(&r).contains("`dryRun`"), "{}", text(&r));
    let read = env.call("read", json!({"page": "Doc"})).await;
    assert_eq!(text(&read), "a");
}

#[tokio::test]
async fn invalid_arguments_are_tool_errors() {
    let env = env();
    for (tool, args) in [
        ("read", json!({"page": "../x"})),
        ("read", json!({})),
        ("write", json!({"page": ".hidden", "content": "x"})),
        ("write", json!({"page": "ok"})),
        ("edit", json!({"page": "ok", "edits": []})),
    ] {
        let mut args = args;
        args["space"] = json!(env.space);
        let r = env.tools.call(&env.caller, tool, args).await;
        assert!(is_error(&r), "{tool}: {r}");
    }
    let r = env.tools.call(&env.caller, "nope", json!({})).await;
    assert!(is_error(&r));
}

#[tokio::test]
async fn read_returns_jpeg_and_refuses_oversize_images() {
    let env = env();
    env.put_raw("img/a.jpg", vec![0xff, 0xd8, 0xff, 1, 2]).await;
    let r = env.call("read", json!({"page": "img/a.jpg"})).await;
    assert_eq!(r["content"][0]["type"], "image");
    assert_eq!(r["content"][0]["mimeType"], "image/jpeg");

    env.put_raw("img/big.png", vec![7; MAX_RESULT_BYTES * 7 + 1])
        .await;
    let r = env.call("read", json!({"page": "img/big.png"})).await;
    assert!(is_error(&r));
    assert!(text(&r).contains("screenshot"));
}

#[tokio::test]
async fn edit_refuses_non_utf8_and_writes_nothing() {
    let env = env();
    let bytes = vec![b'a', b'b', 0xff, 0xfe, b'c'];
    env.put_raw("Bin.md", bytes.clone()).await;
    let r = env
        .call(
            "edit",
            json!({"page": "Bin", "edits": [{"oldText": "ab", "newText": "x"}]}),
        )
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("not valid UTF-8"));
    let got = env
        .fixture
        .host
        .request(
            &env.caller,
            &env.space,
            SpaceRequest {
                method: Method::GET,
                path_and_query: "/.fs/Bin.md".into(),
                body: Vec::new(),
                headers: Vec::new(),
            },
        )
        .await
        .unwrap();
    assert_eq!(got.body, bytes);
}

#[tokio::test]
async fn edit_closest_match_lines_refer_to_original_page() {
    let env = env();
    env.write("Doc", "a\nb\nc\ntarget line\n").await;
    let r = env
        .call(
            "edit",
            json!({"page": "Doc", "edits": [
                {"oldText": "a\nb", "newText": "z"},
                {"oldText": "targat line", "newText": "x"},
            ]}),
        )
        .await;
    assert!(is_error(&r));
    assert!(text(&r).contains("lines 4-4"), "{}", text(&r));
}

#[tokio::test]
async fn read_several_pages_in_one_call() {
    let env = env();
    env.write("Reading/Dune", "about sand").await;
    env.write("Reading/Emma", "about matches").await;
    let r = env
        .call(
            "read",
            json!({"pages": ["Reading/Dune", "Reading/Emma", "Reading/Missing"]}),
        )
        .await;
    assert!(!is_error(&r), "{r}");
    let t = text(&r);
    assert!(t.starts_with("=== Reading/Dune (revision "), "{t}");
    assert!(
        t.contains("about sand\n\n=== Reading/Emma (revision "),
        "{t}"
    );
    assert!(
        t.contains("=== Reading/Missing (error) ===\npage \"Reading/Missing\" not found"),
        "{t}"
    );
    let pages = r["structuredContent"]["pages"].as_array().unwrap();
    assert_eq!(pages.len(), 3);
    assert!(pages[0]["revision"].is_string());

    let both = env
        .call(
            "read",
            json!({"page": "Reading/Dune", "pages": ["Reading/Emma"]}),
        )
        .await;
    assert!(is_error(&both), "{both}");
    let sliced = env
        .call("read", json!({"pages": ["Reading/Dune"], "limit": 1}))
        .await;
    assert!(is_error(&sliced), "{sliced}");
}
