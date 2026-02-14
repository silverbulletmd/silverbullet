import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexTables } from "./table.ts";

const testPage = `
| name | age |
|----------|----------|
| Frank | 20 |
| Fred | 21 |
`.trim();

test("Test table indexing", async () => {
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
  expect(datas.length).toEqual(2);
  expect(datas[0].name).toEqual("Frank");
  expect(datas[0].age).toEqual("20");
  expect(datas[1].name).toEqual("Fred");
  expect(datas[1].age).toEqual("21");
});
