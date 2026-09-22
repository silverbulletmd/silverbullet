import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import { expect, test } from "vitest";
import {
  type MediaCapabilities,
  resolveDocumentCapability,
  resolveDocumentEditor,
} from "./document_editor_resolver.ts";

const noPlugins = new Map();
const capabilities: MediaCapabilities = { supports: () => true };

function meta(name: string, contentType: string, size = 20): DocumentMeta {
  return {
    name,
    extension: name.split(".").pop()!,
    contentType,
    size,
    created: "",
    lastModified: "",
    perm: "rw",
    ref: name,
    tag: "document",
  };
}

test.each([
  ["sample.rs", "application/octet-stream"],
  ["sample.pdf", "application/pdf"],
])("a matching plug owns %s before built-in handlers", (name, contentType) => {
  const callback = async () => ({ html: "<p>Example</p>" });
  const plugins = new Map([
    ["ExampleEditor", { extensions: ["RS", "PDF"], callback }],
  ]);
  expect(
    resolveDocumentEditor(
      meta(name, contentType, 6_000_000),
      plugins,
      capabilities,
    ),
  ).toEqual(
    expect.objectContaining({
      kind: "plug",
      name: "ExampleEditor",
      callback,
      needsBytes: true,
    }),
  );
});

test.each([
  ["sample.RS", "application/octet-stream", "rs", false],
  ["sample.tex", "application/octet-stream", "tex", false],
  ["notes.xyz", "TEXT/X-EXAMPLE; charset=UTF-8", null, false],
  ["notes.xyz", "application/problem+json", null, false],
  ["notes.xyz", "application/xml", null, false],
  ["sample.svg", "image/svg+xml", null, false],
  ["sample.html", "text/html", "html", false],
  ["notes.xyz", "application/x-unknown", null, true],
  ["notes.bin", "application/octet-stream", null, true],
])("%s (%s) resolves as a text candidate", (name, contentType, languageName, requiresUtf8Probe) => {
  expect(
    resolveDocumentEditor(meta(name, contentType), noPlugins, capabilities),
  ).toEqual(
    expect.objectContaining({
      kind: "text",
      languageName,
      requiresUtf8Probe,
      needsBytes: true,
    }),
  );
});

test.each([
  true,
  false,
])("index.ts resolves as TypeScript even when video MIME support is %s", (supported) => {
  expect(
    resolveDocumentEditor(
      meta("index.ts", "video/vnd.dlna.mpeg-tts"),
      noPlugins,
      { supports: () => supported },
    ),
  ).toEqual(
    expect.objectContaining({
      kind: "text",
      languageName: "ts",
      needsBytes: true,
    }),
  );
});

test.each([
  "text/plain",
  "application/octet-stream",
])("the text limit accepts 5 MiB and rejects one byte more (%s)", (contentType) => {
  expect(
    resolveDocumentEditor(
      meta("sample.rs", contentType, 5_242_880),
      noPlugins,
      capabilities,
    ).kind,
  ).toBe("text");
  expect(
    resolveDocumentEditor(
      meta("sample.rs", contentType, 5_242_881),
      noPlugins,
      capabilities,
    ),
  ).toEqual(expect.objectContaining({ kind: "external", reason: "too-large" }));
});

test.each([
  ["image/png", "image"],
  ["audio/ogg", "audio"],
  ["video/mp4", "video"],
  ["application/pdf", "pdf"],
])("safe supported %s is media without bytes", (contentType, mediaType) => {
  const seen: unknown[] = [];
  expect(
    resolveDocumentEditor(
      meta("sample.bin", contentType, 90_000_000),
      noPlugins,
      {
        supports: (kind, mime) => {
          seen.push([kind, mime]);
          return true;
        },
      },
    ),
  ).toEqual(
    expect.objectContaining({
      kind: "media",
      mediaType,
      contentType,
      needsBytes: false,
    }),
  );
  expect(seen).toEqual([[mediaType, contentType]]);
  expect(
    resolveDocumentEditor(meta("sample.bin", contentType), noPlugins, {
      supports: () => false,
    }),
  ).toEqual(
    expect.objectContaining({ kind: "external", reason: "unsupported-media" }),
  );
});

test("known binary content is external even when small", () => {
  expect(
    resolveDocumentEditor(
      meta("archive.zip", "application/zip"),
      noPlugins,
      capabilities,
    ),
  ).toEqual(expect.objectContaining({ kind: "external", reason: "binary" }));
});

test("active text formats never reach the media capability hook", () => {
  for (const contentType of [
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/xml",
  ]) {
    expect(
      resolveDocumentEditor(meta("sample.xyz", contentType), noPlugins, {
        supports: () => {
          throw new Error("active content reached media");
        },
      }).kind,
    ).toBe("text");
  }
});

test("media capability checks retain codec parameters", () => {
  const seen: string[] = [];
  const resolution = resolveDocumentEditor(
    meta("clip.mp4", 'Video/MP4; codecs="unknown"'),
    noPlugins,
    {
      supports: (_kind, contentType) => {
        seen.push(contentType);
        return contentType === "video/mp4";
      },
    },
  );
  expect(seen).toEqual(['video/mp4; codecs="unknown"']);
  expect(resolution).toEqual(
    expect.objectContaining({ kind: "external", reason: "unsupported-media" }),
  );
});

test("metadata capability results defer the UTF-8 decision for small unknown files", () => {
  expect(
    resolveDocumentCapability(
      meta("notes.unknown", "application/octet-stream"),
      noPlugins,
      capabilities,
    ),
  ).toEqual({ kind: "text", reason: "probe-required" });
});
