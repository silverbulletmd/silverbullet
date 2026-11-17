//! Running a migration plan. The plan is written to a journal in the data
//! root before anything moves, so a migration that stops halfway (a crash, a
//! file it can't move) can be finished later from the journal and the disk:
//! an entry still in the root has yet to move, one in the space folder has
//! moved. Entries are only ever renamed: nothing in the folder is copied,
//! overwritten or deleted, apart from the single-space auth file once its
//! salt has been carried over.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ffi::OsStr;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::blockers::find_blockers;
use super::plan::{top_level_entries, AdminPlan, MigrationPlan, Move, CHROME_DATA_DIR};
use super::report::{
    display_prefix, markdown, needs_prefix_note, MigrationReport, MIGRATED_TOKEN_NAME,
};
use super::{JOURNAL_FILE, REPORT_FILE};
use crate::auth::authenticator::{read_salt, seed_salt};
use crate::auth::{AUTH_FILE_NAME, MULTI_AUTH_FILE_NAME};
use crate::multi::config::MultiConfig;
use crate::multi::server_config::ServerConfig;
use crate::multi::users::{
    hash_token, now_rfc3339, TokenEntry, UserEntry, UsersConfig, USERS_FILE,
};

/// The credentials a plan's admin account needs, held in memory only: the
/// journal and every written file get their hashes.
#[derive(Clone, Default)]
pub struct MigrationSecrets {
    /// The admin's password: from `SB_USER` for `AdminPlan::FromEnv`, from
    /// the submitted form for `AdminPlan::New`.
    pub password: Option<String>,
    /// `SB_AUTH_TOKEN`, when the plan keeps it as an API token.
    pub auth_token: Option<String>,
}

impl std::fmt::Debug for MigrationSecrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MigrationSecrets")
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field(
                "auth_token",
                &self.auth_token.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

/// `<root>/.migration-journal.json`: everything needed to finish a migration
/// without the original request or environment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub plan: MigrationPlan,
    /// The `users.json` to write. Holds only password and token hashes.
    pub users: BTreeMap<String, UserEntry>,
    /// The single-space client-encryption salt, for the multi-space session
    /// file, so clients derive the same key and keep their local database.
    pub salt: Option<String>,
    /// The single-space auth file couldn't be read: it stays in the root.
    pub keep_auth_file: bool,
}

/// The journal of an interrupted migration, if there is one. A journal that
/// can't be read or parsed is an error, never mistaken for no journal.
pub fn pending_journal(root: &Path) -> Result<Option<Journal>, String> {
    let path = root.join(JOURNAL_FILE);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("could not read {}: {e}", path.display())),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("{} is damaged: {e}", path.display()))
}

/// Runs `plan` against `root`. Refuses when the folder no longer matches the
/// plan or anything blocks it (both rechecked against the disk now), or when
/// a journal already exists.
pub fn execute(
    root: &Path,
    plan: &MigrationPlan,
    secrets: &MigrationSecrets,
) -> Result<MigrationReport, String> {
    if std::fs::symlink_metadata(root.join(JOURNAL_FILE)).is_ok() {
        return Err("A migration was interrupted. Finish it instead of starting another.".into());
    }
    let dest = destination(root, plan)?;
    let entries =
        top_level_entries(root).map_err(|e| format!("could not list {}: {e}", root.display()))?;
    check_moves(root, &dest, &plan.moves, &entries)?;
    blocked(find_blockers(root, &dest, &entries))?;
    let journal = prepare_journal(root, plan, secrets)?;
    create_journal(root, &journal)?;
    if let Err(e) = prepare_destination(root, &dest) {
        back_out(root, &dest);
        return Err(format!(
            "{e}. The migration needs the filesystem to confirm that changes reach the disk, so it did not start. Nothing was moved."
        ));
    }
    run(root, &journal)
}

/// Undoes what a run that failed before its first move created.
fn back_out(root: &Path, dest: &Path) {
    let _ = std::fs::remove_file(root.join(JOURNAL_FILE));
    let _ = std::fs::remove_dir(dest);
    if let Some(spaces) = dest.parent() {
        let _ = std::fs::remove_dir(spaces);
    }
    sync_dir(root);
}

/// Creates the space folder and gets it, and the journal next to the
/// entries, onto the disk: a rename out of the root may otherwise reach the
/// disk before the folder it went into does, orphaning the entry.
fn prepare_destination(root: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Could not create {}: {e}", dest.display()))?;
    flush_dir(dest)?;
    if let Some(spaces) = dest.parent() {
        flush_dir(spaces)?;
    }
    flush_dir(root)
}

