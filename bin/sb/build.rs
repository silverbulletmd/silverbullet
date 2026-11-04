use std::path::{Path, PathBuf};

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
    embed_std_skills(Path::new(manifest));
}

/// Write `OUT_DIR/std_skills.rs`: the `Library/Std` pages tagged `meta/skill`,
/// as `(path, text)` pairs, so `sb help` lists them without a space.
fn embed_std_skills(manifest: &Path) {
    let libraries = manifest.join("../../libraries");
    let std_dir = libraries.join("Library/Std");
    println!("cargo:rerun-if-changed={}", std_dir.display());
    assert!(
        std_dir.is_dir(),
        "sb embeds the Std skill pages from {}, which is missing; build sb inside the SilverBullet repository",
        std_dir.display()
    );
    let mut files = Vec::new();
    collect_markdown(&std_dir, &mut files);
    let mut pages: Vec<(String, PathBuf)> = files
        .into_iter()
        .filter(|file| {
            std::fs::read_to_string(file).is_ok_and(|text| frontmatter_has_skill_tag(&text))
        })
        .filter_map(|file| {
            let relative = file.strip_prefix(&libraries).ok()?;
            let path = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            let absolute = std::fs::canonicalize(&file).ok()?;
            Some((path, absolute))
        })
        .collect();
    pages.sort();
    assert!(
        !pages.is_empty(),
        "no `meta/skill` pages found under {}",
        std_dir.display()
    );
    let mut source = String::from("pub static STD_SKILLS: &[(&str, &str)] = &[\n");
    for (path, absolute) in pages {
        source.push_str(&format!(
            "    ({path:?}, include_str!({:?})),\n",
            absolute.to_string_lossy()
        ));
    }
    source.push_str("];\n");
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("std_skills.rs");
    std::fs::write(out, source).expect("write std_skills.rs");
}

fn collect_markdown(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_markdown(&path, files);
        } else if path.extension().is_some_and(|e| e == "md") {
            files.push(path);
        }
    }
}

/// `meta/skill` among the leading frontmatter's `tags` (inline, flow list or
/// block list). `sb` parses the pages properly at run time as well.
fn frontmatter_has_skill_tag(text: &str) -> bool {
    let text = text.replace("\r\n", "\n");
    let Some(rest) = text.strip_prefix("---\n") else {
        return false;
    };
    let Some(end) = rest.find("\n---") else {
        return false;
    };
    let mut tags = String::new();
    let mut in_tags = false;
    for line in rest[..end].lines() {
        if let Some(value) = line.strip_prefix("tags:") {
            in_tags = true;
            tags.push_str(value);
        } else if in_tags && line.starts_with([' ', '-']) {
            tags.push(' ');
            tags.push_str(line);
        } else {
            in_tags = false;
        }
    }
    tags.split(|c: char| c.is_whitespace() || ",[]\"'".contains(c))
        .map(|tag| tag.trim_start_matches('#'))
        .any(|tag| tag == "meta/skill")
}

/// Extract `version` from `version.json` (`{ "version": "…" }`).
fn parse_version(src: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(src).ok()?;
    let v = value.get("version")?.as_str()?.trim();
    (!v.is_empty()).then(|| v.to_string())
}
