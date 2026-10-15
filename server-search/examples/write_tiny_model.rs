//! Writes the tiny test model and its `spec.json` into a directory: the e2e
//! tests' model fixture.
//!
//! `cargo run -p silverbullet-server-search --example write_tiny_model --features test-model -- <dir>`

fn main() {
    let Some(dir) = std::env::args_os().nth(1) else {
        eprintln!("usage: write_tiny_model <dir>");
        std::process::exit(2);
    };
    let dir = std::path::PathBuf::from(dir);
    let spec = silverbullet_server_search::semantic::test_model::write_tiny_model(&dir, 7);
    let files: Vec<_> = spec
        .files
        .iter()
        .map(|f| serde_json::json!({ "name": f.name, "size": f.size, "sha256": f.sha256 }))
        .collect();
    let json = serde_json::json!({ "files": files }).to_string();
    std::fs::write(dir.join("spec.json"), json).expect("write spec.json");
}
