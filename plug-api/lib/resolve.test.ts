import { expect, test } from "vitest";
import {
  isLocalURL,
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
  // A leading `./` means the current folder (#2200)
  expect(resolveMarkdownLink("Folder/page", "./other")).toEqual("Folder/other");
  expect(resolveMarkdownLink("page", "./other")).toEqual("other");
  expect(resolveMarkdownLink("a/b/page", "./../other")).toEqual("a/other");
  // A leading `#` links to a header on the current page (#1107)
  expect(resolveMarkdownLink("some/folder/File", "#This")).toEqual(
    "some/folder/File#This",
  );
  expect(resolveMarkdownLink("File", "#This")).toEqual("File#This");
});

test("application protocols are external regardless of URL shape", () => {
  for (const url of [
    "message://example-id",
    "custom+notes.v2:open-item",
    "MAILTO:reader@example.com",
    "tel:+1234567890",
  ]) {
    expect(isLocalURL(url)).toBe(false);
  }
  for (const url of [
    "Notes/Page",
    "../Page",
    "/Page",
    "#Heading",
    "Notes/Meeting: today",
  ]) {
    expect(isLocalURL(url)).toBe(true);
  }
});