/// Finishes the migration recorded in the journal. Needs no secrets: the
/// journal holds the hashes `execute` computed. Blockers are rechecked only
/// for the entries still in the root; the journal itself is expected.
pub fn resume(root: &Path) -> Result<MigrationReport, String> {
    let journal = pending_journal(root)?
        .ok_or_else(|| "There is no interrupted migration to finish.".to_string())?;
    let dest = destination(root, &journal.plan)?;
    let mut pending = Vec::new();
    for entry in &journal.plan.moves {
        let from = root.join(entry_name(entry)?);
        if std::fs::symlink_metadata(&from).is_ok() {
            pending.push(from);
        }
    }
    blocked(find_blockers(root, &dest, &pending))?;
    prepare_destination(root, &dest)
        .map_err(|e| format!("{e}. Fix this, then finish the migration."))?;
    run(root, &journal)
}

fn blocked(blockers: Vec<super::Blocker>) -> Result<(), String> {
    if blockers.is_empty() {
        return Ok(());
    }
    let messages: Vec<String> = blockers.iter().map(super::Blocker::message).collect();
    Err(messages.join("\n"))
}

/// `<root>/spaces/<folder>`, refusing any other shape of `space.folder`.
fn destination(root: &Path, plan: &MigrationPlan) -> Result<PathBuf, String> {
    plan.space
        .folder
        .strip_prefix("spaces/")
        .filter(|folder| single_name(OsStr::new(folder)))
        .map(|folder| root.join("spaces").join(folder))
        .ok_or_else(|| format!("invalid plan: space folder {:?}", plan.space.folder))
}

fn single_name(name: &OsStr) -> bool {
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

/// The name a move's entry has, both in the root and in the destination.
fn entry_name(entry: &Move) -> Result<&OsStr, String> {
    entry
        .from
        .file_name()
        .filter(|name| single_name(name))
        .ok_or_else(|| format!("invalid plan: cannot move {}", entry.from.display()))
}

/// The plan moves exactly the folder's current `entries`, each from the root
/// to the same name in `dest`.
fn check_moves(
    root: &Path,
    dest: &Path,
    moves: &[Move],
    entries: &[PathBuf],
) -> Result<(), String> {
    for entry in moves {
        let name = entry_name(entry)?;
        if entry.from != root.join(name) || entry.to != dest.join(name) {
            return Err(format!(
                "invalid plan: cannot move {} to {}",
                entry.from.display(),
                entry.to.display()
            ));
        }
    }
    let planned: BTreeSet<&PathBuf> = moves.iter().map(|entry| &entry.from).collect();
    let present: BTreeSet<&PathBuf> = entries.iter().collect();
    if planned != present || planned.len() != moves.len() {
        return Err(
            "The folder changed since the plan was made. Reload the page to see the new plan."
                .into(),
        );
    }
    Ok(())
}

/// The journal for `plan`, with the admin's credentials hashed.
fn prepare_journal(
    root: &Path,
    plan: &MigrationPlan,
    secrets: &MigrationSecrets,
) -> Result<Journal, String> {
    let mut users = BTreeMap::new();
    if let AdminPlan::FromEnv { username } | AdminPlan::New { username } = &plan.admin {
        let password = secrets
            .password
            .as_deref()
            .filter(|password| !password.is_empty())
            .ok_or("The administrator's password is missing.")?;
        let mut tokens = BTreeMap::new();
        if plan.api_token {
            let token = secrets
                .auth_token
                .as_deref()
                .filter(|token| !token.is_empty())
                .ok_or("SB_AUTH_TOKEN is not set, but the plan keeps it as an API token.")?;
            tokens.insert(
                MIGRATED_TOKEN_NAME.to_string(),
                TokenEntry {
                    token_hash: hash_token(token),
                    created_at: now_rfc3339(),
                },
            );
        }
        users.insert(
            username.clone(),
            UserEntry {
                password_hash: Some(crate::auth::password::hash_password(password)?),
                sso: None,
                admin: true,
                disabled: false,
                full_name: None,
                email: None,
                tokens,
                session_epoch: 0,
                account_generation: Some(uuid::Uuid::new_v4().to_string()),
                last_login: None,
                extra: Default::default(),
            },
        );
    }
    let (salt, keep_auth_file) = match read_salt(root, AUTH_FILE_NAME) {
        Ok(salt) => (salt, false),
        Err(e) => {
            tracing::warn!("could not read {AUTH_FILE_NAME}, leaving it in place: {e}");
            (None, true)
        }
    };
    Ok(Journal {
        plan: plan.clone(),
        users,
        salt,
        keep_auth_file,
    })
}

/// Moves the entries still in the root into the prepared destination, then
/// writes the new configuration.
fn run(root: &Path, journal: &Journal) -> Result<MigrationReport, String> {
    let dest = destination(root, &journal.plan)?;
    for entry in &journal.plan.moves {
        let name = entry_name(entry)?;
        let from = root.join(name);
        let to = dest.join(name);
        let both_exist = || {
            format!(
                "Both {} and {} exist. Move one of them out of the way, then finish the migration.",
                from.display(),
                to.display()
            )
        };
        let from_exists = std::fs::symlink_metadata(&from).is_ok();
        let to_exists = std::fs::symlink_metadata(&to).is_ok();
        match (from_exists, to_exists) {
            (true, false) => rename_no_replace(&from, &to).map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    return both_exist();
                }
                format!(
                    "Could not move \"{}\" to {}: {e}. The plan is kept in {JOURNAL_FILE}; fix the problem, then finish the migration.",
                    name.to_string_lossy(),
                    dest.display()
                )
            })?,
            (false, true) => {}
            (true, true) => return Err(both_exist()),
            (false, false) => {
                return Err(format!(
                    "{} is missing: it is neither in the folder nor in {}. Put it back, then finish the migration.",
                    from.display(),
                    dest.display()
                ))
            }
        }
    }
    // The renames must be on disk before `spaces.json` makes the next boot
    // multi-space.
    flush_dir(&dest)?;
    flush_dir(root)?;
    finish(root, journal)
}

