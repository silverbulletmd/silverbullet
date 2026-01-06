import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { assertEquals } from "@std/assert";
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

Deno.test("Test indexers", async () => {
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

  const datas: ObjectValue<any>[] = await indexData(
    pageMeta,
    frontmatter,
    tree,
  );
  // 1 data 1 tag
  assertEquals(datas.length, 3);

  // data object first
  assertEquals(datas[0].tag, "superduper");
  assertEquals(datas[0].itags, ["superduper", "data"]);
  assertEquals(datas[0].name, "Pete");
  assertEquals(datas[0].age, 100);

  // data object first
  assertEquals(datas[1].tag, "superduper");
  assertEquals(datas[1].itags, ["superduper", "data"]);
  assertEquals(datas[1].name, "Hank");
  assertEquals(datas[1].age, 101);
});
