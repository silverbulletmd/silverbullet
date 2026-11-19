import { expect, test } from "vitest";
import {
  FILE_DRAG_MIME,
  fileDragData,
  parseFileDragData,
} from "./file_drag_export.ts";

test("page drag carries its page target", () => {
  const result = fileDragData({ name: "Notes/Guide", tag: "page" });
  expect(result).toEqual({
    mime: FILE_DRAG_MIME,
    payload: JSON.stringify({ path: "Notes/Guide", kind: "page" }),
  });
  expect(parseFileDragData(result!.payload)).toEqual({
    path: "Notes/Guide",
    kind: "page",
  });
});

test("document drag carries its path and content type", () => {
  expect(
    fileDragData({
      name: "Assets/photo 1.png",
      tag: "document",
      contentType: "image/png",
    }),
  ).toEqual({
    mime: FILE_DRAG_MIME,
    payload: JSON.stringify({
      path: "Assets/photo 1.png",
      kind: "document",
      contentType: "image/png",
    }),
  });
});

test("folder-only and aspiring rows carry nothing", () => {
  expect(fileDragData({ name: "Notes", isFolder: true })).toBeNull();
  expect(
    fileDragData({ name: "Missing", tag: "page", isAspiring: true }),
  ).toBeNull();
});

test("malformed drag data is rejected", () => {
  expect(parseFileDragData("bad JSON")).toBeNull();
  expect(parseFileDragData('{"path":"","kind":"page"}')).toBeNull();
  expect(parseFileDragData('{"path":"A","kind":"folder"}')).toBeNull();
});
