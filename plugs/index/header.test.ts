import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { assertEquals } from "@std/assert";
import { indexHeaders } from "./header.ts";

const testPage = `
# Header 1
## Header 1.1
# Header 2 [testAttr: 10]
`.trim();

Deno.test("Test header indexing", async () => {
  createMockSystem();
  const tree = parseMarkdown(testPage);
  const frontmatter = await extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const headers = await indexHeaders(
    pageMeta,
    frontmatter,
    tree,
  );
  // 1 data 1 tag
  assertEquals(headers.length, 3);

  assertEquals(headers[0].name, "Header 1");
  assertEquals(headers[0].level, 1);
  assertEquals(headers[1].name, "Header 1.1");
  assertEquals(headers[1].level, 2);
});
