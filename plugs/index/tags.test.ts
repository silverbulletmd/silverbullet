import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { assertEquals } from "@std/assert";
import { indexTags } from "./tags.ts";

const testPage = `
#page-tag

* Item #item-tag
* [ ] Task #task-tag
`.trim();

Deno.test("Test tag indexing", async () => {
  createMockSystem();

  const tree = parseMarkdown(testPage);
  const frontmatter = extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "folder/test",
    name: "folder/test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const objects = await indexTags(pageMeta, frontmatter, tree);
  assertEquals(objects.length, 3);
  assertEquals(objects[0].name, "page-tag");
  assertEquals(objects[0].parent, "page");
  assertEquals(objects[1].name, "item-tag");
  assertEquals(objects[1].parent, "item");
  assertEquals(objects[2].name, "task-tag");
  assertEquals(objects[2].parent, "task");
});
