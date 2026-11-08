use crate::auth::authorizer::{AuthContext, AuthOutcome, RequestAuthorizer};

/// What a caller may do in a space. Ordered: a higher level includes every
/// permission of the levels below it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub enum AccessLevel {
    #[default]
    None,
    Read,
    Edit,
    Write,
}

/// Editors cannot change executable space sources. Reject noncanonical names
/// and filesystem aliases too: the same source must not gain permissions when
/// addressed through a symlink, case alias, or Windows short filename.
pub(crate) fn can_mutate_file(level: AccessLevel, root: &str, path: &str) -> bool {
    if level >= AccessLevel::Write {
        return true;
    }
    if level < AccessLevel::Edit || !editable_path(path) {
        return false;
    }
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    let mut current = root.clone();
    let mut missing = false;
    for component in path.split('/') {
        current.push(component);
        if missing {
            continue;
        }
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return false,
            Ok(_) => {
                let Ok(resolved) = current.canonicalize() else {
                    return false;
                };
                let Ok(relative) = resolved.strip_prefix(&root) else {
                    return false;
                };
                if !editable_path(&relative.to_string_lossy().replace('\\', "/")) {
                    return false;
                }
                current = resolved;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing = true,
            Err(_) => return false,
        }
    }
    protected_alias_free(&root, &current).unwrap_or(false)
}

fn protected_alias_free(root: &std::path::Path, target: &std::path::Path) -> std::io::Result<bool> {
    // A source can point back into an otherwise editable directory. Check the
    // reverse aliases as well, including symlinks nested inside the Library.
    let mut pending = vec![root.join("Library"), root.join("CONFIG.md")];
    let mut visited = std::collections::HashSet::new();
    while let Some(path) = pending.pop() {
        match std::fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            result => {
                result?;
            }
        }
        let resolved = path.canonicalize()?;
        if !visited.insert(resolved.clone()) {
            continue;
        }
        let is_dir = resolved.is_dir();
        if resolved == target || (is_dir && target.starts_with(&resolved)) {
            return Ok(false);
        }
        if is_dir {
            for entry in std::fs::read_dir(resolved)? {
                let entry = entry?;
                let kind = entry.file_type()?;
                if kind.is_dir() || kind.is_symlink() {
                    pending.push(entry.path());
                }
            }
        }
    }
    Ok(true)
}

fn editable_path(path: &str) -> bool {
    if path.contains(['\\', ':', '\0']) {
        return false;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(['.', ' ']))
    {
        return false;
    }
    !(parts[0].eq_ignore_ascii_case("Library")
        || parts.len() == 1 && parts[0].eq_ignore_ascii_case("CONFIG.md"))
}

/// Turns a verified identity (or the absence of one) into an access level for
/// this space. Every server uses `AuthorizedPolicy` today; a later task adds
/// the multi-space `access`/roles/admin policy built per space.
pub trait AccessPolicy: Send + Sync {
    fn level_for(&self, username: Option<&str>) -> AccessLevel;

    fn runtime_allowed(&self, username: Option<&str>) -> bool {
        self.level_for(username) == AccessLevel::Write
    }
}

/// Reaching the policy at all means the authorizer already said yes, which on
/// a single-space server is the whole decision.
pub struct AuthorizedPolicy;

impl AccessPolicy for AuthorizedPolicy {
    fn level_for(&self, _username: Option<&str>) -> AccessLevel {
        AccessLevel::Write
    }
}

/// Turns "no credentials" into an anonymous identity so the policy can grade
/// it, rather than a refusal the middleware would act on directly. Anonymous
/// access is a grant the policy makes, not an absence of authorization.
pub struct AnonymousFallbackAuthorizer {
    inner: Box<dyn RequestAuthorizer>,
}

impl AnonymousFallbackAuthorizer {
    pub fn new(inner: Box<dyn RequestAuthorizer>) -> Self {
        Self { inner }
    }
}

