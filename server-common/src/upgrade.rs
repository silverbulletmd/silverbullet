//! Shared self-upgrade engine for the `sb` CLI and the `silverbullet` server
//! binary.
//!
//! Both binaries upgrade themselves the same way: download a platform-specific
//! release zip from GitHub and replace their own executable in place. The only
//! differences are the release-asset base name, the executable file name inside
//! the zip, and a couple of log strings — all captured by [`UpgradeSpec`]. This
//! mirrors the two near-identical Go implementations (`cli/upgrade.go` for `sb`
//! and `server/cmd/upgrade.go` for `silverbullet`) but keeps a single copy.
//!
//! Intentionally free of async: we use `reqwest::blocking`, so callers MUST NOT
//! invoke [`upgrade`] from within a Tokio runtime (the `silverbullet` binary
//! handles its `upgrade` subcommand before building its runtime).

use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

/// Release URL prefix for the latest **stable** release.
pub const STABLE_URL_PREFIX: &str =
    "https://github.com/silverbulletmd/silverbullet/releases/latest/download";
/// Release URL prefix for the latest **edge** release (tracks `main`).
pub const EDGE_URL_PREFIX: &str =
    "https://github.com/silverbulletmd/silverbullet/releases/download/edge";

/// Per-binary upgrade parameters.
pub struct UpgradeSpec {
    /// Release-asset base name. The downloaded zip is
    /// `<asset>-<os>-<arch>.zip` (e.g. `"sb"` → `sb-darwin-aarch64.zip`,
    /// `"silverbullet-server"` → `silverbullet-server-linux-x86_64.zip`).
    pub asset: &'static str,
    /// Executable file name inside the zip to mark executable afterwards
    /// (e.g. `"sb"` or `"silverbullet"`). `.exe` is appended on Windows.
    pub binary: &'static str,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Download and install `spec.binary` from a release zip at `url_prefix`,
/// replacing the currently running executable in place.
pub fn upgrade(spec: &UpgradeSpec, url_prefix: &str) -> Result<(), String> {
    let exec =
        std::env::current_exe().map_err(|e| format!("failed to get executable path: {e}"))?;
    let install_dir = exec
        .parent()
        .ok_or("could not determine install dir")?
        .to_path_buf();

    println!("Install dir: {}", install_dir.display());

    // A self-cleaning temp dir for the download (auto-removed on drop, even if
    // an error short-circuits the function).
    let tmp = tempfile::Builder::new()
        .prefix(&format!("{}-upgrade-", spec.asset))
        .tempdir()
        .map_err(|e| format!("failed to create temp dir: {e}"))?;

    do_upgrade(spec, url_prefix, &install_dir, tmp.path())
}

fn do_upgrade(
    spec: &UpgradeSpec,
    url_prefix: &str,
    install_dir: &Path,
    tmp: &Path,
) -> Result<(), String> {
    let url = asset_url(
        spec.asset,
        url_prefix,
        std::env::consts::OS,
        std::env::consts::ARCH,
    )?;
    let zip_path = tmp.join(format!("{}.zip", spec.asset));

    println!("Downloading from {url}");

    let resp = reqwest::blocking::get(&url).map_err(|e| format!("failed to download: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("download failed with status: {}", status.as_u16()));
    }
    let bytes = resp
        .bytes()
        .map_err(|e| format!("failed to read response: {e}"))?;
    std::fs::write(&zip_path, &bytes).map_err(|e| format!("failed to save zip file: {e}"))?;

    println!("Replacing {} binary in {}", spec.binary, install_dir.display());

    extract_zip(&zip_path, install_dir)?;

    let bin = if cfg!(windows) {
        format!("{}.exe", spec.binary)
    } else {
        spec.binary.to_string()
    };
    let bin_path = install_dir.join(&bin);

    #[cfg(unix)]
    {
        std::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("failed to set executable permissions: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        let _ = &bin_path; // silence unused-variable warning on non-unix
    }

    println!("Upgrade complete!");
    Ok(())
}

// ---------------------------------------------------------------------------
// Zip extraction
// ---------------------------------------------------------------------------

/// Extract all entries from the zip at `src` into `dest`.
pub fn extract_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(src).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("failed to read zip: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry {i}: {e}"))?;
        let name = entry.name().to_string();
        let out_path = safe_extract_path(dest, &name)?;

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("failed to create directory {}: {e}", out_path.display()))?;
            continue;
        }

        // Ensure parent directory exists.
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create parent dir {}: {e}", parent.display()))?;
        }

        // Remove before write: avoids "text file busy" on Linux when replacing
        // a running executable.
        match std::fs::remove_file(&out_path) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => {
                return Err(format!(
                    "failed to remove existing file {}: {e}",
                    out_path.display()
                ));
            }
        }

        // Honour the unix mode stored in the zip if available, otherwise 0644.
        #[cfg(unix)]
        let out_file = {
            use std::os::unix::fs::OpenOptionsExt;
            let mode = entry.unix_mode().unwrap_or(0o644);
            std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(mode)
                .open(&out_path)
                .map_err(|e| format!("failed to create file {}: {e}", out_path.display()))?
        };
        #[cfg(not(unix))]
        let out_file = {
            std::fs::File::create(&out_path)
                .map_err(|e| format!("failed to create file {}: {e}", out_path.display()))?
        };

        let mut out_file = out_file;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("failed to write file {}: {e}", out_path.display()))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Pure helpers (tested independently)
