/// Paths named in arguments must stay inside the space root and must not
/// name hidden entries (dot files and directories such as `.git`).
pub fn confined(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.contains('\0')
        && !value
            .split('/')
            .any(|p| p == ".." || (p.starts_with('.') && p != "."))
}

const FLAGS: &[&str] = &[
    "json",
    "line-number",
    "no-line-number",
    "column",
    "with-filename",
    "no-filename",
    "heading",
    "no-heading",
    "count",
    "count-matches",
    "files-with-matches",
    "files-without-match",
    "files",
    "null",
    "null-data",
    "ignore-case",
    "case-sensitive",
    "smart-case",
    "fixed-strings",
    "word-regexp",
    "line-regexp",
    "invert-match",
    "only-matching",
    "quiet",
    "text",
    "no-ignore",
    "no-ignore-vcs",
    "no-ignore-parent",
    "no-ignore-global",
    "no-ignore-dot",
    "no-messages",
    "multiline",
    "multiline-dotall",
    "crlf",
    "no-unicode",
    "help",
    "version",
    "no-config",
    "stats",
    "trim",
    "passthru",
    "byte-offset",
    "max-columns-preview",
];

const VALUES: &[&str] = &[
    "file",
    "ignore-file",
    "regexp",
    "glob",
    "type",
    "type-not",
    "type-add",
    "type-clear",
    "max-count",
    "max-depth",
    "before-context",
    "after-context",
    "context",
    "context-separator",
    "field-match-separator",
    "field-context-separator",
    "replace",
    "color",
    "colors",
    "sort",
    "sortr",
    "encoding",
];

/// Short flags without a value. Excludes `P` (PCRE2), `z` (decompression
/// helpers), `L` (follow symlinks), `u` (hidden/binary), `j` (threads).
const SHORT_FLAGS: &str = "nNHhcl0iIsSFwxvoqab";
/// Excludes `M` (max columns), which the executor sets itself.
const SHORT_VALUES: &str = "efgtTmABCrd";
const REFUSED_SHORT: &str = "PzLuj";

/// Keeps hidden entries out of results. Inserted after the user's options so
/// it takes precedence over any user glob such as `-g '*'`.
pub(crate) const HIDDEN_GUARD: &str = "--glob=!.*";

/// A space-relative path in listing form: no empty, `.` or `..` segments; `"."` is the root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelPath(String);

