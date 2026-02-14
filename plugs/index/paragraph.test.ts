import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexParagraphs } from "./paragraph.ts";

const testPage = `
#tag-only

Some paragraph

Another paragraph that is #tagged

* Item paragraph (don't index)
`.trim();

test("Test paragraph indexing", async () => {
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

  expect(paragraphs.length).toEqual(2);
  expect([...new Set(paragraphs[0].itags)]).toEqual(["paragraph", "tag-only"]);
  expect(paragraphs[1].tags).toEqual(["tagged"]);

  config.set("index.paragraph.all", false);
  tree = parseMarkdown(testPage);
  frontmatter = extractFrontMatter(tree);

  paragraphs = await indexParagraphs(pageMeta, frontmatter, tree);
  expect(paragraphs.length).toEqual(1);
});