// ---------------------------------------------------------------------------

/// Build the release-asset URL for this platform.
///
/// Maps Rust's `std::env::consts` names to the release-asset naming:
/// - `"macos"` → `"darwin"` (other OSes pass through).
/// - `"arm"` (32-bit ARM) → `"armv7"`.
/// - Otherwise only `"x86_64"` and `"aarch64"` are supported.
///
/// # Errors
/// Returns `Err` for unsupported architectures.
pub fn asset_url(asset: &str, url_prefix: &str, os: &str, arch: &str) -> Result<String, String> {
    let os = if os == "macos" { "darwin" } else { os };
    let arch = match arch {
        "x86_64" | "aarch64" => arch,
        // Rust reports 32-bit ARM as "arm"; our release archives use the
        // "armv7" label (e.g. sb-linux-armv7.zip).
        "arm" => "armv7",
        other => return Err(format!("unsupported architecture: {other}")),
    };
    Ok(format!("{url_prefix}/{asset}-{os}-{arch}.zip"))
}

/// Resolve a zip-entry `name` against `dest`, rejecting zip-slip paths.
///
/// Returns the safe path, or `Err` if the entry would escape outside `dest`.
/// The check is lexical (no filesystem access) so it works for entries that do
/// not yet exist.
pub fn safe_extract_path(dest: &Path, name: &str) -> Result<PathBuf, String> {
    let joined = dest.join(name);
    let cleaned = normalize_path(&joined);
    let cleaned_dest = normalize_path(dest);

    if cleaned == cleaned_dest || cleaned.starts_with(&cleaned_dest) {
        Ok(joined)
    } else {
        Err(format!("illegal file path in zip: {name}"))
    }
}

