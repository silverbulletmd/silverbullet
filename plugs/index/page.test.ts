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

test("frontmatter $ref anchor record carries pageLastModified", async () => {
  createMockSystem();
  const tree = parseMarkdown(`---\n$ref: today\n---\n\nSome text.\n`);
  const frontmatter = extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "Journal",
    name: "Journal",
    tag: "page",
    created: "",
    lastModified: "2026-07-03T09:00:00Z",
    perm: "rw",
  };

  const results = await indexPage(pageMeta, frontmatter, tree);
  const anchor = results.find((o: any) => o.tag === "anchor");
  expect(anchor).toMatchObject({
    tag: "anchor",
    ref: "today",
    page: "Journal",
    hostTag: "page",
    pageLastModified: "2026-07-03T09:00:00Z",
  });
  // Page-level anchors have no host range, so there is nothing to snippet.
  expect((anchor as any).snippet).toBeUndefined();
});
