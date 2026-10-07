//! Full-page screenshots. CodeMirror only renders the lines and widgets near
//! the visible area, so a tall clip of an unscrolled page shows blank space.
//! Instead the editor scroller is scrolled one screen at a time, each screen
//! is captured, and the captures are cropped and stitched into one PNG.
//!
//! This module holds the pure parts — when to stop, where to scroll next,
//! which rows of each capture to keep, and the PNG stitching — so they are
//! testable without a browser. `ClientRuntime::screenshot_full_page` drives
//! the browser.

use super::backend::RuntimeError;

/// At most this many captures per full-page screenshot. With an 800x600
/// viewport (about 510 new pixels per screen) `MAX_HEIGHT` is reached first.
pub const MAX_SEGMENTS: usize = 30;
/// Stop once the stitched content reaches this height (CSS pixels).
pub const MAX_HEIGHT: f64 = 12000.0;
/// Each scroll step re-captures this much of the previous screen (CSS
/// pixels); the overlap is cropped away when stitching.
pub const OVERLAP: f64 = 40.0;

/// A stitched full-page screenshot. `truncated` is set when the page was
/// longer than the caps allow and the image stops before its end.
#[derive(Debug, Clone, PartialEq)]
pub struct FullPageShot {
    pub png: Vec<u8>,
    pub truncated: bool,
}

/// One capture: the scroller was at `scroll_top` and showed `view_height`
/// CSS pixels of content, below `header` CSS pixels of chrome above the
/// scroller (the top bar, only captured in the first segment).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SegmentMeta {
    pub scroll_top: f64,
    pub view_height: f64,
    pub header: f64,
}

/// Rows to keep from one capture, in CSS pixels relative to the capture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Crop {
    pub index: usize,
    pub src_y: f64,
    pub height: f64,
}

/// What to do after capturing a segment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Step {
    /// The capture reached the end of the content.
    Done,
    /// Scroll to this `scrollTop` and capture again.
    Scroll(f64),
    /// More content remains but a cap was hit.
    Truncated,
}

/// Decide the next step after capturing `last`. `prev_scroll_top` is the
/// scroll position of the capture before it (None for the first);
/// `segments` counts captures so far and `content_end` is where the content
/// ends in scroller coordinates.
pub fn next_step(
    last: SegmentMeta,
    prev_scroll_top: Option<f64>,
    content_end: f64,
    segments: usize,
) -> Step {
    let shown_end = last.scroll_top + last.view_height;
    if shown_end >= content_end {
        return Step::Done;
    }
    // The scroller could not move further (clamped at its maximum).
    if prev_scroll_top.is_some_and(|prev| last.scroll_top <= prev) {
        return Step::Done;
    }
    if segments >= MAX_SEGMENTS || shown_end >= MAX_HEIGHT {
        return Step::Truncated;
    }
    let step = (last.view_height - OVERLAP).max(1.0);
    Step::Scroll(last.scroll_top + step)
}

/// Which rows of each capture make up the stitched image: the first kept
/// capture includes its header (the top bar), later ones only the content not
/// already covered, and nothing past `content_end`.
pub fn crop_plan(segments: &[SegmentMeta], content_end: f64) -> Vec<Crop> {
    let mut crops = Vec::new();
    let mut covered: Option<f64> = None;
    for (index, seg) in segments.iter().enumerate() {
        let visible_end = (seg.scroll_top + seg.view_height).min(content_end);
        let start = covered.map_or(seg.scroll_top, |c| c.max(seg.scroll_top));
        if visible_end <= start {
            continue;
        }
        let mut src_y = seg.header + (start - seg.scroll_top);
        let mut height = visible_end - start;
        if covered.is_none() {
            height += src_y;
            src_y = 0.0;
        }
        crops.push(Crop {
            index,
            src_y,
            height,
        });
        covered = Some(visible_end);
    }
    crops
}

