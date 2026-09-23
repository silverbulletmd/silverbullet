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
