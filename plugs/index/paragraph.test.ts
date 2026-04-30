import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexParagraphs } from "./paragraph.ts";

async function indexParagraphsForTest(
  text: string,
  pageName = "TestPage",
) {
  const { config } = createMockSystem();
  config.set("index.paragraph.all", false);
  const tree = parseMarkdown(text);
  const frontmatter = extractFrontMatter(tree);
  const pageMeta: PageMeta = {
    ref: pageName,
    name: pageName,
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
  return indexParagraphs(pageMeta, frontmatter, tree);
}

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

test("paragraph with $anchor uses anchor as ref", async () => {
  const objects = await indexParagraphsForTest(
    `Paragraph with anchor $pete here. #marker`,
  );
  const para = objects.find((o) => o.tag === "paragraph")!;
  expect(para.ref).toBe("pete");
  expect(para.text).not.toContain("$pete");
});

test("standalone-line $anchor still indexes the paragraph", async () => {
  const objects = await indexParagraphsForTest(`$standalone\n`);
  const para = objects.find((o) => o.tag === "paragraph");
  expect(para).toBeDefined();
  expect(para!.ref).toBe("standalone");
});

test("paragraph without anchor keeps Page@pos ref", async () => {
  const objects = await indexParagraphsForTest(
    `Tagged paragraph without anchor #foo`,
    "MyPage",
  );
  const para = objects.find((o) => o.tag === "paragraph")!;
  expect(para.ref).toMatch(/^MyPage@\d+$/);
});
