use std::collections::BTreeMap;
use std::sync::Arc;

use crate::auth::{AccessLevel, AccessPolicy};
use crate::multi::config::{MemberEntry, MemberRole, SpaceAccess};
use crate::multi::users::UserStore;

/// Resolves the effective access level for one space: the maximum of what the
/// public gets, what this account's member role gets, and admin (always
/// write) -- then capped by the space's freeze.
///
/// Admin status is read live from the store, so promoting an account takes
/// effect without rebuilding the space. `access` and `members` come from the
/// space config, which rebuilds the instance when it changes.
pub struct SpaceAccessPolicy {
    users: Arc<UserStore>,
    access: SpaceAccess,
    members: BTreeMap<String, MemberEntry>,
    frozen: bool,
}

impl SpaceAccessPolicy {
    pub fn new(
        users: Arc<UserStore>,
        access: SpaceAccess,
        members: BTreeMap<String, MemberEntry>,
        frozen: bool,
    ) -> Self {
        Self {
            users,
            access,
            members,
            frozen,
        }
    }
}

fn level_of(access: SpaceAccess) -> AccessLevel {
    match access {
        SpaceAccess::None => AccessLevel::None,
        SpaceAccess::Read => AccessLevel::Read,
        SpaceAccess::Write => AccessLevel::Write,
    }
}

fn level_of_role(role: MemberRole) -> AccessLevel {
    match role {
        MemberRole::Read => AccessLevel::Read,
        MemberRole::Write => AccessLevel::Write,
    }
}

impl AccessPolicy for SpaceAccessPolicy {
    fn level_for(&self, username: Option<&str>) -> AccessLevel {
        let mut level = level_of(self.access);
        if let Some(username) = username {
            if self.users.is_admin(username) {
                level = AccessLevel::Write;
            } else if let Some(entry) = self.members.get(username) {
                level = level.max(level_of_role(entry.role));
            }
        }
        if self.frozen {
            level = level.min(AccessLevel::Read);
        }
        level
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multi::users::Profile;

    /// Temp `UserStore` with admin `root`, non-admins `zef` and `sam`.
    fn store() -> (tempfile::TempDir, Arc<UserStore>) {
        let dir = tempfile::tempdir().unwrap();
        let store = UserStore::create_empty(dir.path()).unwrap();
        store
            .create_user("root", "rootpw123", true, Profile::default())
            .unwrap();
        store
            .create_user("zef", "zefpw12345", false, Profile::default())
            .unwrap();
        store
            .create_user("sam", "sampw12345", false, Profile::default())
            .unwrap();
        (dir, store)
    }

    fn policy(
        access: SpaceAccess,
        members: &[(&str, MemberRole)],
        frozen: bool,
    ) -> SpaceAccessPolicy {
        let (_dir, store) = store();
        let members = members
            .iter()
            .map(|(name, role)| {
                (
                    (*name).to_string(),
                    MemberEntry {
                        role: *role,
                        extra: Default::default(),
                    },
                )
            })
            .collect();
        SpaceAccessPolicy::new(store, access, members, frozen)
    }

    #[test]
    fn private_space_denies_anonymous_and_non_members() {
        let p = policy(SpaceAccess::None, &[("zef", MemberRole::Write)], false);
        assert_eq!(p.level_for(None), AccessLevel::None);
        assert_eq!(p.level_for(Some("sam")), AccessLevel::None);
    }

    #[test]
    fn member_roles_map_to_levels() {
        let p = policy(
            SpaceAccess::None,
            &[("zef", MemberRole::Write), ("sam", MemberRole::Read)],
            false,
        );
        assert_eq!(p.level_for(Some("zef")), AccessLevel::Write);
        assert_eq!(p.level_for(Some("sam")), AccessLevel::Read);
    }

    #[test]
    fn admins_always_get_write() {
        let p = policy(SpaceAccess::None, &[], false);
        assert_eq!(p.level_for(Some("root")), AccessLevel::Write);
    }

    #[test]
    fn public_read_is_the_floor_not_a_ceiling() {
        let p = policy(
            SpaceAccess::Read,
            &[("zef", MemberRole::Write), ("sam", MemberRole::Read)],
            false,
        );
        assert_eq!(p.level_for(None), AccessLevel::Read);
        assert_eq!(p.level_for(Some("nobody")), AccessLevel::Read);
        assert_eq!(p.level_for(Some("zef")), AccessLevel::Write);
        assert_eq!(p.level_for(Some("sam")), AccessLevel::Read);
    }

    #[test]
    fn public_write_grants_everyone_write() {
        let p = policy(SpaceAccess::Write, &[], false);
        assert_eq!(p.level_for(None), AccessLevel::Write);
    }

    #[test]
    fn freeze_caps_everyone_including_admins() {
        let p = policy(SpaceAccess::Write, &[("zef", MemberRole::Write)], true);
        assert_eq!(p.level_for(None), AccessLevel::Read);
        assert_eq!(p.level_for(Some("zef")), AccessLevel::Read);
        assert_eq!(p.level_for(Some("root")), AccessLevel::Read);
    }

    #[test]
    fn freeze_does_not_grant_access_to_a_private_space() {
        let p = policy(SpaceAccess::None, &[], true);
        assert_eq!(p.level_for(None), AccessLevel::None);
    }
}
