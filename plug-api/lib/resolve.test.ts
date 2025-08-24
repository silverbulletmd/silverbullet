import { resolveMarkdownLink } from "@silverbulletmd/silverbullet/lib/resolve";
import { assertEquals } from "@std/assert";

Deno.test("Test URL resolver", () => {
  // Absolute paths
  assertEquals(
    resolveMarkdownLink("foo", "/bar"),
    "bar",
  );
  assertEquals(
    resolveMarkdownLink("/foo/bar/baz", "/qux"),
    "qux",
  );
  assertEquals(
    resolveMarkdownLink("foo", "/bar@123#456"),
    "bar@123#456",
  );
  assertEquals(
    resolveMarkdownLink("foo/bar", "/baz.jpg"),
    "baz.jpg",
  );

  // Relative paths
  assertEquals(
    resolveMarkdownLink("bar", "foo"),
    "foo",
  );
  assertEquals(
    resolveMarkdownLink("foo/bar.jpg", "baz"),
    "foo/baz",
  );
  assertEquals(
    resolveMarkdownLink("/foo/bar", "baz"),
    "/foo/baz",
  );
  assertEquals(
    resolveMarkdownLink("foo///bar", "baz"),
    "foo///baz",
  );
  assertEquals(
    resolveMarkdownLink("bar", "../foo/baz"),
    "foo/baz",
  );
  assertEquals(
    resolveMarkdownLink("bar", "../../foo/baz"),
    "foo/baz",
  );
  assertEquals(
    resolveMarkdownLink("bar/qux", "foo/../baz"),
    "bar/foo/../baz",
  );
});