/// Writes the multi-space configuration. `spaces.json` goes last, because
/// its existence is what makes the next boot multi-space.
fn finish(root: &Path, journal: &Journal) -> Result<MigrationReport, String> {
    let plan = &journal.plan;
    UsersConfig {
        users: journal.users.clone(),
    }
    .save(&root.join(USERS_FILE))?;
    if plan.search_model.is_some() || !plan.runtime_api || plan.runtime_idle_timeout.is_some() {
        let path = root.join("server.json");
        let mut server = ServerConfig::load(&path)?;
        if let Some(model) = &plan.search_model {
            server.search.model = Some(model.clone());
        }
        if !plan.runtime_api {
            server.runtime_api = false;
        }
        if let Some(minutes) = plan.runtime_idle_timeout {
            server.runtime_idle_timeout = minutes;
        }
        server.save(&path)?;
    }
    if let Some(salt) = &journal.salt {
        let seeded = read_salt(root, MULTI_AUTH_FILE_NAME).ok().flatten();
        if seeded.as_deref() != Some(salt.as_str()) {
            seed_salt(root, MULTI_AUTH_FILE_NAME, salt)
                .map_err(|e| format!("could not write {MULTI_AUTH_FILE_NAME}: {e}"))?;
        }
    }
    write_atomic(
        &root.join(REPORT_FILE),
        markdown(
            root,
            plan,
            journal.keep_auth_file,
            std::fs::symlink_metadata(root.join(CHROME_DATA_DIR)).is_ok(),
        )
        .as_bytes(),
        0o644,
    )?;
    MultiConfig {
        spaces: HashMap::from([(plan.space_id.clone(), plan.space.clone())]),
    }
    .save(&root.join("spaces.json"))?;

    // Every file above is fsynced; flush the root's entries too before
    // deleting the auth file and the journal, the only other copies of the
    // salt and the hashes.
    flush_dir(root)?;

    if !journal.keep_auth_file {
        match std::fs::remove_file(root.join(AUTH_FILE_NAME)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("could not remove {AUTH_FILE_NAME}: {e}"),
        }
    }
    // A journal that outlives this run would send the next boot back to the
    // migration, which would then overwrite whatever multi-space mode changed.
    match std::fs::remove_file(root.join(JOURNAL_FILE)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(format!(
                "The migration is complete, but {JOURNAL_FILE} could not be removed: {e}. Remove it, then restart the server."
            ))
        }
    }
    flush_dir(root)?;

    Ok(MigrationReport {
        moved: plan.moves.clone(),
        env_to_remove: plan.env_to_remove.clone(),
        prefix_note: needs_prefix_note(plan),
        space_prefix: display_prefix(plan).to_string(),
    })
}

fn journal_json(journal: &Journal) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(journal).map_err(|e| format!("could not encode the journal: {e}"))
}

/// Prefix of the temporary files `create_journal` links into place.
pub(super) const JOURNAL_TMP_PREFIX: &str = ".migration-journal.json.";

