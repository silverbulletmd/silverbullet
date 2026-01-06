import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { indexPage } from "./page.ts";
import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { assertEquals } from "@std/assert";

const testPage = `
---
hello: attribute
---
[hello2: 12]

# Hello world!

`.trim();

Deno.test("Test page indexer", async () => {
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

  const [pm] = await indexPage(pageMeta, frontmatter, tree);
  assertEquals(pm.hello, "attribute");
  assertEquals(pm.hello2, 12);
  assertEquals(pm.itags, ["page"]);
});
