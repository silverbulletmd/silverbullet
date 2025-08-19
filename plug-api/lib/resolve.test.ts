import { resolveMarkdownLink } from "@silverbulletmd/silverbullet/lib/resolve";
import { assertEquals } from "@std/assert";

Deno.test("Test URL resolver", () => {
  // Absolute paths
  assertEquals(
    "bar",
    resolveMarkdownLink("foo", "/bar"),
  );
  assertEquals(
    "qux",
    resolveMarkdownLink("/foo/bar/baz", "/qux"),
  );
  assertEquals(
    "bar@123#456",
    resolveMarkdownLink("foo", "/bar@123#456"),
  );
  assertEquals(
    "baz.jpg",
    resolveMarkdownLink("foo/bar", "/baz.jpg"),
  );

  // Relative paths
  assertEquals(
    "foo.jpg",
    resolveMarkdownLink("bar", "foo.jpg"),
  );
  assertEquals(
    "foo/baz.jpg",
    resolveMarkdownLink("foo/bar", "baz.jpg"),
  );
  assertEquals(
    "foo/baz.jpg",
    resolveMarkdownLink("/foo/bar", "baz.jpg"),
  );
  assertEquals(
    "foo/baz.jpg",
    resolveMarkdownLink("foo///bar", "baz.jpg"),
  );
});
