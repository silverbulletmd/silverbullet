//! Whole-config validation for multi-space mode. Pure — filesystem checks
//! (folder accessibility) happen in the manager at apply time.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
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

fn binding_label(binding: &Binding) -> String {
    let prefix = normalize_prefix(binding.prefix());
    format!(
        "{}{}",
        binding.host().unwrap_or_default(),
        if prefix.is_empty() { "/" } else { &prefix }
    )
}

pub type RootPrefixConflict = (String, String);

pub fn root_prefix_conflicts(config: &MultiConfig) -> BTreeSet<RootPrefixConflict> {
    root_prefix_conflicts_for_primary(config, None)
}

pub fn root_prefix_conflicts_for_primary(
    config: &MultiConfig,
    primary_host: Option<&str>,
) -> BTreeSet<RootPrefixConflict> {
    let mut conflicts = BTreeSet::new();
    let mut spaces: Vec<_> = config.spaces.iter().collect();
    spaces.sort_by_key(|(id, _)| *id);
    for (i, (id, space)) in spaces.iter().enumerate() {
        for (other_id, other) in spaces.iter().skip(i + 1) {
            if space.binding.effective_host_scope(primary_host)
                == other.binding.effective_host_scope(primary_host)
                && normalize_prefix(space.binding.prefix()).is_empty()
                    != normalize_prefix(other.binding.prefix()).is_empty()
            {
                conflicts.insert(((*id).clone(), (*other_id).clone()));
            }
        }
    }
    conflicts
}

pub fn introduced_root_prefix_conflicts(
    current: &MultiConfig,
    proposed: &MultiConfig,
) -> Vec<FieldError> {
    let current_conflicts = root_prefix_conflicts(current);
    let proposed_conflicts = root_prefix_conflicts(proposed);
    introduced_conflict_errors(
        current,
        proposed,
        current_conflicts,
        proposed_conflicts,
        None,
    )
}

pub fn introduced_root_prefix_conflicts_for_primary(
    current: &MultiConfig,
    proposed: &MultiConfig,
    primary_host: Option<&str>,
) -> Vec<FieldError> {
    let current_conflicts = root_prefix_conflicts_for_primary(current, primary_host);
    let proposed_conflicts = root_prefix_conflicts_for_primary(proposed, primary_host);
    introduced_conflict_errors(
        current,
        proposed,
        current_conflicts,
        proposed_conflicts,
        primary_host,
    )
}

pub fn introduced_root_prefix_conflicts_between_scopes(
    current: &MultiConfig,
    current_primary_host: Option<&str>,
    proposed: &MultiConfig,
    proposed_primary_host: Option<&str>,
) -> Vec<FieldError> {
    let current_conflicts = root_prefix_conflicts_for_primary(current, current_primary_host);
    introduced_conflict_errors(
        &MultiConfig::default(),
        proposed,
        current_conflicts,
        root_prefix_conflicts_for_primary(proposed, proposed_primary_host),
        proposed_primary_host,
    )
}

fn introduced_conflict_errors(
    current: &MultiConfig,
    proposed: &MultiConfig,
    current_conflicts: BTreeSet<RootPrefixConflict>,
    proposed_conflicts: BTreeSet<RootPrefixConflict>,
    primary_host: Option<&str>,
) -> Vec<FieldError> {
    let mut errors = Vec::new();
    for (a, b) in proposed_conflicts.difference(&current_conflicts) {
        for (id, other_id) in [(a, b), (b, a)] {
            let space = &proposed.spaces[id];
            let changed = current.spaces.get(id).is_none_or(|previous| {
                previous.binding.effective_host_scope(primary_host)
                    != space.binding.effective_host_scope(primary_host)
                    || normalize_prefix(previous.binding.prefix())
                        != normalize_prefix(space.binding.prefix())
            });
            if changed {
                let other = &proposed.spaces[other_id];
                err(&mut errors, format!("{id}.binding"), format!(
                    "binding {} conflicts with binding {} of space {:?}: root and prefixed bindings cannot share a hostname",
                    binding_label(&space.binding), binding_label(&other.binding), other.name
                ));
            }
        }
    }
    errors
}

pub fn root_prefix_conflict_warnings(config: &MultiConfig) -> HashMap<String, String> {
    root_prefix_conflict_warnings_for_primary(config, None)
}