struct Decoded {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

fn decode_rgba(png_bytes: &[u8]) -> Result<Decoded, RuntimeError> {
    let err = |e: png::DecodingError| RuntimeError::Transport(format!("decoding capture: {e}"));
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(err)?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| RuntimeError::Transport("capture too large".into()))?;
    let mut buf = vec![0; size];
    let info = reader.next_frame(&mut buf).map_err(err)?;
    buf.truncate(info.buffer_size());
    let (width, height) = (info.width as usize, info.height as usize);
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buf
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        other => {
            return Err(RuntimeError::Transport(format!(
                "unsupported capture color type {other:?}"
            )))
        }
    };
    Ok(Decoded {
        width,
        height,
        rgba,
    })
}

/// Stitch captures into one PNG. `captures[i]` is the PNG of `segments[i]`;
/// each capture's device-pixel scale is its pixel height over its CSS height
/// (`header + view_height`), so high-DPI captures crop correctly.
pub fn stitch(
    captures: &[Vec<u8>],
    segments: &[SegmentMeta],
    crops: &[Crop],
) -> Result<Vec<u8>, RuntimeError> {
    let mut width = 0;
    let mut rows: Vec<u8> = Vec::new();
    let mut height = 0;
    for crop in crops {
        let image = decode_rgba(&captures[crop.index])?;
        let seg = segments[crop.index];
        let scale = image.height as f64 / (seg.header + seg.view_height);
        let top = ((crop.src_y * scale).round() as usize).min(image.height);
        let bottom = (((crop.src_y + crop.height) * scale).round() as usize).min(image.height);
        if width == 0 {
            width = image.width;
        }
        let copy = width.min(image.width) * 4;
        for y in top..bottom {
            let start = y * image.width * 4;
            rows.extend_from_slice(&image.rgba[start..start + copy]);
            rows.resize(rows.len() + width * 4 - copy, 0);
        }
        height += bottom - top;
    }
    if width == 0 || height == 0 {
        return Err(RuntimeError::Transport("nothing to capture".into()));
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let err = |e: png::EncodingError| RuntimeError::Transport(format!("encoding PNG: {e}"));
        let mut writer = encoder.write_header().map_err(err)?;
        writer.write_image_data(&rows).map_err(err)?;
        writer.finish().map_err(err)?;
    }
    Ok(out)
}

