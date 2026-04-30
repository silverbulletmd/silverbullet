import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexHeaders } from "./header.ts";

const testPage = `
# Header 1
## Header 1.1
# Header 2 [testAttr: 10]
`.trim();

test("Test header indexing", async () => {
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

  const headers = await indexHeaders(pageMeta, frontmatter, tree);
  // 1 data 1 tag
  expect(headers.length).toEqual(3);

  expect(headers[0].name).toEqual("Header 1");
  expect(headers[0].level).toEqual(1);
  expect(headers[1].name).toEqual("Header 1.1");
  expect(headers[1].level).toEqual(2);
});

function makePageMeta(name = "test"): PageMeta {
  return {
    ref: name,
    name,
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
}

test("header with $anchor uses anchor as ref", async () => {
  createMockSystem();
  const src = `# Some heading $sec1`;
  const tree = parseMarkdown(src);
  const frontmatter = await extractFrontMatter(tree);
  const headers = await indexHeaders(makePageMeta(), frontmatter, tree);

  expect(headers.length).toEqual(1);
  expect(headers[0].ref).toBe("sec1");
  // $sec1 must not appear in name or text
  expect(headers[0].name).not.toContain("$sec1");
  expect(headers[0].text).not.toContain("$sec1");
  expect(headers[0].name.trim()).toBe("Some heading");
});

test("header without anchor keeps Page@pos ref shape", async () => {
  createMockSystem();
  const src = `# Plain header`;
  const tree = parseMarkdown(src);
  const frontmatter = await extractFrontMatter(tree);
  const headers = await indexHeaders(makePageMeta("MyPage"), frontmatter, tree);

  expect(headers.length).toEqual(1);
  expect(headers[0].ref).toMatch(/^MyPage@\d+$/);
});
