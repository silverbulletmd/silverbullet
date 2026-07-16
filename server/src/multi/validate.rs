//! Whole-config validation for multi-space mode. Pure — filesystem checks
//! (folder accessibility) happen in the manager at apply time.

use serde::Serialize;
use std::collections::HashMap;

use crate::multi::config::{Binding, MultiConfig, SpaceAuth};

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
pub fn validate(config: &MultiConfig) -> Vec<FieldError> {
    let mut errors = Vec::new();
    let mut seen_prefixes: HashMap<String, String> = HashMap::new(); // normalized -> id
    let mut seen_hosts: HashMap<String, String> = HashMap::new();
    let mut seen_folders: HashMap<String, String> = HashMap::new(); // folder -> id

    for (id, space) in &config.spaces {
        if space.name.trim().is_empty() {
            err(&mut errors, format!("{id}.name"), "name must not be empty");
        }
        // Two spaces sharing a folder would silently mix their files; catch the
        // literal-duplicate case (aliasing via symlinks/absolute-vs-relative is
        // out of scope for this pure check). Empty folders default to a
        // per-space GUID directory and can't collide.
        if !space.folder.is_empty() {
            let key = space.folder.trim_end_matches('/').to_string();
            if let Some(other) = seen_folders.insert(key, id.clone()) {
                err(
                    &mut errors,
                    format!("{id}.folder"),
                    format!("folder {:?} already used by space {other}", space.folder),
                );
            }
        }
        match &space.binding {
            Binding::Prefix { prefix } => {
                let norm = normalize_prefix(prefix);
                if norm.is_empty() {
                    // A bare "/" (or empty) prefix would claim the whole host;
                    // spaces must live under a named path segment.
                    err(
                        &mut errors,
                        format!("{id}.binding"),
                        "prefix must contain at least one path segment (a bare / is not allowed)",
                    );
                } else if norm.starts_with("/.") {
                    err(
                        &mut errors,
                        format!("{id}.binding"),
                        "prefixes starting with /. are reserved",
                    );
                } else {
                    // Prefixes must be unique AND non-overlapping: a space at
                    // /work and another at /work/sub would fight over URL
                    // space (and their service-worker scopes would overlap).
                    let conflict = seen_prefixes.iter().find(|(other_norm, _)| {
                        *other_norm == &norm
                            || norm.starts_with(&format!("{other_norm}/"))
                            || other_norm.starts_with(&format!("{norm}/"))
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
        if let SpaceAuth::Custom {
            user, pass_hash, ..
        } = &space.auth
        {
            if user.trim().is_empty() {
                err(
                    &mut errors,
                    format!("{id}.auth.user"),
                    "custom auth requires a username",
                );
            }
            if !pass_hash.is_empty() && !crate::auth::password::is_valid_phc(pass_hash) {
                err(
                    &mut errors,
                    format!("{id}.auth.passHash"),
                    "not a valid argon2 PHC hash",
                );
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, MultiConfig, SpaceAuth, SpaceConfig};

    fn space(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            auth: SpaceAuth::Inherit,
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

    #[test]
    fn prefix_normalization_rules() {
        assert_eq!(normalize_prefix("/"), "");
        assert_eq!(normalize_prefix("wiki"), "/wiki");
        assert_eq!(normalize_prefix("/wiki/"), "/wiki");
    }

    #[test]
    fn valid_config_passes() {
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
        assert!(validate(&c).is_empty());
    }

    #[test]
    fn root_and_empty_prefixes_rejected() {
        for raw in ["/", "", "//"] {
            let c = cfg(vec![(
                "a",
                space("A", Binding::Prefix { prefix: raw.into() }),
            )]);
            let errs = validate(&c);
            assert!(
                errs.iter().any(|e| e.field == "a.binding"),
                "prefix {raw:?} must be rejected: {errs:?}"
            );
        }
    }

    #[test]
    fn overlapping_prefixes_rejected() {
        // Nested prefixes conflict regardless of declaration order.
        for (p1, p2) in [("/work", "/work/sub"), ("/work/sub", "/work")] {
            let c = cfg(vec![
                ("a", space("A", Binding::Prefix { prefix: p1.into() })),
                ("b", space("B", Binding::Prefix { prefix: p2.into() })),
            ]);
            let errs = validate(&c);
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
        assert!(validate(&c).is_empty());
    }

    #[test]
    fn duplicate_folders_rejected() {
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
        let errs = validate(&cfg(vec![("a", a), ("b", b)]));
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
        assert!(validate(&c).is_empty());
    }

    #[test]
    fn duplicate_bindings_rejected() {
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
        let errs = validate(&c);
        assert!(
            errs.iter().any(|e| e.field.ends_with(".binding")),
            "{errs:?}"
        );
    }

    #[test]
    fn duplicate_hosts_rejected_case_insensitively() {
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
        let errs = validate(&c);
        assert!(
            errs.iter().any(|e| e.field.ends_with(".binding")),
            "{errs:?}"
        );
    }

    #[test]
    fn reserved_bindings_and_invalid_hosts_rejected() {
        let c = cfg(vec![
            (
                "a",
                space(
                    "A",
                    Binding::Prefix {
                        prefix: "/.admin".into(),
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
        let errs = validate(&c);
        assert_eq!(errs.len(), 2, "{errs:?}");
    }

    #[test]
    fn custom_auth_requires_user_and_valid_hash() {
        let mut s = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        s.auth = SpaceAuth::Custom {
            user: String::new(),
            pass_hash: "nonsense".into(),
            auth_token: String::new(),
            lockout_limit: 10,
            lockout_time: 60,
            remember_me_hours: 168,
        };
        let errs = validate(&cfg(vec![("a", s)]));
        assert!(errs.iter().any(|e| e.field == "a.auth.user"), "{errs:?}");
        assert!(
            errs.iter().any(|e| e.field == "a.auth.passHash"),
            "{errs:?}"
        );
    }

    #[test]
    fn empty_name_rejected_and_empty_custom_hash_allowed() {
        // Empty passHash is legal (password not set yet — space stays errored
        // until set), but empty name is not.
        let mut s = space(
            "",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        s.auth = SpaceAuth::Custom {
            user: "u".into(),
            pass_hash: String::new(),
            auth_token: String::new(),
            lockout_limit: 10,
            lockout_time: 60,
            remember_me_hours: 168,
        };
        let errs = validate(&cfg(vec![("a", s)]));
        assert!(errs.iter().any(|e| e.field == "a.name"), "{errs:?}");
        assert!(
            !errs.iter().any(|e| e.field == "a.auth.passHash"),
            "{errs:?}"
        );
    }
}