/// Lexically normalize a path by resolving `.` and `..` components without
/// touching the filesystem (entries may not exist yet).
fn normalize_path(p: &Path) -> PathBuf {
    let mut stack: Vec<std::ffi::OsString> = Vec::new();
    let mut prefix_buf = PathBuf::new();
    let mut has_root = false;

    for component in p.components() {
        match component {
            Component::Prefix(prefix) => {
                prefix_buf.push(prefix.as_os_str());
            }
            Component::RootDir => {
                has_root = true;
            }
            Component::CurDir => {
                // `.` — skip
            }
            Component::ParentDir => {
                // `..` — pop last normal component if any
                stack.pop();
            }
            Component::Normal(seg) => {
                stack.push(seg.to_os_string());
            }
        }
    }

    let mut result = prefix_buf;
    if has_root {
        result.push(std::path::MAIN_SEPARATOR.to_string());
    }
    for seg in stack {
        result.push(seg);
    }
    result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // asset_url
    // -----------------------------------------------------------------------

    #[test]
    fn asset_url_linux_x86_64() {
        let url = asset_url("sb", "PRE", "linux", "x86_64").unwrap();
        assert_eq!(url, "PRE/sb-linux-x86_64.zip");
    }

    #[test]
    fn asset_url_macos_maps_to_darwin() {
        let url = asset_url("sb", "PRE", "macos", "aarch64").unwrap();
        assert_eq!(url, "PRE/sb-darwin-aarch64.zip");
    }

    #[test]
    fn asset_url_windows_x86_64() {
        let url = asset_url("sb", "PRE", "windows", "x86_64").unwrap();
        assert_eq!(url, "PRE/sb-windows-x86_64.zip");
    }

    #[test]
    fn asset_url_arm_maps_to_armv7() {
        let url = asset_url("sb", "PRE", "linux", "arm").unwrap();
        assert_eq!(url, "PRE/sb-linux-armv7.zip");
    }

    #[test]
    fn asset_url_freebsd_x86_64() {
        let url = asset_url("sb", "PRE", "freebsd", "x86_64").unwrap();
        assert_eq!(url, "PRE/sb-freebsd-x86_64.zip");
    }

    #[test]
    fn asset_url_server_asset_name() {
        // The `silverbullet` server binary uses the "silverbullet-server" asset.
        let url = asset_url("silverbullet-server", "PRE", "darwin", "aarch64").unwrap();
        assert_eq!(url, "PRE/silverbullet-server-darwin-aarch64.zip");
    }

    #[test]
    fn asset_url_unsupported_arch() {
        let err = asset_url("sb", "PRE", "linux", "powerpc64").unwrap_err();
        assert!(err.contains("unsupported architecture"), "error was: {err}");
    }

    #[test]
    fn asset_url_darwin_passthrough() {
        // If someone explicitly passes "darwin" (not "macos") it still works.
        let url = asset_url("sb", "https://example.com", "darwin", "x86_64").unwrap();
        assert_eq!(url, "https://example.com/sb-darwin-x86_64.zip");
    }

    // -----------------------------------------------------------------------
    // safe_extract_path
    // -----------------------------------------------------------------------

    #[test]
    fn safe_extract_path_simple_file_is_ok() {
        let dest = std::path::Path::new("/tmp/x");
        let result = safe_extract_path(dest, "sb").unwrap();
        assert!(result.ends_with("sb"), "path should end with 'sb'");
    }

    #[test]
    fn safe_extract_path_dot_dot_is_rejected() {
        let dest = std::path::Path::new("/tmp/x");
        let err = safe_extract_path(dest, "../evil").unwrap_err();
        assert!(err.contains("illegal file path"), "error was: {err}");
    }

    #[test]
    fn safe_extract_path_nested_is_ok() {
        let dest = std::path::Path::new("/tmp/x");
        let result = safe_extract_path(dest, "a/b/sb").unwrap();
        assert!(result.ends_with("sb"), "path should end with 'sb'");
    }

    #[test]
    fn safe_extract_path_double_dot_escape_is_rejected() {
        let dest = std::path::Path::new("/tmp/x");
        let err = safe_extract_path(dest, "a/../../evil").unwrap_err();
        assert!(err.contains("illegal file path"), "error was: {err}");
    }

    // -----------------------------------------------------------------------
    // normalize_path (internal — tested via safe_extract_path)
    // -----------------------------------------------------------------------

    #[test]
    fn normalize_removes_dot_dot() {
        let p = PathBuf::from("/tmp/x/../y");
        assert_eq!(normalize_path(&p), PathBuf::from("/tmp/y"));
    }

    #[test]
    fn normalize_removes_dot() {
        let p = PathBuf::from("/tmp/./x");
        assert_eq!(normalize_path(&p), PathBuf::from("/tmp/x"));
    }
}
