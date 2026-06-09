fn main() {
    // Bake a build timestamp (unix millis) into the binary. Used by
    // `ReadOnlyDirSpacePrimitives` as the constant lastModified reported
    // for every base_fs / client_bundle file. Avoids relying on the bundle
    // dir's filesystem mtime, which is 0 inside an OSTree-backed Flatpak mount.
    let build_ts_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(1);
    println!("cargo:rustc-env=SB_BUILD_TIMESTAMP_MILLIS={build_ts_ms}");
}
