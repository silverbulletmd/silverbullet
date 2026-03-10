import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { indexPage } from "./page.ts";
import { extractFrontMatter } from "./frontmatter.ts";

const testPage = `
---
hello: attribute
---
[hello2: 12]

# Hello world!

`.trim();

test("Test page indexing", async () => {
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

  const [pm] = await indexPage(pageMeta, frontmatter, tree);
  expect(pm.hello).toEqual("attribute");
  expect(pm.hello2).toEqual(12);
  expect(pm.itags).toEqual(["page"]);
});
