//! Black-box tests for `silverbullet publish`: one folder served as a public,
//! read-only, accountless site that writes nothing to disk.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

mod common;
use common::{free_port, is_empty, snapshot, stop_server};

/// Kills and reaps the server on drop, so a failing assertion leaks nothing.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        stop_server(&mut self.0);
    }
}

impl Server {
    /// SIGTERM the server, wait for it to exit, and return its output.
    fn shut_down(mut self) -> (std::process::ExitStatus, String) {
        assert!(
            common::terminate(&mut self.0, Duration::from_secs(10)),
            "the server did not stop on SIGTERM"
        );
        let status = self.0.wait().unwrap();
        let mut out = String::new();
        if let Some(mut s) = self.0.stdout.take() {
            let _ = s.read_to_string(&mut out);
        }
        (status, out)
    }
}

/// `silverbullet publish <folder>` with every `SB_*` variable cleared, the
/// service worker off, and `env` on top. `cwd`, when given, is the working
/// directory.
fn publish_command(folder: &Path, env: &[(&str, &str)], cwd: Option<&Path>) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_silverbullet"));
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("SB_") {
            cmd.env_remove(key);
        }
    }
    cmd.arg("publish")
        .arg(folder)
        .env("SB_DISABLE_SERVICE_WORKER", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        cmd.env(k, v);
    }
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd
}

/// Publish `folder` on a free port and wait until it answers `/.ping`.
fn publish(folder: &Path, env: &[(&str, &str)]) -> (Server, String) {
    publish_with(&|| publish_command(folder, env, None))
}

fn publish_with(make: &dyn Fn() -> Command) -> (Server, String) {
    publish_at(make, "")
}

