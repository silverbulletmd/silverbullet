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

test("resolveAttachmentPath prefixes pasted files (#1215)", () => {
  expect(resolveAttachmentPath("Folder/Page", "", "image.png")).toEqual(
    "Folder/image.png",
  );
  expect(resolveAttachmentPath("Page", "", "image.png")).toEqual("image.png");

  expect(
    resolveAttachmentPath("Folder/Page", "attachments/", "image.png"),
  ).toEqual("Folder/attachments/image.png");
  expect(resolveAttachmentPath("Page", "attachments/", "image.png")).toEqual(
    "attachments/image.png",
  );
  expect(resolveAttachmentPath("Folder/Page", "attachments", "image.png"))
    .toEqual("Folder/attachments/image.png");

  expect(
    resolveAttachmentPath("Folder/Sub/Page", "/Assets/", "image.png"),
  ).toEqual("Assets/image.png");
  expect(resolveAttachmentPath("Page", "/Assets/", "image.png")).toEqual(
    "Assets/image.png",
  );
  expect(resolveAttachmentPath("Folder/Page", "/Assets", "image.png")).toEqual(
    "Assets/image.png",
  );
});

test("a resolved attachment path must not be resolved again against the page", () => {
  // The overwrite prompt used to pass this through resolveMarkdownLink a
  // second time, turning Assets/image.png into Folder/Assets/image.png.
  const page = "Folder/Page";
  const suggested = resolveAttachmentPath(page, "/Assets/", "image.png");
  expect(suggested).toEqual("Assets/image.png");
  expect(resolveMarkdownLink(page, suggested)).toEqual(
    "Folder/Assets/image.png",
  );
});
