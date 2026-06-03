use std::path::Path;

fn main() {
    let manifest = env!("CARGO_MANIFEST_DIR");
    let version_ts = Path::new(manifest).join("../../public_version.ts");
    println!("cargo:rerun-if-changed=../../public_version.ts");
    let version = std::fs::read_to_string(&version_ts)
        .ok()
        .and_then(|s| parse_version(&s))
        .unwrap_or_else(|| "0.0.0".to_string());
    println!("cargo:rustc-env=SB_VERSION={version}");
}

/// Extract the first double-quoted string literal (the version value), matching
/// the Go server's `ParseVersionFromTypeScript` regex `"([^"]+)"`.
fn parse_version(src: &str) -> Option<String> {
    let start = src.find('"')? + 1;
    let rest = &src[start..];
    let end = rest.find('"')?;
    let v = rest[..end].trim();
    (!v.is_empty()).then(|| v.to_string())
}