/// Spawn the command `make` builds on a free port and wait until
/// `<prefix>/.ping` answers. A port taken in the meantime (by another test's
/// outgoing connection, say) gets a retry on a fresh one.
fn publish_at(make: &dyn Fn() -> Command, prefix: &str) -> (Server, String) {
    for _ in 0..5 {
        let port = free_port();
        let mut cmd = make();
        cmd.args(["-L", "127.0.0.1", "-p", &port.to_string()]);
        let mut server = Server(cmd.spawn().expect("spawn silverbullet publish"));
        let base = format!("http://127.0.0.1:{port}");
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if client()
                .get(format!("{base}{prefix}/.ping"))
                .send()
                .is_ok_and(|r| r.status().is_success())
                && server.0.try_wait().is_ok_and(|status| status.is_none())
            {
                return (server, base);
            }
            if Instant::now() >= deadline || server.0.try_wait().ok().flatten().is_some() {
                stop_server(&mut server.0);
                let mut out = String::new();
                let mut err = String::new();
                if let Some(mut s) = server.0.stdout.take() {
                    let _ = s.read_to_string(&mut out);
                }
                if let Some(mut s) = server.0.stderr.take() {
                    let _ = s.read_to_string(&mut err);
                }
                if err.contains("Address already in use") {
                    break;
                }
                panic!(
                    "publish never answered /.ping\n--- stdout ---\n{out}\n--- stderr ---\n{err}"
                );
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    panic!("no free port after 5 attempts");
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

fn get(url: &str) -> (u16, String) {
    let r = client().get(url).send().unwrap();
    (r.status().as_u16(), r.text().unwrap())
}

/// A folder with an index page linking to one note.
fn content_folder() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("index.md"),
        "# Welcome home\n\nHello, see [[notes/one]].\n",
    )
    .unwrap();
    std::fs::create_dir(dir.path().join("notes")).unwrap();
    std::fs::write(
        dir.path().join("notes/one.md"),
        "# One\n\nThe zanzibarite page.\n",
    )
    .unwrap();
    dir
}

/// Page names whose content matches `query`, from an anonymous search.
fn search(base: &str, query: &str) -> Vec<String> {
    let r = client()
        .post(format!("{base}/.search/query"))
        .json(&serde_json::json!({ "query": query }))
        .send()
        .unwrap();
    assert_eq!(r.status().as_u16(), 200, "search {query}");
    let body: serde_json::Value = r.json().unwrap();
    body["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["page"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Poll until `query` finds `page`, or panic after 20 seconds.
fn wait_for_hit(base: &str, query: &str, page: &str) {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let hits = search(base, query);
        if hits.iter().any(|hit| hit == page) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "{query:?} never found {page}: {hits:?}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// What a visitor does: the index page, a note, the listing, the sign-in page,
/// the sitemap and a search once indexing is done.
fn browse(base: &str) {
    assert_eq!(get(&format!("{base}/")).0, 200);
    assert_eq!(get(&format!("{base}/notes/one")).0, 200);
    assert_eq!(get(&format!("{base}/.fs")).0, 200);
    assert_eq!(get(&format!("{base}/.fs/notes/one.md")).0, 200);
    assert_eq!(get(&format!("{base}/.auth")).0, 200);
    assert_eq!(get(&format!("{base}/sitemap.xml")).0, 200);
    wait_for_hit(base, "zanzibarite", "notes/one");
    // Room for background work (watcher, index commits) to show itself.
    std::thread::sleep(Duration::from_millis(500));
}

const REFUSAL: &str = "SB_USER is not supported by `silverbullet publish`: a published site is \
                       always public. Remove it, or run a normal server to require sign-in.";

#[test]
fn serves_pages_anonymously() {
    let content = content_folder();
    let (server, base) = publish(content.path(), &[]);
    let (status, body) = get(&format!("{base}/"));
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("<h1"), "no server-rendered heading: {body}");
    assert!(body.contains("Welcome home"), "{body}");
    let (status, body) = get(&format!("{base}/.fs/notes/one.md"));
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("zanzibarite"), "{body}");

    let (status, out) = server.shut_down();
    assert!(status.success(), "{status}\n{out}");
    let folder = std::fs::canonicalize(content.path()).unwrap();
    assert!(
        out.contains(&format!(
            "publishing {} at http://localhost:",
            folder.display()
        )) && out.contains("(read-only, public)"),
        "no publishing log line:\n{out}"
    );
}

/// Same-origin writes, so only the read-only policy can refuse them.
#[test]
fn refuses_writes() {
    let content = content_folder();
    let before = snapshot(content.path());
    std::thread::sleep(Duration::from_millis(50));
    let (_server, base) = publish(content.path(), &[]);
    for (method, path) in [
        (reqwest::Method::PUT, "x.md"),
        (reqwest::Method::POST, "x.md"),
        (reqwest::Method::DELETE, "index.md"),
    ] {
        let r = client()
            .request(method.clone(), format!("{base}/.fs/{path}"))
            .header("Origin", &base)
            .header("Sec-Fetch-Site", "same-origin")
            .body("# Sneaky")
            .send()
            .unwrap();
        assert_eq!(r.status().as_u16(), 401, "{method} {path}");
    }
    assert_eq!(before, snapshot(content.path()));
}

const PUBLISHED_NOTICE: &str =
    "This site is published read-only, so there is nothing to log in to.";

#[test]
fn auth_shows_no_accounts_notice() {
    let content = content_folder();
    let (_server, base) = publish(content.path(), &[]);
    for path in ["/.auth", "/.dashboard/", "/.dashboard/users"] {
        let (status, body) = get(&format!("{base}{path}"));
        assert_eq!(status, 200, "{path}: {body}");
        assert!(body.contains("No accounts"), "{path}: {body}");
        assert!(body.contains(PUBLISHED_NOTICE), "{path}: {body}");
        assert!(!body.contains("spaces.json"), "{path}: {body}");
        assert!(!body.contains("<form"), "{path}: {body}");
    }
}

/// The page a crawler gets under the prefix links with prefixed URLs.
#[test]
fn crawler_html_uses_the_prefix() {
    let content = content_folder();
    let (_server, base) = publish_at(
        &|| publish_command(content.path(), &[("SB_URL_PREFIX", "/docs/")], None),
        "/docs",
    );
    let (status, body) = get(&format!("{base}/docs/"));
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("Welcome home"), "{body}");
    assert!(body.contains("href=\"/docs/notes/one\""), "{body}");
    assert!(!body.contains("href=\"/notes/one\""), "{body}");
}

/// Anonymous visitors never see where the folder lives on the host, and what
/// clients derive from the reported path stays put across restarts.
#[test]
fn published_space_hides_the_host_path() {
    let content = content_folder();
    let folder = std::fs::canonicalize(content.path()).unwrap();
    let folder = folder.to_string_lossy().into_owned();
    let config = |base: &str| {
        let r = client().get(format!("{base}/.config")).send().unwrap();
        assert_eq!(r.status().as_u16(), 200);
        let text = r.text().unwrap();
        assert!(!text.contains(&folder), "{text}");
        serde_json::from_str::<serde_json::Value>(&text).unwrap()
    };

    let (server, base) = publish(content.path(), &[]);
    for path in ["/.ping", "/.fs"] {
        let r = client().get(format!("{base}{path}")).send().unwrap();
        assert_eq!(r.headers()["x-space-path"], "published", "{path}");
    }
    let first = config(&base);
    assert_eq!(first["spaceFolderPath"], "published");
    // No accounts, so the client offers no account UI.
    assert_eq!(first["accountManaged"], false);
    server.shut_down();

    let (_server, base) = publish(content.path(), &[]);
    let second = config(&base);
    assert_eq!(second["spaceFolderPath"], "published");
    assert_eq!(first["shareOwnerId"], second["shareOwnerId"]);
}

/// The folder belongs after `publish`; a top-level folder or `--single` with
/// it is a mistake, not something to drop silently.
#[test]
fn top_level_arguments_are_refused() {
    let content = content_folder();
    let other = tempfile::tempdir().unwrap();
    let cases: [(&[&std::ffi::OsStr], &str); 2] = [
        (
            &[
                other.path().as_os_str(),
                "publish".as_ref(),
                content.path().as_os_str(),
            ],
            "silverbullet publish <FOLDER>",
        ),
        (
            &[
                "--single".as_ref(),
                "publish".as_ref(),
                content.path().as_os_str(),
            ],
            "--single",
        ),
    ];
    for (args, expected) in cases {
        let output = Command::new(env!("CARGO_BIN_EXE_silverbullet"))
            .args(args)
            .env("SB_DISABLE_SERVICE_WORKER", "1")
            .output()
            .unwrap();
        assert!(!output.status.success(), "{args:?}");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(stderr.contains(expected), "{args:?}: {stderr}");
        assert!(is_empty(other.path()));
    }
}

/// A bind failure never claims the site is being published.
#[test]
fn publishing_is_logged_once_listening() {
    let content = content_folder();
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port().to_string();
    let output = publish_command(content.path(), &[], None)
        .args(["-L", "127.0.0.1", "-p", &port])
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!stdout.contains("publishing "), "{stdout}");
    assert!(!stdout.contains("multi-space mode"), "{stdout}");
}

