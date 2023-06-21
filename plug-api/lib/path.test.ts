import { assertEquals } from "../../test_deps.ts";
import { folderName, toAbsolutePath, toRelativePath } from "$sb/lib/path.ts";

Deno.test("Path functions", () => {
  assertEquals(folderName(""), "");

  assertEquals(toRelativePath("path", "path2"), "path2");
  assertEquals(toRelativePath("folderA/file", "folderA/file2"), "file2");
  assertEquals(
    toRelativePath("folderA/file1", "folderB/file2"),
    "../folderB/file2",
  );
  assertEquals(toRelativePath("this/is/a/path", "this/is/b/path"), "../b/path");
  assertEquals(toRelativePath("this/folder/file", "file"), "../../file");

  assertEquals(toRelativePath("test1/test2/test3", "test1/test2"), "../test2");

  assertEquals(toRelativePath("test/test", "test2"), "../test2");

  assertEquals(toAbsolutePath("folder/bla", "file"), "folder/file");
  assertEquals(toAbsolutePath("folder/file", "../file"), "file");
  assertEquals(
    toAbsolutePath("folderA/file", "../folderB/file"),
    "folderB/file",
  );
});