pub fn root_prefix_conflict_warnings_for_primary(
    config: &MultiConfig,
    primary_host: Option<&str>,
) -> HashMap<String, String> {
    let mut scopes: BTreeMap<Option<String>, BTreeSet<String>> = BTreeMap::new();
    for (a, b) in root_prefix_conflicts_for_primary(config, primary_host) {
        let ids = scopes
            .entry(config.spaces[&a].binding.effective_host_scope(primary_host))
            .or_default();
        ids.insert(a);
        ids.insert(b);
    }
    let mut warnings = HashMap::new();
    for (scope, ids) in scopes {
        let hostname = scope.map_or_else(
            || "the default hostname".into(),
            |host| format!("hostname {host}"),
        );
        let spaces: Vec<_> = ids
            .iter()
            .map(|id| {
                let space = &config.spaces[id];
                format!("{:?} ({})", space.name, binding_label(&space.binding))
            })
            .collect();
        let warning = format!(
            "Root and prefixed bindings share {hostname}: {}. Move these spaces to separate hostnames or remove the root binding.", spaces.join(", ")
        );
        for id in ids {
            warnings.insert(id, warning.clone());
        }
    }
    warnings
}

/// Validate the whole config. Empty result = acceptable. Field paths are
/// `<space-id>.<jsonField>`.
pub fn validate(
    config: &MultiConfig,
    root: &Path,
    known_users: &BTreeSet<String>,
) -> Vec<FieldError> {
    validate_for_primary(config, root, known_users, None)
}

