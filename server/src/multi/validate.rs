//! Whole-config validation for multi-space mode. Pure — filesystem checks
//! (folder accessibility) happen in the manager at apply time.

use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use crate::multi::config::{Binding, MultiConfig};

#[derive(Debug, Clone, Serialize)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

fn err(errors: &mut Vec<FieldError>, field: impl Into<String>, message: impl Into<String>) {
    errors.push(FieldError {
        field: field.into(),
        message: message.into(),
    });
}

/// Normalize a URL prefix: single leading `/`, no trailing `/`; `/` -> "".
/// Mirrors the single-space `SB_URL_PREFIX` normalization.
pub fn normalize_prefix(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let with_lead = if raw.starts_with('/') {
        raw.to_string()
    } else {
        format!("/{raw}")
    };
    with_lead.trim_end_matches('/').to_string()
}

/// Validate the whole config. Empty result = acceptable. Field paths are
/// `<space-id>.<jsonField>`.
pub fn validate(
    config: &MultiConfig,
    root: &Path,
    known_users: &BTreeSet<String>,
) -> Vec<FieldError> {
    let mut errors = Vec::new();
    let mut seen_prefixes: HashMap<String, String> = HashMap::new(); // normalized -> id
    let mut seen_hosts: HashMap<String, String> = HashMap::new();

    for (id, space) in &config.spaces {
        if space.extra.contains_key("auth") {
            err(
                &mut errors,
                format!("{id}.auth"),
                "unknown field (use public/members for access)",
            );
        }
        if space.name.trim().is_empty() {
            err(&mut errors, format!("{id}.name"), "name must not be empty");
        }
        match &space.binding {
            Binding::Prefix { prefix } => {
                let norm = normalize_prefix(prefix);
                if norm.starts_with("/.") {
                    err(
                        &mut errors,
                        format!("{id}.binding"),
                        "prefixes starting with /. are reserved",
                    );
                } else {
                    // Prefixes must be unique AND non-overlapping: a space at
                    // /work and another at /work/sub would fight over URL
                    // space (and their service-worker scopes would overlap).
                    // "" (bare root, from a "/" prefix) is now valid — it only
                    // conflicts with another exact "" (never via the overlap
                    // checks, which would otherwise treat every other prefix
                    // as "starting with" the empty string).
                    let conflict = seen_prefixes.iter().find(|(other_norm, _)| {
                        *other_norm == &norm
                            || (!norm.is_empty()
                                && !other_norm.is_empty()
                                && (norm.starts_with(&format!("{other_norm}/"))
                                    || other_norm.starts_with(&format!("{norm}/"))))
                    });
                    if let Some((other_norm, other_id)) = conflict {
                        let other_name = config
                            .spaces
                            .get(other_id)
                            .map(|s| s.name.clone())
                            .unwrap_or_else(|| other_id.clone());
                        err(
                            &mut errors,
                            format!("{id}.binding"),
                            format!(
                                "prefix {norm:?} overlaps prefix {other_norm:?} of space \"{other_name}\""
                            ),
                        );
                    } else {
                        seen_prefixes.insert(norm, id.clone());
                    }
                }
            }
            Binding::Host { host } => {
                if host.is_empty() || host.contains('/') || host.contains(':') {
                    err(
                        &mut errors,
                        format!("{id}.binding"),
                        "host must be a bare hostname (no port, no slashes)",
                    );
                } else if let Some(other) = seen_hosts.insert(host.to_ascii_lowercase(), id.clone())
                {
                    // Host matching is case-insensitive, so dupe detection is too.
                    err(
                        &mut errors,
                        format!("{id}.binding"),
                        format!("host {host:?} already used by space {other}"),
                    );
                }
            }
        }
        for member in space.members.keys() {
            if !known_users.contains(member) {
                err(
                    &mut errors,
                    format!("{id}.members"),
                    format!("unknown user {member:?}"),
                );
            }
        }
    }

    // Resolved folders must not nest or collide. Resolution mirrors
    // instance::resolve_folder (empty -> spaces/<id>). Collected after the
    // per-space loop and compared pairwise since nesting is order-independent.
    let resolved: Vec<(String, PathBuf)> = config
        .spaces
        .iter()
        .map(|(id, s)| {
            (
                id.clone(),
                crate::multi::instance::resolve_folder(root, id, &s.folder),
            )
        })
        .collect();
    for (i, (id_a, a)) in resolved.iter().enumerate() {
        for (id_b, b) in resolved.iter().skip(i + 1) {
            if a == b || a.starts_with(b) || b.starts_with(a) {
                err(
                    &mut errors,
                    format!("{id_a}.folder"),
                    format!(
                        "folder overlaps with the folder of space {id_b} — space folders may not nest"
                    ),
                );
            }
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, MultiConfig, SpaceConfig};

    fn space(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            public: true,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            runtime_api: false,
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            extra: Default::default(),
        }
    }

    fn cfg(entries: Vec<(&str, SpaceConfig)>) -> MultiConfig {
        MultiConfig {
            spaces: entries
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        }
    }

    fn users(names: &[&str]) -> BTreeSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn prefix_normalization_rules() {
        assert_eq!(normalize_prefix("/"), "");
        assert_eq!(normalize_prefix("wiki"), "/wiki");
        assert_eq!(normalize_prefix("/wiki/"), "/wiki");
    }

    #[test]
    fn valid_config_passes() {
        let dir = tempfile::tempdir().unwrap();
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Prefix {
                        prefix: "/a".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Host {
                        host: "b.example.com".into(),
                    },
                ),
            ),
        ]);
        assert!(validate(&c, dir.path(), &users(&[])).is_empty());
    }

    #[test]
    fn root_prefix_is_allowed_once_and_coexists() {
        let dir = tempfile::tempdir().unwrap();
        let c = cfg(vec![
            ("r", space("Root", Binding::Prefix { prefix: "/".into() })),
            (
                "w",
                space(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
            ),
        ]);
        assert!(validate(&c, dir.path(), &users(&[])).is_empty());
        // But two root bindings conflict.
        let c = cfg(vec![
            ("a", space("A", Binding::Prefix { prefix: "/".into() })),
            ("b", space("B", Binding::Prefix { prefix: "".into() })),
        ]);
        let errs = validate(&c, dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field.ends_with(".binding")),
            "{errs:?}"
        );
    }

    #[test]
    fn overlapping_prefixes_rejected() {
        let dir = tempfile::tempdir().unwrap();
        // Nested prefixes conflict regardless of declaration order.
        for (p1, p2) in [("/work", "/work/sub"), ("/work/sub", "/work")] {
            let c = cfg(vec![
                ("a", space("A", Binding::Prefix { prefix: p1.into() })),
                ("b", space("B", Binding::Prefix { prefix: p2.into() })),
            ]);
            let errs = validate(&c, dir.path(), &users(&[]));
            assert!(
                errs.iter().any(|e| e.field.ends_with(".binding")),
                "{p1} + {p2} must conflict: {errs:?}"
            );
        }
        // A shared string prefix without a path-segment boundary is fine.
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Prefix {
                        prefix: "/workshop".into(),
                    },
                ),
            ),
        ]);
        assert!(validate(&c, dir.path(), &users(&[])).is_empty());
    }

    #[test]
    fn nested_folders_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        a.folder = ".".into(); // the data root itself
        let mut b = space(
            "B",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        b.folder = "spaces/b".into(); // nested inside the data root
        let errs = validate(&cfg(vec![("a", a), ("b", b)]), dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field.ends_with(".folder")),
            "{errs:?}"
        );
        // Sibling folders are fine.
        let mut a = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        a.folder = "spaces/a".into();
        let mut b = space(
            "B",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        b.folder = "spaces/b".into();
        assert!(validate(&cfg(vec![("a", a), ("b", b)]), dir.path(), &users(&[])).is_empty());
    }

    #[test]
    fn duplicate_folders_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        a.folder = "spaces/notes".into();
        let mut b = space(
            "B",
            Binding::Prefix {
                prefix: "/b".into(),
            },
        );
        b.folder = "spaces/notes/".into(); // same after trailing-slash trim
        let errs = validate(&cfg(vec![("a", a), ("b", b)]), dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field.ends_with(".folder")),
            "{errs:?}"
        );
        // Two empty folders are fine (each defaults to its own GUID dir).
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Prefix {
                        prefix: "/a".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Prefix {
                        prefix: "/b".into(),
                    },
                ),
            ),
        ]);
        assert!(validate(&c, dir.path(), &users(&[])).is_empty());
    }

    #[test]
    fn duplicate_bindings_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Prefix {
                        prefix: "/x".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Prefix {
                        prefix: "/x/".into(),
                    },
                ),
            ), // same after normalization
        ]);
        let errs = validate(&c, dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field.ends_with(".binding")),
            "{errs:?}"
        );
    }

    #[test]
    fn duplicate_hosts_rejected_case_insensitively() {
        let dir = tempfile::tempdir().unwrap();
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Host {
                        host: "Notes.Example.com".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Host {
                        host: "notes.example.COM".into(),
                    },
                ),
            ),
        ]);
        let errs = validate(&c, dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field.ends_with(".binding")),
            "{errs:?}"
        );
    }

    #[test]
    fn reserved_bindings_and_invalid_hosts_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Prefix {
                        prefix: "/.spaces".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Host {
                        host: "with/slash".into(),
                    },
                ),
            ),
        ]);
        let errs = validate(&c, dir.path(), &users(&[]));
        assert_eq!(errs.len(), 2, "{errs:?}");
    }

    #[test]
    fn unknown_member_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        s.members.insert("ghost".into(), Default::default());
        let errs = validate(&cfg(vec![("a", s.clone())]), dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field.ends_with(".members")),
            "{errs:?}"
        );
        assert!(validate(&cfg(vec![("a", s)]), dir.path(), &users(&["ghost"])).is_empty());
    }

    #[test]
    fn empty_name_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let s = space(
            "",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        let errs = validate(&cfg(vec![("a", s)]), dir.path(), &users(&[]));
        assert!(errs.iter().any(|e| e.field == "a.name"), "{errs:?}");
    }
}
