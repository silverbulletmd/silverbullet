//! Private files: index and model directories are 0700 and their files 0600
//! on Unix. One sync version, and async wrappers that run it on the
//! blocking pool.

use std::fs;
use std::io;
use std::path::Path;

/// Creates `dir` and its missing parents, and makes `dir` 0700.
pub(crate) fn create_dir(dir: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Opens `path` for writing: created (0600) and truncated with `truncate`,
/// else appended to (it must exist).
pub(crate) fn open(path: &Path, truncate: bool) -> io::Result<fs::File> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true);
    if truncate {
        opts.create(true).truncate(true);
    } else {
        opts.append(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

/// [`create_dir`] on the blocking pool.
pub(crate) async fn create_dir_async(dir: &Path) -> io::Result<()> {
    let dir = dir.to_path_buf();
    tokio::task::spawn_blocking(move || create_dir(&dir)).await?
}

/// [`open`] on the blocking pool.
pub(crate) async fn open_async(path: &Path, truncate: bool) -> io::Result<tokio::fs::File> {
    let path = path.to_path_buf();
    let file = tokio::task::spawn_blocking(move || open(&path, truncate)).await??;
    Ok(tokio::fs::File::from_std(file))
}