#[test]
fn sitemap_lists_pages_under_prefix() {
    let content = content_folder();
    let (_server, base) = publish_at(
        &|| publish_command(content.path(), &[("SB_URL_PREFIX", "docs/")], None),
        "/docs",
    );
    let (status, body) = get(&format!("{base}/docs/sitemap.xml"));
    assert_eq!(status, 200, "{body}");
    let locs: Vec<&str> = body
        .split("<loc>")
        .skip(1)
        .filter_map(|rest| rest.split_once("</loc>").map(|(loc, _)| loc))
        .collect();
    assert!(!locs.is_empty(), "{body}");
    for loc in &locs {
        let path = loc
            .strip_prefix(&base)
            .unwrap_or_else(|| panic!("{loc} is not on {base}"));
        assert!(path.starts_with("/docs/"), "{loc}");
    }
    assert!(
        locs.iter().any(|loc| loc.ends_with("/docs/notes/one")),
        "{locs:?}"
    );
}

#[test]
fn sb_user_is_refused() {
    let content = content_folder();
    let output: Output = publish_command(content.path(), &[("SB_USER", "admin:secret")], None)
        .output()
        .unwrap();
    assert!(!output.status.success());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains(REFUSAL), "{stderr}");
}

#[test]
fn content_folder_untouched() {
    let content = content_folder();
    let cwd = tempfile::tempdir().unwrap();
    let before = snapshot(content.path());
    // Writes within the filesystem's mtime granularity would go unseen.
    std::thread::sleep(Duration::from_millis(50));

    let (server, base) = publish_with(&|| publish_command(content.path(), &[], Some(cwd.path())));
    browse(&base);
    assert_eq!(before, snapshot(content.path()), "changed while serving");
    let (status, out) = server.shut_down();
    assert!(status.success(), "{status}\n{out}");
    assert_eq!(before, snapshot(content.path()), "changed after shutdown");
    assert!(is_empty(cwd.path()), "the working directory got files");
}

