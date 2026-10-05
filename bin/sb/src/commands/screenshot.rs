//! `sb screenshot` — save a PNG of the runtime client's viewport or one element.

use crate::conn::SpaceConnection;
use crate::output::OutputMode;

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

pub fn png_dimensions(png: &[u8]) -> Option<(u32, u32)> {
    if png.len() < 24 || !png.starts_with(PNG_SIGNATURE) || &png[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes(png[16..20].try_into().ok()?),
        u32::from_be_bytes(png[20..24].try_into().ok()?),
    ))
}

pub fn write_result(
    png: &[u8],
    file: &str,
    mode: OutputMode,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let (width, height) =
        png_dimensions(png).ok_or_else(|| "server returned an invalid PNG".to_string())?;
    if file == "-" {
        return out.write_all(png).map_err(|e| e.to_string());
    }
    std::fs::write(file, png).map_err(|e| format!("writing {file}: {e}"))?;
    let line = match mode {
        OutputMode::Json | OutputMode::Jsonl => {
            serde_json::json!({"path": file, "width": width, "height": height}).to_string()
        }
        _ => file.to_string(),
    };
    writeln!(out, "{line}").map_err(|e| e.to_string())
}

pub fn run(
    conn: &SpaceConnection,
    file: &str,
    selector: Option<&str>,
    mode: OutputMode,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let png = conn.screenshot(selector)?;
    write_result(&png, file, mode, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
        bytes
    }

    #[test]
    fn reads_png_dimensions() {
        assert_eq!(png_dimensions(&png(800, 600)), Some((800, 600)));
        assert_eq!(png_dimensions(b"not a png"), None);
    }

    #[test]
    fn writes_file_and_prints_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.png");
        let path = path.to_str().unwrap();
        let mut out = Vec::new();
        write_result(&png(2, 3), path, OutputMode::Text, &mut out).unwrap();
        assert_eq!(std::fs::read(path).unwrap(), png(2, 3));
        assert_eq!(String::from_utf8(out).unwrap(), format!("{path}\n"));
    }

    #[test]
    fn json_mode_prints_path_and_dimensions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.png");
        let path = path.to_str().unwrap();
        let mut out = Vec::new();
        write_result(&png(2, 3), path, OutputMode::Json, &mut out).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"path": path, "width": 2, "height": 3})
        );
    }

    #[test]
    fn dash_writes_only_png_bytes() {
        let mut out = Vec::new();
        write_result(&png(2, 3), "-", OutputMode::Json, &mut out).unwrap();
        assert_eq!(out, png(2, 3));
    }

    #[test]
    fn rejects_non_png() {
        let mut out = Vec::new();
        assert!(write_result(b"<html>", "-", OutputMode::Text, &mut out).is_err());
        assert!(out.is_empty());
    }
}
