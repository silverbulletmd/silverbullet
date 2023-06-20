import { assertEquals } from "../../test_deps.ts";
import { folderName, relativePath, resolve } from "$sb/lib/path.ts";

Deno.test("Path functions", () => {
  assertEquals(relativePath(folderName("path"), "path2"), "path2");
  assertEquals(
    relativePath(folderName("folderA/file"), "folderA/file2"),
    "file2",
  );
  assertEquals(
    relativePath("folderA", "folderB/file2"),
    "../folderB/file2",
  );
  assertEquals(relativePath("this/is/a", "this/is/b/path"), "../b/path");
  assertEquals(relativePath("this/folder", "file"), "../../file");

  assertEquals(relativePath("test1/test2", "test1/test2"), "../test2");

  assertEquals(relativePath("test", "test2"), "../test2");

  assertEquals(resolve("folder", "file"), "folder/file");
  assertEquals(resolve("folder", "../file"), "file");
  assertEquals(resolve("folderA", "../folderB/file"), "folderB/file");
});