#[cfg(unix)]
#[test]
fn read_only_folder_serves() {
    use std::os::unix::fs::PermissionsExt;

    let uid = Command::new("id").arg("-u").output().unwrap();
    if String::from_utf8_lossy(&uid.stdout).trim() == "0" {
        eprintln!("skipping read_only_folder_serves: root ignores permissions");
        return;
    }

    /// Make everything writable again so the temp dir can be removed.
    struct Restore(PathBuf);
    impl Drop for Restore {
        fn drop(&mut self) {
            for dir in [self.0.clone(), self.0.join("notes")] {
                let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
            }
        }
    }

    let content = content_folder();
    let _restore = Restore(content.path().to_path_buf());
    let set = |path: &Path, mode| {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap()
    };
    set(&content.path().join("index.md"), 0o444);
    set(&content.path().join("notes/one.md"), 0o444);
    set(&content.path().join("notes"), 0o555);
    set(content.path(), 0o555);

    let (_server, base) = publish(content.path(), &[]);
    let (status, body) = get(&format!("{base}/"));
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("Welcome home"), "{body}");
    let (status, body) = get(&format!("{base}/.fs/notes/one.md"));
    assert_eq!(status, 200, "{body}");
    wait_for_hit(&base, "zanzibarite", "notes/one");
}

