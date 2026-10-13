//! Raw ripgrep passthrough. Arguments are validated once into `RawArgs`, every
//! path operand is normalized to a `RelPath`, and both rg runs (the exclusion
//! pre-pass and the search) receive that same spelling, so rg's printed paths,
//! the storage listing and the exclusion globs always agree.

use std::collections::{BTreeSet, HashSet};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use super::args::{self, RelPath};
use super::RipgrepBackend;
use crate::{RawRequest, RawResult, RequestCx, SearchError};

const STDIN_CAP: usize = 1024 * 1024;
const MAX_HIDDEN_GLOBS: usize = 1000;
const TOO_MANY_HIDDEN: &str = "Too many hidden files; narrow the search with paths";
const NOT_UTF8: &str = "Search paths contain a file name that is not valid UTF-8";

enum Exclusions {
    Globs(Vec<String>),
    TimedOut,
}

fn decode_stdin(data: Option<String>) -> Result<Option<Vec<u8>>, SearchError> {
    let Some(data) = data else {
        return Ok(None);
    };
    let bytes = STANDARD
        .decode(data)
        .map_err(|_| SearchError::Invalid("stdinBase64 is not valid base64".into()))?;
    if bytes.len() > STDIN_CAP {
        return Err(SearchError::Invalid("Search stdin exceeds 1 MiB".into()));
    }
    Ok(Some(bytes))
}

/// Normalizes `operand` and refuses it when it resolves outside the space or
/// names a file storage does not list. `root` must be canonical.
fn space_relative(
    root: &Path,
    operand: &str,
    visible: &HashSet<String>,
) -> Result<RelPath, SearchError> {
    let rel = RelPath::parse(operand).map_err(SearchError::Invalid)?;
    // Resolve the normalized form: it is what rg receives (`users.json/` would
    // fail to resolve, yet rg is handed `users.json`).
    let Ok(resolved) = root.join(rel.as_str()).canonicalize() else {
        // A path that cannot be resolved is left for rg to report as not found.
        return Ok(rel);
    };
    let Ok(relative) = resolved.strip_prefix(root) else {
        return Err(SearchError::Invalid(
            "Search paths must stay inside the space".into(),
        ));
    };
    let relative: Vec<String> = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if resolved.is_file() && !visible.contains(&relative.join("/")) {
        return Err(SearchError::Invalid(
            "Search paths must be visible in the space".into(),
        ));
    }
    Ok(rel)
}

/// Normalizes every search path and checks every input file, resolving the
/// space root once per request.
fn resolve_operands(
    root: &Path,
    search_paths: &[String],
    input_files: &[String],
    visible: &HashSet<String>,
) -> Result<Vec<RelPath>, SearchError> {
    if search_paths.is_empty() && input_files.is_empty() {
        return Ok(Vec::new());
    }
    let root = root
        .canonicalize()
        .map_err(|e| SearchError::Failed(e.to_string()))?;
    let paths = search_paths
        .iter()
        .map(|p| space_relative(&root, p, visible))
        .collect::<Result<Vec<_>, _>>()?;
    for file in input_files {
        space_relative(&root, file, visible)?;
    }
    Ok(paths)
}

/// rg prints walked paths under the operand it was given; for `.` that adds a
/// leading `./`, as does the dash guard in `RelPath::operand`.
fn listing_form(printed: &str) -> &str {
    printed.strip_prefix("./").unwrap_or(printed)
}

impl RipgrepBackend {
    pub(super) async fn run_raw(
        &self,
        req: RawRequest,
        cx: RequestCx,
    ) -> Result<RawResult, SearchError> {
        self.check_available()?;
        let stdin = decode_stdin(req.stdin_base64)?;
        let parsed = args::parse(&req.args).map_err(SearchError::Invalid)?;
        let root = self.root.clone();
        let view = self.view.clone();
        let search_paths: Vec<String> = parsed
            .search_paths()
            .into_iter()
            .map(String::from)
            .collect();
        let input_files = parsed.input_files.clone();
        let (paths, visible) = tokio::task::spawn_blocking(move || {
            let visible = view.list();
            let paths = resolve_operands(&root, &search_paths, &input_files, &visible)?;
            Ok::<_, SearchError>((paths, visible))
        })
        .await
        .map_err(|e| SearchError::Failed(e.to_string()))??;
        let _slot = cx.process_slot().await?;
        let globs = match self.exclusions(&paths, &visible, &cx).await? {
            Exclusions::Globs(globs) => globs,
            Exclusions::TimedOut => {
                return Ok(RawResult {
                    exit_code: 2,
                    stdout_base64: String::new(),
                    stderr_base64: STANDARD.encode("Search took too long listing files\n"),
                    truncated: false,
                    timed_out: true,
                })
            }
        };
        let argv = parsed.render(&paths, &globs).map_err(SearchError::Failed)?;
        let out = self.rg(&argv, stdin, &cx).await?;
        Ok(RawResult {
            exit_code: out.code.unwrap_or(2),
            stdout_base64: STANDARD.encode(out.stdout),
            stderr_base64: STANDARD.encode(out.stderr),
            truncated: out.truncated,
            timed_out: out.timed_out,
        })
    }