/// Writes the first journal, failing if one exists: of two concurrent runs,
/// only one gets past this. The journal is written whole to a temporary file
/// and hard-linked into place, so it never exists half-written. Where hard
/// links aren't supported it is created exclusively and written in place.
fn create_journal(root: &Path, journal: &Journal) -> Result<(), String> {
    let path = root.join(JOURNAL_FILE);
    let bytes = journal_json(journal)?;
    let tmp = root.join(format!("{JOURNAL_TMP_PREFIX}{}.tmp", uuid::Uuid::new_v4()));
    let write = |target: &Path, options: &mut std::fs::OpenOptions| {
        let mut file = options.open(target)?;
        file.write_all(&bytes)?;
        file.sync_all()
    };
    write(&tmp, private_options(0o600).create_new(true))
        .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    let linked = std::fs::hard_link(&tmp, &path);
    let _ = std::fs::remove_file(&tmp);
    match linked {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("A migration is already running.".into())
        }
        Err(e) => {
            tracing::warn!("could not hard-link the migration journal ({e}); writing it in place");
            write(&path, private_options(0o600).create_new(true)).map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => "A migration is already running.".to_string(),
                _ => format!("could not write {}: {e}", path.display()),
            })?;
        }
    }
    Ok(())
}

/// `rename`, failing with `AlreadyExists` instead of replacing `to`. Atomic
/// where the OS offers it; elsewhere, or on a filesystem that refuses the
/// flag, `to` is checked first.
fn rename_no_replace(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(result) = rename_exclusive(from, to) {
        return result;
    }
    if std::fs::symlink_metadata(to).is_ok() {
        return Err(std::io::ErrorKind::AlreadyExists.into());
    }
    std::fs::rename(from, to)
}

/// `None` when the platform or filesystem can't rename exclusively.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_exclusive(from: &Path, to: &Path) -> Option<std::io::Result<()>> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let from = CString::new(from.as_os_str().as_bytes()).ok()?;
    let to = CString::new(to.as_os_str().as_bytes()).ok()?;
    // SAFETY: both paths are NUL-terminated and outlive the call.
    #[cfg(target_os = "linux")]
    let rc = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    // SAFETY: as above.
    #[cfg(target_os = "macos")]
    let rc = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if rc == 0 {
        return Some(Ok(()));
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::EINVAL | libc::ENOSYS | libc::ENOTSUP) => None,
        _ => Some(Err(error)),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn rename_exclusive(_from: &Path, _to: &Path) -> Option<std::io::Result<()>> {
    None
}

fn private_options(_mode: u32) -> std::fs::OpenOptions {
    let mut options = std::fs::OpenOptions::new();
    options.write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(_mode);
    }
    options
}

/// Write `<path>.tmp`, then rename it over `path`.
fn write_atomic(path: &Path, bytes: &[u8], mode: u32) -> Result<(), String> {
    let tmp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    let mut file = private_options(mode)
        .create(true)
        .truncate(true)
        .open(&tmp)
        .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    if let Some(parent) = path.parent() {
        sync_dir(parent);
    }
    Ok(())
}

/// Flush a directory's entries (renames into and out of it) to disk. Where
/// directories can't be opened (Windows), there is nothing to flush.
fn flush_dir(dir: &Path) -> Result<(), String> {
    #[cfg(test)]
    if tests::FAILING_FLUSH.with(|failing| failing.borrow().as_deref() == Some(dir)) {
        return Err(format!("could not flush {}: injected", dir.display()));
    }
    std::fs::File::open(dir)
        .and_then(|dir| dir.sync_all())
        .or_else(|e| if cfg!(unix) { Err(e) } else { Ok(()) })
        .map_err(|e| format!("could not flush {}: {e}", dir.display()))
}

