import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  browserMediaCapabilities,
  createMediaElement,
  mediaKindFor,
  type MediaCapabilities,
} from "./media.ts";
import { mediaTestDocument } from "./test_media_dom.ts";

const supported: MediaCapabilities = { supports: () => true };

beforeEach(() => vi.stubGlobal("document", mediaTestDocument()));
afterEach(() => vi.unstubAllGlobals());

test.each([
  [" IMAGE/PNG ; charset=utf-8", "image"],
  ["audio/mpeg", "audio"],
  ["video/mp4", "video"],
  ["application/pdf", "pdf"],
  ["image/svg+xml", null],
  ["text/html", null],
  ["application/xhtml+xml", null],
  ["application/octet-stream", null],
])("selects safe host media for %s", (mime, kind) => {
  expect(mediaKindFor(mime, supported)).toBe(kind);
});

test("rejects unsupported media and retains codec parameters", () => {
  const supports = vi.fn(() => false);
  expect(
    mediaKindFor(' Video/MP4; codecs="unknown" ', { supports }),
  ).toBeNull();
  expect(supports).toHaveBeenCalledWith("video", 'video/mp4; codecs="unknown"');
  expect(mediaKindFor("application/pdf", { supports })).toBeNull();
});

test.each(["", "maybe", "probably"])(
  "browser adapter honors canPlayType result %s",
  (result) => {
    const doc = mediaTestDocument();
    const elements: ReturnType<typeof doc.createElement>[] = [];
    vi.stubGlobal("document", {
      ...doc,
      createElement(tag: string) {
        const element = doc.createElement(tag);
        element.canPlayType.mockReturnValue(result);
        elements.push(element);
        return element;
      },
    });
    for (const kind of ["audio", "video"] as const) {
      expect(browserMediaCapabilities.supports(kind, `${kind}/test`)).toBe(
        result !== "",
      );
      expect(elements.at(-1)?.canPlayType).toHaveBeenCalledWith(`${kind}/test`);
      expect(elements.at(-1)?.parentElement).toBeNull();
    }
  },
);

test.each([true, false, undefined])(
  "PDF capability %s supports known or guarded viewing",
  (pdfViewerEnabled) => {
    vi.stubGlobal("navigator", { pdfViewerEnabled });
    expect(mediaKindFor("application/pdf", browserMediaCapabilities)).toBe(
      pdfViewerEnabled === false ? null : "pdf",
    );
  },
);

test.each([
  ["image/png", "IMG"],
  ["image/svg+xml", "IMG"],
  ["audio/mpeg", "AUDIO"],
  ["video/mp4", "VIDEO"],
  ["application/pdf", "OBJECT"],
])("constructs accessible native %s media", (contentType, tagName) => {
  const element = createMediaElement({
    url: "/.fs/sample",
    contentType,
    title: "Sample",
    dimensions: { width: 300, height: 200 },
  })!;
  expect(element.tagName).toBe(tagName);
  expect(element.title).toBe("Sample");
  expect(element.style.width).toBe("300px");
  expect(element.style.height).toBe("200px");
  expect(element.style.maxWidth).toBe("100%");
  if (tagName === "IMG")
    expect((element as HTMLImageElement).alt).toBe("Sample");
  if (tagName === "OBJECT") {
    expect((element as HTMLObjectElement).data).toBe("/.fs/sample");
    expect((element as HTMLObjectElement).type).toBe("application/pdf");
  } else expect((element as HTMLMediaElement).src).toBe("/.fs/sample");
  if (tagName === "AUDIO" || tagName === "VIDEO") {
    const media = element as HTMLMediaElement;
    expect(media.controls).toBe(true);
    expect(media.preload).toBe("metadata");
    expect(media.autoplay).toBe(false);
  }
  if (tagName === "VIDEO")
    expect((element as HTMLVideoElement).playsInline).toBe(true);
});

test("rejects active non-image content in the factory", () => {
  for (const contentType of [
    "text/html",
    "application/xhtml+xml",
    "application/xml",
  ]) {
    expect(
      createMediaElement({ url: "/.fs/sample", contentType, title: "Sample" }),
    ).toBeNull();
  }
});
