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

    // Inject the version from `public_version.ts` (the git-describe-with-build-
    // timestamp string, e.g. "2.8.1-69-g3ee2d4ef-2026-06-02T07-02-04Z"). This MUST
    // match what the client is built with: the client compares the server's
    // reported version against its compiled-in `publicVersion`, and any mismatch
    // shows a perpetual "a new version is available" banner. (`version.ts` holds
    // only the plain semver and must NOT be used here.)
    let version_ts = Path::new(manifest).join("../../public_version.ts");
    println!("cargo:rerun-if-changed=../../public_version.ts");
    let version = std::fs::read_to_string(&version_ts)
        .ok()
        .and_then(|s| parse_version(&s))
        .unwrap_or_else(|| "0.0.0".to_string());
    println!("cargo:rustc-env=SB_VERSION={version}");
}

/// Extract the first double-quoted string literal (the version value) — the
/// `public_version.ts` version regex `"([^"]+)"`.
fn parse_version(src: &str) -> Option<String> {
    let start = src.find('"')? + 1;
    let rest = &src[start..];
    let end = rest.find('"')?;
    let v = rest[..end].trim();
    (!v.is_empty()).then(|| v.to_string())
}
