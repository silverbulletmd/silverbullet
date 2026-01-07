import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { assertEquals } from "@std/assert";
import { indexParagraphs } from "./paragraph.ts";

const testPage = `
#tag-only

Some paragraph

Another paragraph that is #tagged

* Item paragraph (don't index)
`.trim();

Deno.test("Test paragraph indexing", async () => {
  const { config } = createMockSystem();

  config.set("index.paragraph.all", true);
  let tree = parseMarkdown(testPage);
  let frontmatter = extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  let paragraphs = await indexParagraphs(pageMeta, frontmatter, tree);
  console.log(paragraphs);

  assertEquals(paragraphs.length, 2);
  assertEquals([...new Set(paragraphs[0].itags)], ["paragraph", "tag-only"]);
  assertEquals(paragraphs[1].tags, ["tagged"]);

  config.set("index.paragraph.all", false);
  tree = parseMarkdown(testPage);
  frontmatter = extractFrontMatter(tree);

  paragraphs = await indexParagraphs(pageMeta, frontmatter, tree);
  assertEquals(paragraphs.length, 1);
});
