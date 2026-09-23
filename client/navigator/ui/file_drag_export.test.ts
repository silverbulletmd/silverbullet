import { expect, test } from "vitest";
import {
  fileDragData,
  FILE_DRAG_MIME,
  parseFileDragData,
} from "./file_drag_export.ts";

test("page drag exports Markdown under its basename and retains its page target", () => {
  const result = fileDragData(
    { name: "Notes/Guide", tag: "page" },
    "https://example.test/space/.fs",
  );
  expect(result).toEqual({
    mime: FILE_DRAG_MIME,
    payload: JSON.stringify({ path: "Notes/Guide", kind: "page" }),
    downloadURL:
      "text/markdown:Guide.md:https://example.test/space/.fs/Notes/Guide.md",
  });
  expect(parseFileDragData(result!.payload)).toEqual({
    path: "Notes/Guide",
    kind: "page",
  });
});

test("document drag preserves filename and content type with encoded path", () => {
  expect(
    fileDragData(
      { name: "Assets/photo 1.png", tag: "document", contentType: "image/png" },
      "https://example.test/.fs",
    ),
  ).toEqual({
    mime: FILE_DRAG_MIME,
    payload: JSON.stringify({
      path: "Assets/photo 1.png",
      kind: "document",
      contentType: "image/png",
    }),
    downloadURL:
      "image/png:photo 1.png:https://example.test/.fs/Assets/photo%201.png",
  });
});

test("folder-only and aspiring rows cannot export", () => {
  expect(fileDragData({ name: "Notes", isFolder: true }, "/.fs")).toBeNull();
  expect(
    fileDragData({ name: "Missing", tag: "page", isAspiring: true }, "/.fs"),
  ).toBeNull();
});

test("malformed drag data is rejected", () => {
  expect(parseFileDragData("bad JSON")).toBeNull();
  expect(parseFileDragData('{"path":"","kind":"page"}')).toBeNull();
  expect(parseFileDragData('{"path":"A","kind":"folder"}')).toBeNull();
});
