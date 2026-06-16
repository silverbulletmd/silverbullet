use std::path::Path;

fn main() {
    let manifest = env!("CARGO_MANIFEST_DIR");
    // Inject the version from the generated `version.json` (a language-neutral
    // file shared with the TypeScript client and the `silverbullet` server).
    let version_json = Path::new(manifest).join("../../version.json");
    println!("cargo:rerun-if-changed=../../version.json");
    let version = std::fs::read_to_string(&version_json)
        .ok()
        .and_then(|s| parse_version(&s))
        .unwrap_or_else(|| "0.0.0".to_string());
    println!("cargo:rustc-env=SB_VERSION={version}");
}

/// Extract `version` from `version.json` (`{ "version": "…" }`).
fn parse_version(src: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(src).ok()?;
    let v = value.get("version")?.as_str()?.trim();
    (!v.is_empty()).then(|| v.to_string())
}
