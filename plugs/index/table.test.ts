import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { assertEquals } from "@std/assert";
import { indexTables } from "./table.ts";

const testPage = `
| name | age |
|----------|----------|
| Frank | 20 |
| Fred | 21 |
`.trim();

Deno.test("Test table indexing", async () => {
  createMockSystem();

  const tree = parseMarkdown(testPage);
  const frontmatter = extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const datas = await indexTables(pageMeta, frontmatter, tree);
  assertEquals(datas.length, 2);
  assertEquals(datas[0].name, "Frank");
  assertEquals(datas[0].age, "20");
  assertEquals(datas[1].name, "Fred");
  assertEquals(datas[1].age, "21");
});