/// Pixel size of a PNG, for tests elsewhere in the crate.
#[cfg(test)]
pub(crate) fn tests_png_size(png_bytes: &[u8]) -> (usize, usize) {
    let d = decode_rgba(png_bytes).unwrap();
    (d.width, d.height)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(scroll_top: f64, view_height: f64, header: f64) -> SegmentMeta {
        SegmentMeta {
            scroll_top,
            view_height,
            header,
        }
    }

    #[test]
    fn short_page_is_done_after_one_capture() {
        assert_eq!(next_step(seg(0.0, 550.0, 50.0), None, 300.0, 1), Step::Done);
    }

    #[test]
    fn long_page_scrolls_one_screen_minus_overlap() {
        assert_eq!(
            next_step(seg(0.0, 550.0, 50.0), None, 2000.0, 1),
            Step::Scroll(550.0 - OVERLAP)
        );
        assert_eq!(
            next_step(seg(510.0, 550.0, 0.0), Some(0.0), 2000.0, 2),
            Step::Scroll(510.0 + 550.0 - OVERLAP)
        );
    }

    #[test]
    fn stops_when_the_scroller_cannot_move() {
        assert_eq!(
            next_step(seg(500.0, 550.0, 0.0), Some(500.0), 2000.0, 2),
            Step::Done
        );
    }

    #[test]
    fn truncates_at_the_segment_cap() {
        assert_eq!(
            next_step(seg(1000.0, 550.0, 0.0), Some(500.0), 99999.0, MAX_SEGMENTS),
            Step::Truncated
        );
    }

    #[test]
    fn truncates_at_the_height_cap() {
        assert_eq!(
            next_step(seg(MAX_HEIGHT - 100.0, 550.0, 0.0), Some(0.0), 99999.0, 3),
            Step::Truncated
        );
    }

    #[test]
    fn crop_plan_keeps_header_once_and_drops_overlap() {
        let segs = [
            seg(0.0, 500.0, 60.0),
            seg(460.0, 500.0, 0.0),
            seg(920.0, 500.0, 0.0),
        ];
        let crops = crop_plan(&segs, 1200.0);
        assert_eq!(
            crops,
            vec![
                Crop {
                    index: 0,
                    src_y: 0.0,
                    height: 560.0
                },
                Crop {
                    index: 1,
                    src_y: 40.0,
                    height: 460.0
                },
                Crop {
                    index: 2,
                    src_y: 40.0,
                    height: 240.0
                },
            ]
        );
        let total: f64 = crops.iter().map(|c| c.height).sum();
        assert_eq!(total, 60.0 + 1200.0);
    }

    #[test]
    fn crop_plan_handles_a_clamped_last_scroll() {
        // The last scroll was clamped to the maximum, so it overlaps more.
        let segs = [seg(0.0, 500.0, 50.0), seg(300.0, 500.0, 0.0)];
        let crops = crop_plan(&segs, 800.0);
        assert_eq!(
            crops,
            vec![
                Crop {
                    index: 0,
                    src_y: 0.0,
                    height: 550.0
                },
                Crop {
                    index: 1,
                    src_y: 200.0,
                    height: 300.0
                },
            ]
        );
    }

    #[test]
    fn crop_plan_skips_captures_already_covered() {
        let segs = [seg(0.0, 500.0, 50.0), seg(100.0, 300.0, 0.0)];
        let crops = crop_plan(&segs, 1000.0);
        assert_eq!(
            crops,
            vec![Crop {
                index: 0,
                src_y: 0.0,
                height: 550.0
            }]
        );
    }

    /// A solid-colour PNG whose row `y` has red channel = `first_row + y`.
    fn striped_png(width: u32, height: u32, first_row: u8, color: png::ColorType) -> Vec<u8> {
        let channels = match color {
            png::ColorType::Rgb => 3,
            _ => 4,
        };
        let mut data = Vec::new();
        for y in 0..height {
            for _ in 0..width {
                data.push(first_row.wrapping_add(y as u8));
                data.extend(std::iter::repeat_n(7, channels - 1));
            }
        }
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(color);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&data).unwrap();
        writer.finish().unwrap();
        out
    }

    fn red_column(png_bytes: &[u8]) -> (usize, usize, Vec<u8>) {
        let d = decode_rgba(png_bytes).unwrap();
        let reds = (0..d.height).map(|y| d.rgba[y * d.width * 4]).collect();
        (d.width, d.height, reds)
    }

    #[test]
    fn stitch_crops_rows_exactly() {
        // Capture 0: rows 0..10 (2 header rows + 8 content rows 0..8).
        // Capture 1: content 6..14 → rows red 100..108, keep from content 8.
        let captures = vec![
            striped_png(3, 10, 0, png::ColorType::Rgba),
            striped_png(3, 8, 100, png::ColorType::Rgb),
        ];
        let segs = [seg(0.0, 8.0, 2.0), seg(6.0, 8.0, 0.0)];
        let crops = crop_plan(&segs, 12.0);
        let out = stitch(&captures, &segs, &crops).unwrap();
        let (w, h, reds) = red_column(&out);
        assert_eq!((w, h), (3, 14));
        assert_eq!(reds, vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 102, 103, 104, 105]);
    }

    #[test]
    fn stitch_scales_high_dpi_captures() {
        // Twice the device pixels per CSS pixel.
        let captures = vec![
            striped_png(4, 20, 0, png::ColorType::Rgba),
            striped_png(4, 16, 100, png::ColorType::Rgba),
        ];
        let segs = [seg(0.0, 8.0, 2.0), seg(6.0, 8.0, 0.0)];
        let crops = crop_plan(&segs, 12.0);
        let out = stitch(&captures, &segs, &crops).unwrap();
        let (_, h, reds) = red_column(&out);
        assert_eq!(h, 28);
        assert_eq!(reds[20..], [104, 105, 106, 107, 108, 109, 110, 111]);
    }

    #[test]
    fn stitch_rejects_garbage() {
        let segs = [seg(0.0, 8.0, 0.0)];
        let crops = crop_plan(&segs, 8.0);
        assert!(stitch(&[b"nope".to_vec()], &segs, &crops).is_err());
    }
}