impl RelPath {
    /// Lexical normalization of a `confined` operand: drops empty and `.` segments; refuses `..`.
    pub fn parse(operand: &str) -> Result<RelPath, String> {
        if !confined(operand) {
            return Err("Search paths must stay inside the space".into());
        }
        let segments: Vec<&str> = operand
            .split('/')
            .filter(|s| !s.is_empty() && *s != ".")
            .collect();
        if segments.is_empty() {
            Ok(RelPath(".".into()))
        } else {
            Ok(RelPath(segments.join("/")))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The spelling rg receives. Normalizing `./-x` to `-x` would turn a path
    /// into an option (or `-` into stdin), so a leading dash keeps its `./`;
    /// rg strips a single leading `./` before matching globs and listing.
    pub(crate) fn operand(&self) -> String {
        if self.0.starts_with('-') {
            format!("./{}", self.0)
        } else {
            self.0.clone()
        }
    }
}

/// Validated raw ripgrep arguments, re-emitted by `render` with every search
/// path in the spelling the exclusion pre-pass used.
#[derive(Debug)]
pub struct RawArgs {
    args: Vec<String>,
    terminator: Option<usize>,
    /// Indices into `args` of whole-argument positional search paths (not `-`).
    search_paths: Vec<usize>,
    /// `-f`/`--file`/`--ignore-file` values (not `-`); rg reads these directly, they are never walked.
    pub input_files: Vec<String>,
}

impl RawArgs {
    pub fn search_paths(&self) -> Vec<&str> {
        self.search_paths
            .iter()
            .map(|&i| self.args[i].as_str())
            .collect()
    }

    /// The argv rg receives: user args with each search path replaced by its `RelPath`,
    /// `HIDDEN_GUARD` then `exclusions` inserted before the options-terminating
    /// `--`, or at the end when there is none. Refuses unless `paths` has one
    /// entry per `search_paths`, so a path can never be left unnormalized.
    pub fn render(&self, paths: &[RelPath], exclusions: &[String]) -> Result<Vec<String>, String> {
        if paths.len() != self.search_paths.len() {
            return Err("Search paths do not match the arguments".into());
        }
        let at = self.terminator.unwrap_or(self.args.len());
        let mut out = Vec::with_capacity(self.args.len() + 1 + exclusions.len());
        for (i, arg) in self.args.iter().enumerate() {
            if i == at {
                out.push(HIDDEN_GUARD.to_string());
                out.extend_from_slice(exclusions);
            }
            match self.search_paths.iter().position(|&p| p == i) {
                Some(k) => out.push(paths[k].operand()),
                None => out.push(arg.clone()),
            }
        }
        if at == self.args.len() {
            out.push(HIDDEN_GUARD.to_string());
            out.extend_from_slice(exclusions);
        }
        Ok(out)
    }
}

/// An anchored exclusion glob for one file, relative to the space root (rg
/// matches `--glob` against paths relative to its working directory).
pub fn exclude_glob(path: &str) -> String {
    let mut glob = String::from("--glob=!/");
    for c in path.chars() {
        // A class holds one literal character; `!` is only special at the
        // start of a glob or class, so it stays as is. Globs are parsed like
        // gitignore lines, which trim trailing (Unicode) whitespace, so
        // whitespace is wrapped too. Classes match single bytes, so non-ASCII
        // whitespace goes in a one-branch alternation instead.
        if "*?[]{}\\".contains(c) || (c.is_ascii() && c.is_whitespace()) {
            glob.push('[');
            glob.push(c);
            glob.push(']');
        } else if c.is_whitespace() {
            glob.push('{');
            glob.push(c);
            glob.push('}');
        } else {
            glob.push(c);
        }
    }
    glob
}

/// Validates raw ripgrep arguments in one pass. Path containment against the
/// canonical root and storage visibility are checked by the caller.
pub fn parse(args: &[String]) -> Result<RawArgs, String> {
    if args.len() > 256 || args.iter().map(String::len).sum::<usize>() > 65536 {
        return Err("Too many arguments".into());
    }
    // Conservative: `-e`/`-f` anywhere (even as another option's value) makes
    // every positional a path, so more operands are checked, never fewer.
    let mut pattern = args.iter().any(|a| {
        a == "--files"
            || a == "-e"
            || a == "-f"
            || a == "--file"
            || a == "--regexp"
            || a.starts_with("--file=")
            || a.starts_with("--regexp=")
    });
    let mut terminator = None;
    let mut input_files: Vec<String> = Vec::new();
    let mut positionals: Vec<usize> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if terminator.is_none() && arg == "--" {
            terminator = Some(i);
        } else if terminator.is_none() && arg.starts_with("--") {
            let (name, inline) = arg[2..]
                .split_once('=')
                .map_or((&arg[2..], None), |(n, v)| (n, Some(v)));
            if VALUES.contains(&name) {
                let value = match inline {
                    Some(v) => v,
                    None => {
                        i += 1;
                        args.get(i).ok_or("Missing option value")?
                    }
                };
                if ["file", "ignore-file"].contains(&name) {
                    if !confined(value) {
                        return Err("Option file paths must stay inside the space".into());
                    }
                    if value != "-" {
                        input_files.push(value.to_string());
                    }
                }
                if value.contains('\0') {
                    return Err("Invalid option value".into());
                }
            } else if !(FLAGS.contains(&name) && inline.is_none()) {
                return Err(format!("Unsupported remote ripgrep option: --{name}"));
            }
        } else if terminator.is_none() && arg.starts_with('-') && arg != "-" {
            for (offset, c) in arg[1..].char_indices() {
                if REFUSED_SHORT.contains(c) {
                    return Err(format!("Unsupported remote ripgrep option: -{c}"));
                }
                if SHORT_FLAGS.contains(c) {
                    continue;
                }
                if SHORT_VALUES.contains(c) {
                    // Clustered forms (`-ie x`, `-epat`) escape the pre-scan above.
                    if c == 'e' || c == 'f' {
                        pattern = true;
                    }
                    let value = if offset + c.len_utf8() == arg[1..].len() {
                        i += 1;
                        args.get(i).ok_or("Missing option value")?.as_str()
                    } else {
                        &arg[1 + offset + c.len_utf8()..]
                    };
                    if c == 'f' {
                        if !confined(value) {
                            return Err("Pattern files must stay inside the space".into());
                        }
                        if value != "-" {
                            input_files.push(value.to_string());
                        }
                    }
                    break;
                }
                return Err(format!("Unsupported remote ripgrep option: -{c}"));
            }
        } else {
            positionals.push(i);
        }
        i += 1;
    }
    // Whether a positional is the pattern depends on -e/-f anywhere in the
    // list, so classify them only once the whole list has been read.
    let candidates = if pattern {
        &positionals[..]
    } else {
        positionals.get(1..).unwrap_or(&[])
    };
    let mut search_paths = Vec::new();
    for &p in candidates {
        if args[p] != "-" {
            if !confined(&args[p]) {
                return Err("Search paths must stay inside the space".into());
            }
            search_paths.push(p);
        }
    }
    Ok(RawArgs {
        args: args.to_vec(),
        terminator,
        search_paths,
        input_files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    fn v(args: &[&str]) -> Result<(), String> {
        parse(&s(args)).map(|_| ())
    }

    /// Renders with every search path normalized, as the raw handler does.
    fn rendered(args: &[&str], exclusions: &[&str]) -> Vec<String> {
        let raw = parse(&s(args)).unwrap();
        let paths: Vec<RelPath> = raw
            .search_paths()
            .iter()
            .map(|p| RelPath::parse(p).unwrap())
            .collect();
        raw.render(&paths, &s(exclusions)).unwrap()
    }

    #[test]
    fn render_refuses_a_path_count_mismatch() {
        let raw = parse(&s(&["-e", "x", "a", "b"])).unwrap();
        let one = [RelPath::parse("a").unwrap()];
        assert_eq!(
            raw.render(&one, &[]),
            Err("Search paths do not match the arguments".to_string())
        );
    }

    #[test]
    fn rel_paths_are_normalized_to_listing_form() {
        for (operand, listed) in [
            (".//", "."),
            ("git-keys//", "git-keys"),
            ("git-keys/./", "git-keys"),
            ("sub/./deep", "sub/deep"),
            ("sub//deep", "sub/deep"),
            ("sub/deep/", "sub/deep"),
            ("./a.md", "a.md"),
            (".", "."),
        ] {
            assert_eq!(
                RelPath::parse(operand).unwrap().as_str(),
                listed,
                "{operand:?}"
            );
        }
        for operand in ["a/../b", "..", "/etc", "a/.git/x", ""] {
            assert!(RelPath::parse(operand).is_err(), "accepted {operand:?}");
        }
    }

    #[test]
    fn render_rewrites_search_paths_and_inserts_guards() {
        assert_eq!(
            rendered(&["-n", "garden", ".//x"], &[]),
            s(&["-n", "garden", "x", "--glob=!.*"])
        );
        assert_eq!(
            rendered(&["-e", "garden", "--", "sub//deep"], &[]),
            s(&["-e", "garden", "--glob=!.*", "--", "sub/deep"])
        );
        assert_eq!(
            rendered(&["-e", "x", "--", "./git-keys/"], &["--glob=!/a"]),
            s(&["-e", "x", "--glob=!.*", "--glob=!/a", "--", "git-keys"])
        );
    }

    #[test]
    fn render_keeps_dash_leading_paths_positional() {
        assert_eq!(
            rendered(&["fern", "./--pre=sh"], &[]),
            s(&["fern", "./--pre=sh", "--glob=!.*"])
        );
        assert_eq!(
            rendered(&["-e", "fern", ".//-"], &[]),
            s(&["-e", "fern", "./-", "--glob=!.*"])
        );
    }

    #[test]
    fn input_files_are_not_search_paths() {
        let raw = parse(&s(&["-f", "pats.txt", "notes"])).unwrap();
        assert_eq!(raw.input_files, s(&["pats.txt"]));
        assert_eq!(raw.search_paths(), ["notes"]);
        let raw = parse(&s(&["--ignore-file", "ign", "-e", "x", "."])).unwrap();
        assert_eq!(raw.input_files, s(&["ign"]));
        assert_eq!(raw.search_paths(), ["."]);
    }

    #[test]
    fn rejects_execution_external_paths_and_limit_overrides() {
        for args in [
            &["--pre", "sh", "x"][..],
            &["--hostname-bin=sh", "x"],
            &["-f", "/etc/passwd"],
            &["-f/etc/passwd", "x"],
            &["x", "../secret"],
            &["-e", "x", "/etc"],
            &["--ignore-file", "/etc/passwd"],
            &["-P", "x"],
            &["--pcre2", "x"],
            &["--engine", "pcre2", "x"],
            &["--engine=auto", "x"],
            &["-z", "x"],
            &["-L", "x"],
            &["--follow", "x"],
            &["--hidden", "x"],
            &["-u", "x"],
            &["-uuu", "x"],
            &["-j8", "x"],
            &["--threads", "4", "x"],
            &["--max-filesize", "1G", "x"],
            &["--max-columns", "0", "x"],
            &["-M", "0", "x"],
            &["-M0", "x"],
            &["x", "C:/Windows"],
            &["x", "notes\\a.md"],
            &["../secret", "-ie", "x"],
            &["x", ".hid"],
            &["x", "a/.git/x"],
            &["-e", "x", "--", ".top.md"],
            &["-e", "x", "--", "a/.git/x"],
            &["-f", ".hid/pats", "x"],
            &["--iglob", "*", "x"],
            &["--iglob=*", "x"],
        ] {
            assert!(v(args).is_err(), "accepted {args:?}");
        }
    }

    #[test]
    fn accepts_ordinary_searches() {
        assert!(v(&["-ni", "--glob=*.md", "hello", "."]).is_ok());
        assert!(v(&["-e", "x", "--", "Notes/a.md"]).is_ok());
        assert!(v(&["-e", "x", "--", "./Notes/a.md"]).is_ok());
        assert!(v(&["-nS", "-Tjson", "hello", "."]).is_ok());
        assert!(v(&["--json", "-C", "2", "--", "-starts-with-dash"]).is_ok());
        assert!(v(&["--files"]).is_ok());
    }

    #[test]
    fn returns_path_operands() {
        let raw = parse(&s(&["-e", "x", "--", "Notes/a.md"])).unwrap();
        assert_eq!(raw.search_paths(), ["Notes/a.md"]);
        assert!(raw.input_files.is_empty());
        let raw = parse(&s(&["-f", "pats.txt", "."])).unwrap();
        assert_eq!(raw.input_files, s(&["pats.txt"]));
        assert_eq!(raw.search_paths(), ["."]);
        let raw = parse(&s(&["-e", "x", "-"])).unwrap();
        assert!(raw.search_paths().is_empty() && raw.input_files.is_empty());
        let raw = parse(&s(&["-f", "-", "x"])).unwrap();
        assert_eq!(raw.search_paths(), ["x"]);
        assert!(raw.input_files.is_empty());
        // A clustered `-e` makes the first positional a path too.
        let raw = parse(&s(&["-ie", "x", "users.json"])).unwrap();
        assert_eq!(raw.search_paths(), ["users.json"]);
        let raw = parse(&s(&["-epat", "users.json"])).unwrap();
        assert_eq!(raw.search_paths(), ["users.json"]);
    }

    #[test]
    fn rejects_oversized_argument_lists() {
        let many: Vec<String> = (0..300).map(|i| format!("p{i}")).collect();
        assert!(parse(&many).is_err());
        assert!(parse(&["x".repeat(70_000)]).is_err());
    }

    #[test]
    fn guard_goes_before_terminator() {
        // Without -e the positional is the pattern, so it is not rewritten.
        assert_eq!(
            rendered(&["--json", "-C", "2", "--", "-starts-with-dash"], &[]),
            s(&["--json", "-C", "2", "--glob=!.*", "--", "-starts-with-dash"])
        );
        assert_eq!(
            rendered(&["-e", "x", "--", "-x"], &["--glob=!/a"]),
            s(&["-e", "x", "--glob=!.*", "--glob=!/a", "--", "./-x"])
        );
    }

    #[test]
    fn guard_goes_at_end_without_terminator() {
        assert_eq!(
            rendered(&["-ni", "hello", "."], &[]),
            s(&["-ni", "hello", ".", "--glob=!.*"])
        );
        // The `--` here is the value of -e, not an options terminator.
        assert_eq!(
            rendered(&["-e", "--", "-x"], &[]),
            s(&["-e", "--", "-x", "--glob=!.*"])
        );
    }

    #[test]
    fn exclusion_globs_are_anchored_and_escaped() {
        assert_eq!(exclude_glob("Notes/a.md"), "--glob=!/Notes/a.md");
        assert_eq!(
            exclude_glob("a[1]*?{x}!\\.md"),
            "--glob=!/a[[]1[]][*][?][{]x[}]![\\].md"
        );
        assert_eq!(exclude_glob("a b.md "), "--glob=!/a[ ]b.md[ ]");
        assert_eq!(exclude_glob("a.md\t"), "--glob=!/a.md[\t]");
        assert_eq!(exclude_glob("a.md\u{a0}"), "--glob=!/a.md{\u{a0}}");
        assert_eq!(exclude_glob("a\u{3000}b"), "--glob=!/a{\u{3000}}b");
    }

    #[test]
    fn guarded_rg_skips_hidden_entries() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".hid")).unwrap();
        std::fs::write(dir.path().join(".hid/a.md"), "secret\n").unwrap();
        std::fs::write(dir.path().join(".top.md"), "secret\n").unwrap();
        std::fs::write(dir.path().join("vis.md"), "secret\n").unwrap();
        let args = rendered(&["-g", "*", "secret", "."], &[]);
        let out = match std::process::Command::new("rg")
            .args(&args)
            .current_dir(dir.path())
            .output()
        {
            Ok(out) => out,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                eprintln!("skipping guarded_rg_skips_hidden_entries: rg not on PATH");
                return;
            }
            Err(e) => panic!("failed to run rg: {e}"),
        };
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(stdout.contains("vis.md"), "{stdout}");
        assert!(!stdout.contains(".hid"), "{stdout}");
        assert!(!stdout.contains(".top.md"), "{stdout}");
    }
}