/// Like [`flush_dir`], for flushes a failure of which only needs a warning.
fn sync_dir(_dir: &Path) {
    #[cfg(unix)]
    if let Err(e) = std::fs::File::open(_dir).and_then(|dir| dir.sync_all()) {
        tracing::warn!("could not flush {}: {e}", _dir.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Authenticator;
    use crate::multi::migrate::plan::tests::legacy_env;
    use crate::multi::migrate::{compute_plan, default_edits, AdminChoice, LegacyEnv};
    use crate::multi::users::UserStore;

    thread_local! {
        pub(super) static FAILING_FLUSH: std::cell::RefCell<Option<PathBuf>> =
            const { std::cell::RefCell::new(None) };
    }

    /// Makes `flush_dir` fail for `dir` on this thread.
    fn fail_flush(dir: Option<&Path>) {
        FAILING_FLUSH.with(|failing| *failing.borrow_mut() = dir.map(Path::to_path_buf));
    }

    const ENTRIES: [&str; 4] = [".git", "Journal", "index.md", "notes.md"];

    /// A single-space folder holding `ENTRIES`, and its environment.
    fn install(vars: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf, LegacyEnv) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::create_dir(root.join("Journal")).unwrap();
        std::fs::write(root.join("Journal/today.md"), "today").unwrap();
        std::fs::write(root.join("index.md"), "# Hello").unwrap();
        std::fs::write(root.join("notes.md"), "notes").unwrap();
        let env = legacy_env(root.to_str().unwrap(), vars);
        (dir, root, env)
    }

    fn secrets(env: &LegacyEnv) -> MigrationSecrets {
        MigrationSecrets {
            password: env.user.as_ref().map(|(_, password)| password.clone()),
            auth_token: env.auth_token.clone(),
        }
    }

    fn plan_for(root: &Path, env: &LegacyEnv) -> MigrationPlan {
        compute_plan(root, env, &default_edits(env)).unwrap()
    }

    const FULL_ENV: [(&str, &str); 3] = [
        ("SB_NAME", "Notes"),
        ("SB_USER", "pat:se:cret"),
        ("SB_AUTH_TOKEN", "legacy-token-123"),
    ];

    /// What `execute` (or `resume`) leaves behind for a `FULL_ENV` install.
    fn assert_migrated(root: &Path, plan: &MigrationPlan, report: &MigrationReport) {
        for name in ENTRIES {
            assert!(!root.join(name).exists(), "{name} still in the root");
            assert!(
                root.join("spaces/notes").join(name).exists(),
                "{name} not moved"
            );
        }
        assert_eq!(
            std::fs::read_to_string(root.join("spaces/notes/Journal/today.md")).unwrap(),
            "today"
        );
        let spaces = MultiConfig::load(&root.join("spaces.json")).unwrap();
        assert_eq!(
            spaces.spaces,
            HashMap::from([(plan.space_id.clone(), plan.space.clone())])
        );
        let users = UserStore::open(root).unwrap().unwrap();
        assert!(users.is_admin("pat"));
        assert!(users.verify_password("pat", "se:cret"));
        assert_eq!(
            users.resolve_token("legacy-token-123").as_deref(),
            Some("pat")
        );
        assert!(!root.join(JOURNAL_FILE).exists());
        assert_eq!(pending_journal(root), Ok(None));
        let users = UsersConfig::load(&root.join(USERS_FILE)).unwrap().unwrap();
        let tokens: Vec<&String> = users.users["pat"].tokens.keys().collect();
        assert_eq!(tokens, vec!["migrated"]);

        let md = std::fs::read_to_string(root.join(REPORT_FILE)).unwrap();
        assert!(md.contains("`index.md` → `spaces/notes/index.md`"), "{md}");
        for var in ["SB_AUTH_TOKEN", "SB_NAME", "SB_USER"] {
            assert!(md.contains(&format!("- `{var}`")), "{var} in {md}");
        }
        assert_eq!(report.moved, plan.moves);
        assert_eq!(
            report.env_to_remove,
            vec!["SB_AUTH_TOKEN", "SB_NAME", "SB_USER"]
        );
        assert!(!report.prefix_note);

        for entry in std::fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                assert!(
                    !content.contains("se:cret"),
                    "password in {}",
                    path.display()
                );
                assert!(
                    !content.contains("legacy-token-123"),
                    "token in {}",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn execute_moves_and_writes_config() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        let report = execute(&root, &plan, &secrets(&env)).unwrap();
        assert_migrated(&root, &plan, &report);
    }

    #[test]
    fn salt_carries_over() {
        let (_dir, root, env) = install(&FULL_ENV);
        let old = Authenticator::load_or_init_with_stamp(&root, "single-space").unwrap();
        let salt = old.salt().to_string();
        assert!(!salt.is_empty());
        let plan = plan_for(&root, &env);
        execute(&root, &plan, &secrets(&env)).unwrap();

        let auth = Authenticator::load_or_init_with_stamp_named(
            &root,
            "account-managed-session-v1",
            MULTI_AUTH_FILE_NAME,
        )
        .unwrap();
        assert_eq!(auth.salt(), salt);
        assert!(!root.join(AUTH_FILE_NAME).exists());
        assert!(!root.join("spaces/notes").join(AUTH_FILE_NAME).exists());
    }

    #[test]
    fn no_accounts_writes_empty_users() {
        let (_dir, root, env) = install(&[("SB_AUTH_TOKEN", "legacy-token-123")]);
        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::NoAccounts;
        let plan = compute_plan(&root, &env, &edits).unwrap();
        execute(&root, &plan, &secrets(&env)).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(USERS_FILE)).unwrap(),
            "{}"
        );
        let users = UserStore::open(&root).unwrap().unwrap();
        assert!(users.is_empty());
        assert!(users.resolve_token("legacy-token-123").is_none());
    }

    #[test]
    fn search_model_carries_over() {
        let (_dir, root, env) = install(&[("SB_USER", "pat:x"), ("SB_SEARCH_MODEL", "some-model")]);
        let plan = plan_for(&root, &env);
        execute(&root, &plan, &secrets(&env)).unwrap();
        let server = ServerConfig::load(&root.join("server.json")).unwrap();
        assert_eq!(server.search.model.as_deref(), Some("some-model"));
    }

    #[test]
    fn runtime_settings_carry_over() {
        let (_dir, root, env) = install(&[
            ("SB_USER", "pat:x"),
            ("SB_RUNTIME_API", "0"),
            ("SB_RUNTIME_IDLE_TIMEOUT", "5"),
        ]);
        let plan = plan_for(&root, &env);
        let report = execute(&root, &plan, &secrets(&env)).unwrap();
        let server = ServerConfig::load(&root.join("server.json")).unwrap();
        assert!(!server.runtime_api);
        assert_eq!(server.runtime_idle_timeout, 5);
        assert_eq!(server.search.model, None);
        assert!(report.env_to_remove.contains(&"SB_RUNTIME_API".to_string()));
        let md = std::fs::read_to_string(root.join(REPORT_FILE)).unwrap();
        assert!(md.contains("- Runtime API: off (in `server.json`)"), "{md}");
        assert!(
            md.contains("- Runtime idle timeout: 5 minutes (in `server.json`)"),
            "{md}"
        );
    }

    /// The runtime settings live in the journal's plan, so finishing an
    /// interrupted migration writes them without the environment.
    #[test]
    fn resume_keeps_runtime_settings() {
        let (_dir, root, env) = install(&[("SB_USER", "pat:x"), ("SB_RUNTIME_API", "false")]);
        let plan = plan_for(&root, &env);
        let journal = prepare_journal(&root, &plan, &secrets(&env)).unwrap();
        create_journal(&root, &journal).unwrap();
        resume(&root).unwrap();
        let server = ServerConfig::load(&root.join("server.json")).unwrap();
        assert!(!server.runtime_api);
    }

    #[test]
    fn default_runtime_settings_write_no_server_json() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        execute(&root, &plan, &secrets(&env)).unwrap();
        assert!(!root.join("server.json").exists());
    }

    #[test]
    fn prefix_install_gets_the_proxy_note() {
        let (_dir, root, env) = install(&[("SB_USER", "pat:x"), ("SB_URL_PREFIX", "/wiki")]);
        let plan = plan_for(&root, &env);
        let report = execute(&root, &plan, &secrets(&env)).unwrap();
        assert!(report.prefix_note);
        let md = std::fs::read_to_string(root.join(REPORT_FILE)).unwrap();
        assert!(
            md.contains("forwards only `/wiki`")
                && md.contains("`/.dashboard`, `/.instance` and `/.setup`"),
            "{md}"
        );
    }

    /// The journal never records progress: what's left is read off the disk.
    #[test]
    fn resume_finishes_partial_run() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        let journal = prepare_journal(&root, &plan, &secrets(&env)).unwrap();
        create_journal(&root, &journal).unwrap();
        std::fs::create_dir_all(root.join("spaces/notes")).unwrap();
        std::fs::rename(&plan.moves[0].from, &plan.moves[0].to).unwrap();
        std::fs::rename(&plan.moves[1].from, &plan.moves[1].to).unwrap();

        assert_eq!(pending_journal(&root), Ok(Some(journal)));
        let report = resume(&root).unwrap();
        assert_migrated(&root, &plan, &report);
    }

    #[test]
    fn resume_never_overwrites_an_entry_present_on_both_sides() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        create_journal(
            &root,
            &prepare_journal(&root, &plan, &secrets(&env)).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("spaces/notes")).unwrap();
        std::fs::write(root.join("spaces/notes/index.md"), "other").unwrap();

        let error = resume(&root).unwrap_err();
        assert!(error.contains("index.md"), "{error}");
        assert_eq!(
            std::fs::read_to_string(root.join("index.md")).unwrap(),
            "# Hello"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("spaces/notes/index.md")).unwrap(),
            "other"
        );
        assert!(!root.join("spaces.json").exists());
        assert!(root.join(JOURNAL_FILE).exists());
    }

    #[test]
    fn resume_refuses_an_entry_missing_on_both_sides() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        create_journal(
            &root,
            &prepare_journal(&root, &plan, &secrets(&env)).unwrap(),
        )
        .unwrap();
        std::fs::remove_file(root.join("notes.md")).unwrap();

        let error = resume(&root).unwrap_err();
        assert!(error.contains("notes.md"), "{error}");
        assert!(!root.join("spaces.json").exists());
        assert!(root.join(JOURNAL_FILE).exists());
    }

    /// A journal left behind would make the next boot redo the migration
    /// over a server that has been running multi-space since.
    #[test]
    fn a_journal_that_cannot_be_removed_fails_the_run() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        let journal = prepare_journal(&root, &plan, &secrets(&env)).unwrap();
        create_journal(&root, &journal).unwrap();
        std::fs::remove_file(root.join(JOURNAL_FILE)).unwrap();
        std::fs::create_dir_all(root.join(JOURNAL_FILE).join("stuck")).unwrap();

        prepare_destination(&root, &root.join("spaces/notes")).unwrap();
        let error = run(&root, &journal).unwrap_err();
        assert!(error.contains("could not be removed"), "{error}");
        assert!(root.join("spaces.json").exists());
    }

    /// The space folder's own link must be on disk before anything moves
    /// into it.
    #[cfg(unix)]
    #[test]
    fn an_unflushable_destination_fails_before_any_move() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        create_journal(
            &root,
            &prepare_journal(&root, &plan, &secrets(&env)).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("spaces/notes")).unwrap();
        let spaces = root.join("spaces");
        std::fs::set_permissions(&spaces, std::fs::Permissions::from_mode(0o300)).unwrap();
        if std::fs::read_dir(&spaces).is_ok() {
            // Running as root: permissions don't stop reads.
            std::fs::set_permissions(&spaces, std::fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }
        let result = resume(&root);
        std::fs::set_permissions(&spaces, std::fs::Permissions::from_mode(0o755)).unwrap();

        let error = result.unwrap_err();
        assert!(error.contains("spaces"), "{error}");
        for name in ENTRIES {
            assert!(root.join(name).exists(), "{name} moved");
        }
    }

    /// Nothing has moved when a fresh run can't flush, so it backs out
    /// entirely instead of leaving an "interrupted" migration that can only
    /// fail again.
    #[test]
    fn a_fresh_run_that_cannot_flush_backs_out() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        for failing in [root.join("spaces"), root.join("spaces/notes"), root.clone()] {
            fail_flush(Some(&failing));
            let error = execute(&root, &plan, &secrets(&env)).unwrap_err();
            fail_flush(None);
            assert!(error.contains("Nothing was moved"), "{error}");
            assert!(error.contains(&failing.display().to_string()), "{error}");
            assert!(!root.join(JOURNAL_FILE).exists(), "{error}");
            assert!(!root.join("spaces").exists(), "{error}");
            for name in ENTRIES {
                assert!(root.join(name).exists(), "{name} moved");
            }
        }
        let report = execute(&root, &plan, &secrets(&env)).unwrap();
        assert_migrated(&root, &plan, &report);
    }

    #[test]
    fn rename_never_replaces_the_destination() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a"), dir.path().join("b"));
        std::fs::write(&from, "a").unwrap();
        std::fs::write(&to, "b").unwrap();
        let error = rename_no_replace(&from, &to).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&from).unwrap(), "a");
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "b");

        std::fs::remove_file(&to).unwrap();
        rename_no_replace(&from, &to).unwrap();
        assert!(!from.exists());
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "a");
    }

    #[cfg(unix)]
    #[test]
    fn failed_move_keeps_journal() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, root, env) = install(&FULL_ENV);
        // `Journal` sorts second; moving a directory to a new parent needs
        // write access to it.
        let stuck = root.join("Journal");
        std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::write(stuck.join("probe"), "").is_ok() {
            // Running as root: permissions don't stop the move.
            return;
        }
        let plan = plan_for(&root, &env);
        let error = execute(&root, &plan, &secrets(&env)).unwrap_err();
        std::fs::set_permissions(&stuck, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(error.contains("\"Journal\""), "{error}");
        let journal = pending_journal(&root).unwrap().expect("journal kept");
        assert_eq!(journal.plan, plan);
        assert!(root.join("spaces/notes/.git").exists());
        assert!(root.join("Journal/today.md").exists());
        assert!(root.join("index.md").exists());
        assert!(!root.join("spaces.json").exists());

        let report = resume(&root).unwrap();
        assert_migrated(&root, &plan, &report);
    }

    #[test]
    fn damaged_journal_is_reported_not_hidden() {
        let (_dir, root, _env) = install(&FULL_ENV);
        std::fs::write(root.join(JOURNAL_FILE), "{\"plan\": ").unwrap();
        let error = pending_journal(&root).unwrap_err();
        assert!(error.contains(JOURNAL_FILE), "{error}");
        assert!(resume(&root).is_err());
        assert!(root.join("index.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_journal_is_reported_not_hidden() {
        use std::os::unix::fs::PermissionsExt;
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        let journal = prepare_journal(&root, &plan, &secrets(&env)).unwrap();
        create_journal(&root, &journal).unwrap();
        let path = root.join(JOURNAL_FILE);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read(&path).is_ok() {
            // Running as root: permissions don't stop reads.
            return;
        }
        let result = pending_journal(&root);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(result.unwrap_err().contains("could not read"));
    }

    /// The old runtime's browser profile belongs to the server, not the space.
    #[test]
    fn chrome_profile_stays_in_the_root() {
        let (_dir, root, env) = install(&FULL_ENV);
        std::fs::create_dir_all(root.join(".chrome-data/Default")).unwrap();
        let plan = plan_for(&root, &env);
        assert!(plan.moves.iter().all(|m| !m.from.ends_with(".chrome-data")));
        execute(&root, &plan, &secrets(&env)).unwrap();
        assert!(root.join(".chrome-data/Default").is_dir());
        assert!(!root.join("spaces/notes/.chrome-data").exists());
        let md = std::fs::read_to_string(root.join(REPORT_FILE)).unwrap();
        assert!(md.contains("`.chrome-data`"), "{md}");
    }

    #[test]
    fn unparseable_auth_file_is_kept() {
        let (_dir, root, env) = install(&FULL_ENV);
        std::fs::write(root.join(AUTH_FILE_NAME), "not json").unwrap();
        let plan = plan_for(&root, &env);
        execute(&root, &plan, &secrets(&env)).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(AUTH_FILE_NAME)).unwrap(),
            "not json"
        );
        assert!(!root.join(MULTI_AUTH_FILE_NAME).exists());
        let md = std::fs::read_to_string(root.join(REPORT_FILE)).unwrap();
        assert!(md.contains(&format!("`{AUTH_FILE_NAME}`")), "{md}");
    }

    /// `cargo test -p silverbullet-server --lib -- --ignored --nocapture times_a_large_flat_folder`
    #[test]
    #[ignore = "timing, run by hand"]
    fn times_a_large_flat_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        std::fs::create_dir(&root).unwrap();
        for i in 0..5000 {
            std::fs::write(root.join(format!("f{i:05}.md")), "x").unwrap();
        }
        let env = legacy_env(root.to_str().unwrap(), &[]);
        let mut edits = default_edits(&env);
        edits.admin = AdminChoice::NoAccounts;
        let plan = compute_plan(&root, &env, &edits).unwrap();
        let start = std::time::Instant::now();
        execute(&root, &plan, &secrets(&env)).unwrap();
        eprintln!("5000 top-level entries: {:?}", start.elapsed());
        assert_eq!(
            std::fs::read_dir(root.join("spaces/notes"))
                .unwrap()
                .count(),
            5000
        );
    }

    #[test]
    fn execute_refuses_blockers_and_stale_plans() {
        let (_dir, root, env) = install(&FULL_ENV);
        let plan = plan_for(&root, &env);
        std::fs::write(root.join("spaces.json"), "{}").unwrap();
        assert!(execute(&root, &plan, &secrets(&env)).is_err());
        std::fs::remove_file(root.join("spaces.json")).unwrap();

        std::fs::write(root.join("new.md"), "written after planning").unwrap();
        let error = execute(&root, &plan, &secrets(&env)).unwrap_err();
        assert!(error.contains("changed"), "{error}");
        std::fs::remove_file(root.join("new.md")).unwrap();

        for name in ENTRIES {
            assert!(root.join(name).exists(), "{name} moved");
        }
        assert!(!root.join("spaces").exists());
        assert!(!root.join(JOURNAL_FILE).exists());

        execute(&root, &plan, &secrets(&env)).unwrap();
        let error = execute(&root, &plan, &secrets(&env)).unwrap_err();
        assert!(!error.is_empty());
    }
}
