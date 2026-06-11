use std::path::Path;

fn main() {
    // The client bundle is a build artifact (gitignored); `rust-embed` embeds it
    // at compile time, so fail early with a clear message if it's missing.
    let manifest = env!("CARGO_MANIFEST_DIR");
    let bundle = Path::new(manifest).join("../../client_bundle/client");
    if !bundle.join(".client/index.html").exists() {
        panic!(
            "client bundle not found at {} — run `make` in the silverbullet/ submodule first \
             (it builds client_bundle/{{client,base_fs}})",
            bundle.display()
        );
    }
    println!("cargo:rerun-if-changed=../../client_bundle/client");
    println!("cargo:rerun-if-changed=../../client_bundle/base_fs");

    // Inject the version from the generated `version.json` (a language-neutral
    // file shared with the TypeScript client).
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
