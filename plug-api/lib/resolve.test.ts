import { expect, test } from "vitest";
import {
  resolveAttachmentPath,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";

test("Test URL resolver", () => {
  // Absolute paths
  expect(resolveMarkdownLink("foo", "/bar")).toEqual("bar");
  expect(resolveMarkdownLink("/foo/bar/baz", "/qux")).toEqual("qux");
  expect(resolveMarkdownLink("foo", "/bar@123#456")).toEqual("bar@123#456");
  expect(resolveMarkdownLink("foo/bar", "/baz.jpg")).toEqual("baz.jpg");

  // Relative paths
  expect(resolveMarkdownLink("bar", "foo")).toEqual("foo");
  expect(resolveMarkdownLink("foo/bar.jpg", "baz")).toEqual("foo/baz");
  expect(resolveMarkdownLink("/foo/bar", "baz")).toEqual("/foo/baz");
  expect(resolveMarkdownLink("foo///bar", "baz")).toEqual("foo///baz");
  expect(resolveMarkdownLink("bar", "../foo/baz")).toEqual("foo/baz");
  expect(resolveMarkdownLink("bar", "../../foo/baz")).toEqual("foo/baz");
  expect(resolveMarkdownLink("bar/qux", "foo/../baz")).toEqual(
    "bar/foo/../baz",
  );
});

// See https://github.com/silverbulletmd/silverbullet/issues/1215 - lets users
// configure a default folder prefix for pasted/uploaded attachments instead
// of having to type one manually every time.
test("Test resolveAttachmentPath (issue #1215: configurable attachment path)", () => {
  // Default (empty) attachmentPath: behavior is unchanged from before the
  // setting existed - same folder as the current page.
  expect(resolveAttachmentPath("Folder/Page", "", "image.png")).toEqual(
    "Folder/image.png",
  );
  expect(resolveAttachmentPath("Page", "", "image.png")).toEqual("image.png");

  // Relative attachmentPath (no leading "/"): resolved relative to the
  // current page's folder, e.g. a per-note "attachments/" subfolder.
  expect(
    resolveAttachmentPath("Folder/Page", "attachments/", "image.png"),
  ).toEqual("Folder/attachments/image.png");
  expect(resolveAttachmentPath("Page", "attachments/", "image.png")).toEqual(
    "attachments/image.png",
  );

  // Absolute attachmentPath (leading "/"): always resolves to the same
  // space-root-relative folder, regardless of the current page's location.
  expect(
    resolveAttachmentPath("Folder/Sub/Page", "/Assets/", "image.png"),
  ).toEqual("Assets/image.png");
  expect(resolveAttachmentPath("Page", "/Assets/", "image.png")).toEqual(
    "Assets/image.png",
  );
});
