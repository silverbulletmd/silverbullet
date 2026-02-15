import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexData } from "./data.ts";

const testPage = `
Some test

\`\`\`#superduper
name: Pete
age: 100
\`\`\`

\`\`\`#superduper
name: Hank
age: 101
\`\`\`
`.trim();

test("Test indexers", async () => {
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

  const datas: ObjectValue<any>[] = await indexData(
    pageMeta,
    frontmatter,
    tree,
  );
  // 1 data 1 tag
  expect(datas.length).toEqual(3);

  // data object first
  expect(datas[0].tag).toEqual("superduper");
  expect(datas[0].itags).toEqual(["superduper", "data"]);
  expect(datas[0].name).toEqual("Pete");
  expect(datas[0].age).toEqual(100);

  // data object first
  expect(datas[1].tag).toEqual("superduper");
  expect(datas[1].itags).toEqual(["superduper", "data"]);
  expect(datas[1].name).toEqual("Hank");
  expect(datas[1].age).toEqual(101);
});
