import "../../plug-api/lib/syscall_mock.ts";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { indexItems } from "./item.ts";
import { assertEquals } from "@std/assert";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

const itemsMd = `
* Item 1 #tag1 #tag2 [age: 100]
  * Item 1.1 #tag3 #tag1
    * Item 1.1.1
`;

Deno.test("Test item extraction", async () => {
  createMockSystem();
  const tree = parseMarkdown(itemsMd);
  const frontmatter = await extractFrontMatter(tree);
  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
  const items = await indexItems(pageMeta, frontmatter, tree);

  assertEquals(items[0].name, "Item 1");
  assertEquals(items[0].age, 100);
  assertEquals(items[0].page, "test");
  assertEquals(items[0].parent, undefined);
  assertEquals(items[0].text, "Item 1 #tag1 #tag2 [age: 100]");
  assertEquals(new Set(items[0].tags), new Set(["tag1", "tag2"]));
  assertEquals(new Set(items[0].itags), new Set(["item", "tag1", "tag2"]));

  assertEquals(items[1].name, "Item 1.1");
  assertEquals(new Set(items[1].tags), new Set(["tag3", "tag1"]));
  assertEquals(
    new Set(items[1].itags),
    new Set(["tag3", "tag2", "tag1", "item"]),
  );
  assertEquals(items[1].parent, items[0].ref);

  assertEquals(items[2].parent, items[1].ref);
});