    /// Explicit file operands bypass rg's globs, so storage-hidden files under
    /// the searched paths are excluded one by one.
    async fn exclusions(
        &self,
        paths: &[RelPath],
        visible: &HashSet<String>,
        cx: &RequestCx,
    ) -> Result<Exclusions, SearchError> {
        // A superset of what the user's search can walk: no ignore files, no user filters.
        let mut args: Vec<String> = ["--files", "--null", "--no-ignore", args::HIDDEN_GUARD, "--"]
            .map(String::from)
            .into();
        if paths.is_empty() {
            args.push(".".into());
        } else {
            args.extend(paths.iter().map(RelPath::operand));
        }
        let out = self.rg(&args, None, cx).await?;
        if out.timed_out {
            return Ok(Exclusions::TimedOut);
        }
        if out.truncated || out.code.is_none() {
            return Err(SearchError::Invalid(TOO_MANY_HIDDEN.into()));
        }
        let mut hidden = BTreeSet::new();
        for printed in out.stdout.split(|b| *b == 0).filter(|p| !p.is_empty()) {
            // Storage lists only UTF-8 names, so such a file is hidden, and a
            // lossy glob would not exclude it.
            let printed =
                std::str::from_utf8(printed).map_err(|_| SearchError::Invalid(NOT_UTF8.into()))?;
            let path = listing_form(printed);
            if !visible.contains(path) {
                hidden.insert(path);
            }
        }
        if hidden.len() > MAX_HIDDEN_GLOBS {
            return Err(SearchError::Invalid(TOO_MANY_HIDDEN.into()));
        }
        Ok(Exclusions::Globs(
            hidden.into_iter().map(args::exclude_glob).collect(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::{backend, cx, space};
    use super::*;
    use crate::SearchBackend;

    fn raw_req(args: &[&str]) -> RawRequest {
        RawRequest {
            args: args.iter().map(|s| s.to_string()).collect(),
            stdin_base64: None,
        }
    }

    async fn raw_stdout(b: &RipgrepBackend, args: &[&str]) -> String {
        let r = b.raw(raw_req(args), cx()).await.unwrap();
        String::from_utf8(STANDARD.decode(r.stdout_base64).unwrap()).unwrap()
    }

    const CONTROL_FILES: &[(&str, &str)] = &[
        ("Notes.md", "PRIVATE visible note\n"),
        ("users.json", "PRIVATE hash\n"),
        ("git-keys/id", "PRIVATE key\n"),
        ("sub/deep/Plan.md", "PRIVATE plan\n"),
        ("sub/deep/token", "PRIVATE token\n"),
    ];
    const CONTROL_HIDDEN: &[&str] = &["users.json", "git-keys/id", "sub/deep/token"];

    #[cfg(unix)]
    #[tokio::test]
    async fn raw_refuses_symlinked_paths_that_leave_the_space() {
        let dir = space(&[("In.md", "fern\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("Out.md"), "fern\n").unwrap();
        std::os::unix::fs::symlink(outside.path().join("Out.md"), dir.path().join("Link.md"))
            .unwrap();
        let err = b
            .raw(raw_req(&["fern", "Link.md"]), cx())
            .await
            .unwrap_err();
        assert!(matches!(err, SearchError::Invalid(_)), "got {err:?}");
        assert!(b.raw(raw_req(&["fern", "In.md"]), cx()).await.is_ok());
    }

    #[tokio::test]
    async fn raw_glob_override_does_not_reveal_dot_files() {
        let dir = space(&[("Open.md", "needle\n"), (".secret/Key.md", "needle\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let stdout = raw_stdout(&b, &["-g", "*", "--files-with-matches", "needle"]).await;
        assert!(stdout.contains("Open.md"), "got {stdout:?}");
        assert!(!stdout.contains(".secret"), "got {stdout:?}");
    }

    #[tokio::test]
    async fn raw_iglob_and_type_overrides_do_not_reveal_dot_files() {
        let dir = space(&[("Open.md", "needle\n"), (".secret/Key.md", "needle\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        let err = b
            .raw(raw_req(&["--iglob", "*", "-l", "needle"]), cx())
            .await
            .unwrap_err();
        assert!(matches!(err, SearchError::Invalid(_)), "got {err:?}");
        let stdout = raw_stdout(&b, &["--type-add", "xx:*.md", "-t", "xx", "-l", "needle"]).await;
        assert!(!stdout.contains(".secret"), "got {stdout:?}");
    }

    #[tokio::test]
    async fn raw_refuses_explicit_hidden_files() {
        let dir = space(CONTROL_FILES);
        let Some(b) = backend(dir.path(), CONTROL_HIDDEN) else {
            return;
        };
        for args in [
            &["-e", "", "users.json"][..],
            &["-e", "", "./users.json"],
            &["-e", "", "users.json/"],
            &["-e", "", ".//users.json/."],
            &["-e", "", "--", "git-keys/id"],
            &["-e", "", "--", "git-keys//id"],
            &["-e", "", "sub/./deep/token"],
            &["-f", "users.json", "."],
            &["--ignore-file", "users.json", "-e", "x", "."],
        ] {
            let err = b.raw(raw_req(args), cx()).await.unwrap_err();
            assert_eq!(
                err,
                SearchError::Invalid("Search paths must be visible in the space".into()),
                "{args:?}"
            );
        }
        assert!(raw_stdout(&b, &["-e", "", "Notes.md"])
            .await
            .contains("visible note"));
    }

    #[tokio::test]
    async fn raw_walks_skip_hidden_files_even_when_whitelisted() {
        let dir = space(CONTROL_FILES);
        let Some(b) = backend(dir.path(), CONTROL_HIDDEN) else {
            return;
        };
        for args in [
            &["-e", "PRIVATE", "."][..],
            &["-e", "PRIVATE"],
            &["-g", "users.json", "-g", "*.md", "-e", "", "."],
            &["-g", "*", "--files"],
            &["-e", "PRIVATE", "git-keys"],
            &["-e", "PRIVATE", "--", "./git-keys/"],
            &["-e", "PRIVATE", ".//"],
            &["-e", "PRIVATE", "git-keys//"],
            &["-e", "PRIVATE", "git-keys/./"],
            &["-e", "PRIVATE", "sub/./deep"],
            &["-e", "PRIVATE", "sub//deep"],
            &["-e", "PRIVATE", "sub/deep/"],
            &["-g", "*", "--files", "--", ".//", "sub//deep"],
        ] {
            let out = raw_stdout(&b, args).await;
            assert!(!out.contains("users.json"), "{args:?}: {out}");
            assert!(!out.contains("git-keys"), "{args:?}: {out}");
            assert!(
                !out.contains("hash") && !out.contains("key") && !out.contains("token"),
                "{args:?}: {out}"
            );
        }
        assert!(raw_stdout(&b, &["-e", "PRIVATE", "."])
            .await
            .contains("Notes.md"));
        assert!(raw_stdout(&b, &["--files"]).await.contains("Notes.md"));
        assert_eq!(
            raw_stdout(&b, &["-e", "PRIVATE", "sub//deep"]).await,
            "sub/deep/Plan.md:PRIVATE plan\n"
        );
    }

    /// rg parses globs like gitignore lines, which drop trailing whitespace.
    #[cfg(unix)]
    #[tokio::test]
    async fn raw_exclusions_keep_trailing_whitespace() {
        let files = [
            ("sub/secret.md ", "PRIVATE\n"),
            ("sub/tab.md\t", "PRIVATE\n"),
            ("sub/nbsp.md\u{a0}", "PRIVATE\n"),
            ("sub/wide.md\u{3000}", "PRIVATE\n"),
            ("sub/vt.md\u{b}", "PRIVATE\n"),
            ("sub/a b.md", "PRIVATE\n"),
            ("sub/ok.md", "fine\n"),
        ];
        let hidden = [
            "sub/secret.md ",
            "sub/tab.md\t",
            "sub/nbsp.md\u{a0}",
            "sub/wide.md\u{3000}",
            "sub/vt.md\u{b}",
            "sub/a b.md",
        ];
        let dir = space(&files);
        let Some(b) = backend(dir.path(), &hidden) else {
            return;
        };
        assert_eq!(raw_stdout(&b, &["--files", "sub"]).await, "sub/ok.md\n");
        assert_eq!(raw_stdout(&b, &["--files"]).await, "sub/ok.md\n");
        assert_eq!(raw_stdout(&b, &["-l", "PRIVATE", "sub"]).await, "");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn raw_refuses_hidden_file_names_that_are_not_utf8() {
        use std::os::unix::ffi::OsStrExt;
        let dir = space(&[("sub/ok.md", "fine\n")]);
        let name = std::ffi::OsStr::from_bytes(b"sub/bad\xff.md");
        std::fs::write(dir.path().join(name), "PRIVATE\n").unwrap();
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        assert_eq!(
            b.raw(raw_req(&["-e", "PRIVATE", "sub"]), cx())
                .await
                .unwrap_err(),
            SearchError::Invalid("Search paths contain a file name that is not valid UTF-8".into())
        );
    }

    #[tokio::test]
    async fn raw_dash_leading_paths_stay_paths_after_normalizing() {
        let dir = space(&[("--pre=sh", "fern here\n"), ("Other.md", "fern\n")]);
        let Some(b) = backend(dir.path(), &[]) else {
            return;
        };
        assert_eq!(
            raw_stdout(&b, &["-H", "-e", "fern", ".//--pre=sh"]).await,
            "./--pre=sh:fern here\n"
        );
    }

    #[tokio::test]
    async fn raw_hides_files_under_dash_leading_directories() {
        let dir = space(&[
            ("-dir/secret.md", "PRIVATE secret\n"),
            ("-dir/ok.md", "PRIVATE ok\n"),
        ]);
        let Some(b) = backend(dir.path(), &["-dir/secret.md"]) else {
            return;
        };
        for args in [
            &["-e", "PRIVATE", "./-dir"][..],
            &["-e", "PRIVATE", "--", "-dir"],
            &["-e", "PRIVATE"],
            &["--files", "./-dir"],
            &["--files", "--", "-dir"],
        ] {
            let out = raw_stdout(&b, args).await;
            assert!(!out.contains("secret"), "{args:?}: {out}");
            assert!(out.contains("ok.md"), "{args:?}: {out}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn raw_exclusions_escape_glob_metacharacters() {
        let files = [
            ("a[1].md", "PRIVATE\n"),
            ("x*y.md", "PRIVATE\n"),
            ("b{c,d}.md", "PRIVATE\n"),
            ("z]w?.md", "PRIVATE\n"),
            ("e!f\\g.md", "PRIVATE\n"),
            ("a1.md", "PRIVATE\n"),
            ("xzy.md", "PRIVATE\n"),
            ("bc.md", "PRIVATE\n"),
        ];
        let hidden = ["a[1].md", "x*y.md", "b{c,d}.md", "z]w?.md", "e!f\\g.md"];
        let dir = space(&files);
        let Some(b) = backend(dir.path(), &hidden) else {
            return;
        };
        let out = raw_stdout(&b, &["--files"]).await;
        let mut listed: Vec<&str> = out.lines().collect();
        listed.sort();
        assert_eq!(listed, ["a1.md", "bc.md", "xzy.md"], "{out}");
    }

    #[tokio::test]
    async fn raw_refuses_when_too_many_files_are_hidden() {
        let names: Vec<String> = (0..1001).map(|i| format!("h/{i}.md")).collect();
        let mut files: Vec<(&str, &str)> = names.iter().map(|n| (n.as_str(), "x\n")).collect();
        files.push(("Open.md", "x\n"));
        let hidden: Vec<&str> = names.iter().map(String::as_str).collect();
        let dir = space(&files);
        let Some(b) = backend(dir.path(), &hidden) else {
            return;
        };
        assert!(matches!(
            b.raw(raw_req(&["-e", "x", "."]), cx()).await,
            Err(SearchError::Invalid(m)) if m.contains("narrow")
        ));
        assert!(raw_stdout(&b, &["-e", "x", "Open.md"]).await.contains('x'));
    }
}
