import { expect, test } from "vitest";
import { resolveMarkdownLink } from "@silverbulletmd/silverbullet/lib/resolve";

test("Test URL resolver", () => {
  // Absolute paths
  expect(
    resolveMarkdownLink("foo", "/bar"),
  ).toEqual("bar");
  expect(
    resolveMarkdownLink("/foo/bar/baz", "/qux"),
  ).toEqual("qux");
  expect(
    resolveMarkdownLink("foo", "/bar@123#456"),
  ).toEqual("bar@123#456");
  expect(
    resolveMarkdownLink("foo/bar", "/baz.jpg"),
  ).toEqual("baz.jpg");

  // Relative paths
  expect(
    resolveMarkdownLink("bar", "foo"),
  ).toEqual("foo");
  expect(
    resolveMarkdownLink("foo/bar.jpg", "baz"),
  ).toEqual("foo/baz");
  expect(
    resolveMarkdownLink("/foo/bar", "baz"),
  ).toEqual("/foo/baz");
  expect(
    resolveMarkdownLink("foo///bar", "baz"),
  ).toEqual("foo///baz");
  expect(
    resolveMarkdownLink("bar", "../foo/baz"),
  ).toEqual("foo/baz");
  expect(
    resolveMarkdownLink("bar", "../../foo/baz"),
  ).toEqual("foo/baz");
  expect(
    resolveMarkdownLink("bar/qux", "foo/../baz"),
  ).toEqual("bar/foo/../baz");
});
