use std::process::Command;

#[test]
fn filesystem_help_exposes_commands_without_runtime_or_connection() {
    let output = Command::new(env!("CARGO_BIN_EXE_sb"))
        .args(["fs", "--help"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let help = String::from_utf8(output.stdout).unwrap();
    for name in ["ls", "read", "stat", "write", "edit", "rm"] {
        assert!(help.contains(name), "{help}");
    }
    assert!(!help.contains("search"));
}

#[test]
fn invalid_write_policy_reports_json_before_resolving_connection() {
    let cfg = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_sb"))
        .args(["fs", "write", "Draft.md", "--json"])
        .env("XDG_CONFIG_HOME", cfg.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let error: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(error["error"]["code"], "invalid_arguments");
    assert!(output.stdout.is_empty());
}

#[test]
fn malformed_options_use_structured_errors_when_requested() {
    for args in [
        vec!["fs", "read", "--json"],
        vec!["fs", "read", "Draft.md", "--max-bytes", "lots", "--json"],
        vec!["--json", "fs", "ls", "--unknown"],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_sb"))
            .args(args)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        let error: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
        assert_eq!(error["error"]["code"], "invalid_arguments");
    }
}

#[test]
fn unavailable_saved_browser_credentials_report_authentication_failure() {
    let cfg = tempfile::tempdir().unwrap();
    let dir = cfg.path().join("silverbullet");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(
        dir.join("config.json"),
        serde_json::json!({"spaces":[{
            "id":"notes-id", "name":"notes", "url":"https://notes.example.com",
            "auth":{"method":"browser"}
        }]})
        .to_string(),
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_sb"))
        .args(["--space", "notes", "fs", "stat", "Draft.md", "--json"])
        .env("XDG_CONFIG_HOME", cfg.path())
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(4),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&output.stderr).unwrap();
    assert_eq!(value["error"]["code"], "authentication_required");
    assert!(output.stdout.is_empty());
}

fn read_args(args: &[&str]) -> std::process::Output {
    let cfg = tempfile::tempdir().unwrap();
    Command::new(env!("CARGO_BIN_EXE_sb"))
        .args(["fs", "read"])
        .args(args)
        .env("XDG_CONFIG_HOME", cfg.path())
        .output()
        .unwrap()
}

#[test]
fn read_accepts_up_to_twenty_paths() {
    let twenty: Vec<String> = (1..=20).map(|i| format!("P{i}.md")).collect();
    let args: Vec<&str> = twenty.iter().map(String::as_str).collect();
    let output = read_args(&args);
    // Parsing and validation pass; the missing connection is the only failure.
    assert_ne!(
        output.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let twenty_one: Vec<String> = (1..=21).map(|i| format!("P{i}.md")).collect();
    let args: Vec<&str> = twenty_one.iter().map(String::as_str).collect();
    let output = read_args(&args);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("at most 20"));
}

#[test]
fn several_paths_conflict_with_lines_offset_rendered_and_outline() {
    for flag in [
        vec!["--lines", "1:2"],
        vec!["--offset", "2"],
        vec!["--limit", "2"],
        vec!["--number"],
        vec!["--rendered"],
        vec!["--outline"],
    ] {
        let mut args = vec!["A.md", "B.md"];
        args.extend(&flag);
        let output = read_args(&args);
        assert_eq!(output.status.code(), Some(2), "{flag:?}");
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn offset_limit_conflict_with_lines() {
    for flag in ["--offset", "--limit"] {
        let output = read_args(&["A.md", "--lines", "1:2", flag, "1"]);
        assert_eq!(output.status.code(), Some(2), "{flag}");
    }
}

#[test]
fn rendered_conflicts_with_outline() {
    let output = read_args(&["A.md", "--rendered", "--outline"]);
    assert_eq!(output.status.code(), Some(2));
}