impl RequestAuthorizer for AnonymousFallbackAuthorizer {
    fn authorize(&self, ctx: &AuthContext) -> Option<AuthOutcome> {
        Some(
            self.inner
                .authorize(ctx)
                .unwrap_or_else(AuthOutcome::anonymous),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthOutcome;

    #[test]
    fn editor_paths_reject_sources_and_aliases_but_write_remains_unrestricted() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        for path in [
            "Library",
            "Library/New.md",
            "library/New.md",
            "CONFIG.md",
            "config.MD",
            "./CONFIG.md",
            "Notes/../CONFIG.md",
            "/CONFIG.md",
            "CONFIG.md.",
            "CONFIG.md ",
            "Library\\Rules.md",
            "CONFIG.md:stream",
            "Notes//Today.md",
        ] {
            assert!(!can_mutate_file(AccessLevel::Edit, root, path), "{path}");
            assert!(can_mutate_file(AccessLevel::Write, root, path), "{path}");
        }
        for path in [
            "Notes/Today.md",
            "Notes/CONFIG.md",
            "Library.md",
            "photo.png",
        ] {
            assert!(can_mutate_file(AccessLevel::Edit, root, path), "{path}");
            assert!(!can_mutate_file(AccessLevel::Read, root, path), "{path}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn editor_cannot_mutate_sources_through_filesystem_aliases() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        std::fs::create_dir(dir.path().join("Library")).unwrap();
        std::fs::write(dir.path().join("CONFIG.md"), "original").unwrap();
        std::os::unix::fs::symlink("Library", dir.path().join("Notes")).unwrap();
        std::os::unix::fs::symlink("CONFIG.md", dir.path().join("Settings.md")).unwrap();
        for path in ["Notes/New.md", "Settings.md"] {
            assert!(!can_mutate_file(AccessLevel::Edit, root, path));
            assert!(can_mutate_file(AccessLevel::Write, root, path));
        }
    }

    #[cfg(unix)]
    #[test]
    fn editor_cannot_change_reverse_source_aliases() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        std::fs::create_dir_all(dir.path().join("Notes/Rules")).unwrap();
        std::fs::create_dir(dir.path().join("Library")).unwrap();
        std::fs::write(dir.path().join("Notes/Settings.md"), "original").unwrap();
        std::os::unix::fs::symlink("Notes/Settings.md", dir.path().join("CONFIG.md")).unwrap();
        std::os::unix::fs::symlink("../Notes/Rules", dir.path().join("Library/Rules")).unwrap();
        assert!(!can_mutate_file(
            AccessLevel::Edit,
            root,
            "Notes/Settings.md"
        ));
        assert!(!can_mutate_file(
            AccessLevel::Edit,
            root,
            "Notes/Rules/New.md"
        ));
        assert!(can_mutate_file(AccessLevel::Edit, root, "Notes/Today.md"));
    }

    #[test]
    fn levels_are_ordered() {
        assert!(AccessLevel::None < AccessLevel::Read);
        assert!(AccessLevel::Read < AccessLevel::Edit);
        assert!(AccessLevel::Edit < AccessLevel::Write);
    }

    #[test]
    fn authorized_policy_grants_write_to_any_username() {
        let policy = AuthorizedPolicy;
        assert_eq!(policy.level_for(Some("zef")), AccessLevel::Write);
        assert_eq!(policy.level_for(None), AccessLevel::Write);
    }

    #[test]
    fn outcome_constructors_carry_the_right_grant() {
        assert_eq!(AuthOutcome::user("zef".into()).grant, None);
        assert_eq!(AuthOutcome::anonymous().grant, None);
        assert_eq!(AuthOutcome::trusted().grant, Some(AccessLevel::Write));
    }

    struct DenyAll;
    impl RequestAuthorizer for DenyAll {
        fn authorize(&self, _ctx: &AuthContext) -> Option<AuthOutcome> {
            None
        }
    }

    #[test]
    fn anonymous_fallback_turns_a_denial_into_an_anonymous_outcome() {
        let authorizer = AnonymousFallbackAuthorizer::new(Box::new(DenyAll));
        let headers = axum::http::HeaderMap::new();
        let ctx = AuthContext {
            method: &axum::http::Method::GET,
            path: "/.fs",
            query: None,
            headers: &headers,
        };
        let outcome = authorizer.authorize(&ctx).expect("always Some");
        assert_eq!(outcome.username, None);
        assert_eq!(outcome.grant, None);
    }
}