/// A page added on disk reaches the watcher-fed listing and search index, and
/// an edited page's server-rendered HTML shows the new text.
#[test]
fn edit_is_picked_up() {
    let content = content_folder();
    let (_server, base) = publish(content.path(), &[]);
    // Prime the in-memory listing and index.
    assert!(!get(&format!("{base}/.fs")).1.contains("notes/two.md"));
    wait_for_hit(&base, "zanzibarite", "notes/one");

    std::fs::write(
        content.path().join("notes/two.md"),
        "# Two\n\nA wombatish page.\n",
    )
    .unwrap();
    std::fs::write(
        content.path().join("notes/one.md"),
        "# One\n\nRewritten on disk, now longer.\n",
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let (_, listing) = get(&format!("{base}/.fs"));
        let (_, page) = get(&format!("{base}/notes/one"));
        if listing.contains("\"notes/two.md\"") && page.contains("Rewritten on disk") {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "edit never showed:\n{listing}\n{page}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    wait_for_hit(&base, "wombatish", "notes/two");
}

#[test]
fn data_root_like_folder_is_plain_content() {
    let content = content_folder();
    let spaces = r#"{"main":{"name":"Main","binding":{"prefix":""}}}"#;
    let journal = r#"{"steps":[]}"#;
    std::fs::write(content.path().join("spaces.json"), spaces).unwrap();
    std::fs::write(content.path().join(".migration-journal.json"), journal).unwrap();
    let before = snapshot(content.path());
    std::thread::sleep(Duration::from_millis(50));

    let (_server, base) = publish(content.path(), &[]);
    let (status, body) = get(&format!("{base}/"));
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("Welcome home"), "{body}");
    assert!(!body.to_lowercase().contains("migrat"), "{body}");
    assert_eq!(
        get(&format!("{base}/.fs/spaces.json")),
        (200, spaces.into())
    );
    // A dot file, so hidden like in every space, and nothing more.
    assert_eq!(get(&format!("{base}/.fs/.migration-journal.json")).0, 404);
    assert_eq!(before, snapshot(content.path()));
}

#[test]
fn writes_nothing_anywhere() {
    let content = content_folder();
    let tmp = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let before = snapshot(content.path());
    std::thread::sleep(Duration::from_millis(50));

    // Nothing inherited: no XDG or cache dirs a write could hide in.
    let path = std::env::var_os("PATH").unwrap_or_default();
    let (server, base) = publish_with(&|| {
        let mut cmd = publish_command(content.path(), &[], Some(cwd.path()));
        cmd.env_clear()
            .env("PATH", &path)
            .env("TMPDIR", tmp.path())
            .env("HOME", home.path())
            .env("SB_DISABLE_SERVICE_WORKER", "1");
        cmd
    });
    browse(&base);
    let (status, out) = server.shut_down();
    assert!(status.success(), "{status}\n{out}");

    assert!(is_empty(tmp.path()), "TMPDIR got files");
    assert!(is_empty(cwd.path()), "the working directory got files");
    assert!(is_empty(home.path()), "HOME got files");
    assert_eq!(
        before,
        snapshot(content.path()),
        "the content folder changed"
    );
}

#[test]
fn two_processes_same_folder() {
    let content = content_folder();
    let (_first, a) = publish(content.path(), &[]);
    let (_second, b) = publish(content.path(), &[]);
    for base in [&a, &b] {
        let (status, body) = get(&format!("{base}/.fs/notes/one.md"));
        assert_eq!(status, 200, "{base}: {body}");
        wait_for_hit(base, "zanzibarite", "notes/one");
    }
}

#[test]
fn keyword_search_finds_pages() {
    let content = content_folder();
    let (_server, base) = publish(content.path(), &[]);
    wait_for_hit(&base, "zanzibarite", "notes/one");
    assert!(!search(&base, "zanzibarite").contains(&"index".to_string()));

    std::fs::write(
        content.path().join("notes/one.md"),
        "# One\n\nNow about quokkaberries instead.\n",
    )
    .unwrap();
    wait_for_hit(&base, "quokkaberries", "notes/one");
    let deadline = Instant::now() + Duration::from_secs(5);
    while search(&base, "zanzibarite").contains(&"notes/one".to_string()) {
        assert!(Instant::now() < deadline, "the old word still matches");
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(unix)]
#[test]
fn unix_socket() {
    use std::io::Write;
    use std::os::unix::net::UnixStream;

    let content = content_folder();
    let sock_dir = tempfile::tempdir().unwrap();
    let socket = sock_dir.path().join("sb.sock");
    let socket_env = socket.to_string_lossy().into_owned();
    let cmd = publish_command(content.path(), &[("SB_UNIX_SOCKET", &socket_env)], None)
        .spawn()
        .unwrap();
    let _server = Server(cmd);

    let deadline = Instant::now() + Duration::from_secs(20);
    let response = loop {
        if let Ok(mut stream) = UnixStream::connect(&socket) {
            stream
                .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .unwrap();
            let mut out = String::new();
            stream.read_to_string(&mut out).unwrap();
            break out;
        }
        assert!(Instant::now() < deadline, "server did not boot in time");
        std::thread::sleep(Duration::from_millis(100));
    };
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    assert!(response.contains("Welcome home"), "{response}");
}