pub fn validate_for_primary(
    config: &MultiConfig,
    root: &Path,
    known_users: &BTreeSet<String>,
    primary_host: Option<&str>,
) -> Vec<FieldError> {
    let mut errors = Vec::new();
    let mut seen_bindings: Vec<(&String, Option<String>, String)> = Vec::new();
    let mut spaces: Vec<_> = config.spaces.iter().collect();
    spaces.sort_by_key(|(id, _)| *id);

    for (id, space) in spaces {
        if space.extra.contains_key("auth") {
            err(
                &mut errors,
                format!("{id}.auth"),
                "unknown field (use access/members for access)",
            );
        }
        if space.name.trim().is_empty() {
            err(&mut errors, format!("{id}.name"), "name must not be empty");
        }
        if let Some(host) = space.binding.host() {
            if !valid_host_authority(host) {
                err(
                    &mut errors,
                    format!("{id}.binding"),
                    "host must be an ASCII DNS name or canonical IPv4 address, optionally followed by a port from 1 to 65535",
                );
            } else if host
                .split(':')
                .next()
                .unwrap_or(host)
                .trim_end_matches('.')
                .to_ascii_lowercase()
                .ends_with(".runtime.localhost")
            {
                err(
                    &mut errors,
                    format!("{id}.binding"),
                    "hosts ending in .runtime.localhost are reserved for the Runtime API",
                );
            }
        }
        let norm = normalize_prefix(space.binding.prefix());
        let scope = space.binding.effective_host_scope(primary_host);
        if norm.starts_with("/.") {
            err(
                &mut errors,
                format!("{id}.binding"),
                "prefixes starting with /. are reserved",
            );
        } else {
            let conflict = seen_bindings.iter().find(|(_, other_scope, other_norm)| {
                other_scope == &scope
                    && (other_norm == &norm
                        || (!norm.is_empty()
                            && !other_norm.is_empty()
                            && (norm.starts_with(&format!("{other_norm}/"))
                                || other_norm.starts_with(&format!("{norm}/")))))
            });
            if let Some((other_id, _, _)) = conflict {
                let other = &config.spaces[*other_id];
                err(
                    &mut errors,
                    format!("{id}.binding"),
                    format!(
                        "binding {} overlaps binding {} of space {:?}",
                        binding_label(&space.binding),
                        binding_label(&other.binding),
                        other.name
                    ),
                );
            }
            seen_bindings.push((id, scope, norm));
        }
        for (member, entry) in &space.members {
            if entry.runtime_api && entry.role != super::config::MemberRole::Write {
                err(
                    &mut errors,
                    format!("{id}.members.{member}.runtimeApi"),
                    "runtime API requires Write access",
                );
            }
            if !known_users.contains(member) {
                err(
                    &mut errors,
                    format!("{id}.members"),
                    format!("unknown user {member:?}"),
                );
            }
        }
        if !space.git_sync().mode.is_off()
            && space.revisions != silverbullet_server_common::RevisionsMode::Managed
        {
            err(
                &mut errors,
                format!("{id}.gitSync"),
                "git sync requires managed revisions; remove the Git connection before disabling automatic revisions",
            );
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

pub fn valid_host_authority(host: &str) -> bool {
    if host.is_empty()
        || host.trim() != host
        || !host.is_ascii()
        || host.contains(['/', '\\', '?', '#', '@'])
    {
        return false;
    }
    let (host, port) = match host.split_once(':') {
        Some((host, port)) if !host.contains(':') => (host, Some(port)),
        Some(_) => return false,
        None => (host, None),
    };
    if port.is_some_and(|port| {
        port.is_empty()
            || (port.len() > 1 && port.starts_with('0'))
            || !port.bytes().all(|byte| byte.is_ascii_digit())
            || !matches!(port.parse::<u16>(), Ok(1..=u16::MAX))
    }) {
        return false;
    }
    let host = host.strip_suffix('.').unwrap_or(host);
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    let parsed_host = reqwest::Url::parse(&format!("http://{host}/"))
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    if parsed_host.as_deref() != Some(&host.to_ascii_lowercase()) {
        return false;
    }
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    let labels: Vec<_> = host.split('.').collect();
    if labels.len() == 4
        && labels
            .iter()
            .all(|label| label.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return false;
    }
    labels.into_iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

pub fn normalize_host_authority(host: &str) -> String {
    let host = host.trim();
    match host.split_once(':') {
        Some((hostname, port)) if !hostname.contains(':') => format!(
            "{}:{port}",
            hostname.trim_end_matches('.').to_ascii_lowercase()
        ),
        _ => host.trim_end_matches('.').to_ascii_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::config::{Binding, MultiConfig, SpaceAccess, SpaceConfig};

    fn space(name: &str, binding: Binding) -> SpaceConfig {
        SpaceConfig {
            name: name.into(),
            folder: String::new(),
            binding,
            access: Some(SpaceAccess::Write),
            legacy_public: None,
            members: Default::default(),
            read_only: false,
            shell: Default::default(),
            index_page: "index".into(),
            description: String::new(),
            theme_color: "#e1e1e1".into(),
            head_html: String::new(),
            space_ignore: String::new(),
            log_push: false,
            revisions: Default::default(),
            git_sync: None,
            revisions_commit: None,
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

    fn host(host: &str, prefix: &str) -> Binding {
        Binding::Host {
            host: host.into(),
            prefix: prefix.into(),
        }
    }

    #[test]
    fn hostname_scoped_prefix_validation() {
        let dir = tempfile::tempdir().unwrap();
        for (left, right, valid) in [
            (
                host("team.example.com", "/work"),
                host("team.example.com", "/wiki"),
                true,
            ),
            (
                host("team.example.com", "/work"),
                host("team.example.com", "/work/"),
                false,
            ),
            (
                host("team.example.com", "/work"),
                host("team.example.com", "/work/sub"),
                false,
            ),
            (
                host("team.example.com", "/work/sub"),
                host("team.example.com", "/work"),
                false,
            ),
            (
                host("team.example.com", "/work"),
                host("other.example.com", "/work"),
                true,
            ),
            (
                host("team.example.com", "/work"),
                host("team.example.com:3000", "/work"),
                true,
            ),
            (
                host("TEAM.example.com.", "/work"),
                host("team.example.com", "/work/sub"),
                false,
            ),
            (
                host("TEAM.example.com.", "/"),
                host("team.example.com", ""),
                false,
            ),
            (
                host("team.example.com", "/"),
                host("team.example.com", "/work"),
                true,
            ),
            (
                Binding::Prefix {
                    prefix: "/work".into(),
                },
                host("team.example.com", "/work"),
                true,
            ),
            (
                host("team.example.com", "/.dashboard"),
                host("other.example.com", "/wiki"),
                false,
            ),
        ] {
            let config = cfg(vec![("a", space("A", left)), ("b", space("B", right))]);
            let errors = validate(&config, dir.path(), &users(&[]));
            assert_eq!(errors.is_empty(), valid, "{config:?}: {errors:?}");
        }
    }

    #[test]
    fn root_conflict_sets_use_stable_ids_and_normalized_hostname_scopes() {
        let dir = tempfile::tempdir().unwrap();
        let config = cfg(vec![
            ("z-root", space("Root", host("TEAM.example.com.", "/"))),
            ("a-work", space("Work", host("team.example.com", "work/"))),
            ("b-wiki", space("Wiki", host("other.example.com", "/wiki"))),
            (
                "default",
                space("Default", Binding::Prefix { prefix: "/".into() }),
            ),
        ]);
        assert!(validate(&config, dir.path(), &users(&[])).is_empty());
        assert_eq!(
            root_prefix_conflicts(&config),
            BTreeSet::from([("a-work".into(), "z-root".into())])
        );
    }

    #[test]
    fn primary_hostname_and_implicit_bindings_share_one_scope() {
        let config = cfg(vec![
            (
                "root",
                space(
                    "Root",
                    Binding::Host {
                        host: "Manager.Example.test.".into(),
                        prefix: String::new(),
                    },
                ),
            ),
            (
                "notes",
                space(
                    "Notes",
                    Binding::Prefix {
                        prefix: "/notes".into(),
                    },
                ),
            ),
        ]);
        assert_eq!(
            root_prefix_conflicts_for_primary(&config, Some("manager.example.test")),
            BTreeSet::from([("notes".into(), "root".into())])
        );
    }

    #[test]
    fn validates_hostnames_with_optional_ports() {
        let dir = tempfile::tempdir().unwrap();
        for host in [
            ".",
            " notes.example.test",
            "notes.example.test ",
            "notes\\evil.test",
            "notes.example.test?x",
            "notes.example.test#x",
            "user@notes.example.test",
            "-notes.example.test",
            "notes-.example.test",
            "notes..example.test",
            "notes_example.test",
            "999.1.1.1",
            "001.2.3.4",
            "[::1]",
            "127.1",
            "2130706433",
            "0x7f000001",
            "123",
            "notes.example.test:",
            "notes.example.test:0",
            "notes.example.test:65536",
            "notes.example.test:03000",
            "notes.example.test:port",
        ] {
            let config = cfg(vec![(
                "a",
                space(
                    "A",
                    Binding::Host {
                        host: host.into(),
                        prefix: "/work".into(),
                    },
                ),
            )]);
            assert!(
                !validate(&config, dir.path(), &users(&[])).is_empty(),
                "accepted {host:?}"
            );
        }
        for host in [
            "localhost",
            "notes.home",
            "127.0.0.1",
            "Notes.Example.test.",
            "notes.example.test:3000",
            "127.0.0.1:8080",
            "Notes.Example.test.:443",
        ] {
            let config = cfg(vec![(
                "a",
                space(
                    "A",
                    Binding::Host {
                        host: host.into(),
                        prefix: "/work".into(),
                    },
                ),
            )]);
            assert!(
                validate(&config, dir.path(), &users(&[])).is_empty(),
                "rejected {host:?}"
            );
        }
    }

    #[test]
    fn proposed_root_conflicts_must_be_a_subset_of_existing_pairs() {
        let current = cfg(vec![
            ("root", space("Root", host("team.example.com", ""))),
            ("work", space("Work", host("team.example.com", "/work"))),
        ]);
        let mut reduced = current.clone();
        reduced.spaces.remove("work");
        let mut expanded = current.clone();
        expanded.spaces.insert(
            "wiki".into(),
            space("Wiki", host("team.example.com", "/wiki")),
        );
        let mut replaced = expanded.clone();
        replaced.spaces.remove("work");
        let mut renamed = current.clone();
        renamed.spaces.get_mut("work").unwrap().name = "Renamed".into();
        let mut moved = current.clone();
        moved.spaces.get_mut("work").unwrap().binding = host("other.example.com", "/work");
        for (proposed, expected_fields) in [
            (current.clone(), vec![]),
            (reduced, vec![]),
            (renamed, vec![]),
            (moved, vec![]),
            (expanded, vec!["wiki.binding"]),
            (replaced, vec!["wiki.binding"]),
        ] {
            let errors = introduced_root_prefix_conflicts(&current, &proposed);
            assert_eq!(
                errors.iter().map(|e| e.field.as_str()).collect::<Vec<_>>(),
                expected_fields
            );
            for error in errors {
                assert!(error.message.contains("team.example.com/wiki"), "{error:?}");
                assert!(error.message.contains("Root"), "{error:?}");
            }
        }
        let mut swapped = current.clone();
        swapped.spaces.get_mut("root").unwrap().binding = host("team.example.com", "/archive");
        swapped.spaces.get_mut("work").unwrap().binding = host("team.example.com", "");
        assert!(introduced_root_prefix_conflicts(&current, &swapped).is_empty());
        let errors = introduced_root_prefix_conflicts(&MultiConfig::default(), &current);
        assert!(!errors.is_empty());
    }

    #[test]
    fn root_conflict_warnings_are_shared_by_every_affected_space() {
        let config = cfg(vec![
            ("root", space("Root", Binding::Prefix { prefix: "".into() })),
            (
                "work",
                space(
                    "Work",
                    Binding::Prefix {
                        prefix: "/work".into(),
                    },
                ),
            ),
            (
                "wiki",
                space(
                    "Wiki",
                    Binding::Prefix {
                        prefix: "/wiki".into(),
                    },
                ),
            ),
            ("other", space("Other", host("other.example.com", ""))),
        ]);
        let warning = "Root and prefixed bindings share the default hostname: \"Root\" (/), \"Wiki\" (/wiki), \"Work\" (/work). Move these spaces to separate hostnames or remove the root binding.";
        assert_eq!(
            root_prefix_conflict_warnings(&config),
            HashMap::from([
                ("root".into(), warning.into()),
                ("wiki".into(), warning.into()),
                ("work".into(), warning.into()),
            ])
        );
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
                        prefix: String::new(),
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
                        prefix: String::new(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Host {
                        host: "notes.example.COM".into(),
                        prefix: String::new(),
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
    fn runtime_localhost_bindings_are_reserved() {
        let dir = tempfile::tempdir().unwrap();
        for host in ["notes.runtime.localhost", "NOTES.RUNTIME.LOCALHOST."] {
            let c = cfg(vec![(
                "a",
                space(
                    "Notes",
                    Binding::Host {
                        host: host.into(),
                        prefix: String::new(),
                    },
                ),
            )]);
            let errors = validate(&c, dir.path(), &users(&[]));
            assert!(
                errors
                    .iter()
                    .any(|error| error.field == "a.binding" && error.message.contains("reserved")),
                "{host}: {errors:?}"
            );
        }
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
                        prefix: "/.dashboard".into(),
                    },
                ),
            ),
            (
                "b",
                space(
                    "B",
                    Binding::Host {
                        host: "with/slash".into(),
                        prefix: String::new(),
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

    #[test]
    fn git_sync_requires_managed_revisions() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        s.revisions = silverbullet_server_common::RevisionsMode::Unmanaged;
        s.git_sync = Some(crate::multi::config::GitSyncConfig {
            paused: false,
            mode: crate::multi::config::GitSyncMode::Key,
            pull_interval_secs: 300,
        });

        let errs = validate(&cfg(vec![("a", s)]), dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field == "a.gitSync"),
            "expected a gitSync error, got {errs:?}"
        );
    }

    /// Manual mode is just as much "on" as key mode -- it is the credential
    /// story that differs, not whether the space touches a remote.
    #[test]
    fn manual_git_sync_also_requires_managed_revisions() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        s.revisions = silverbullet_server_common::RevisionsMode::Unmanaged;
        s.git_sync = Some(crate::multi::config::GitSyncConfig {
            paused: false,
            mode: crate::multi::config::GitSyncMode::Manual,
            pull_interval_secs: 300,
        });

        let errs = validate(&cfg(vec![("a", s)]), dir.path(), &users(&[]));
        assert!(
            errs.iter().any(|e| e.field == "a.gitSync"),
            "expected a gitSync error, got {errs:?}"
        );
    }

    #[test]
    fn git_sync_off_on_unmanaged_revisions_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = space(
            "A",
            Binding::Prefix {
                prefix: "/a".into(),
            },
        );
        s.revisions = silverbullet_server_common::RevisionsMode::Unmanaged;
        s.git_sync = Some(crate::multi::config::GitSyncConfig {
            paused: false,
            mode: crate::multi::config::GitSyncMode::Off,
            pull_interval_secs: 300,
        });

        let errs = validate(&cfg(vec![("a", s)]), dir.path(), &users(&[]));
        assert!(
            !errs.iter().any(|e| e.field == "a.gitSync"),
            "expected no gitSync error, got {errs:?}"
        );
    }
}
