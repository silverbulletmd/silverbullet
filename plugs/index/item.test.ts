import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { indexItems } from "./item.ts";
import { assertEquals } from "@std/assert";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

const itemsMd = `
* Item 1 #tag1 #tag2 [age: 100]
  * Item 1.1 #tag3 #tag1
    * Item 1.1.1
* [ ] Task 1
* [x] Task 2
* Item 2 #tag4
  * [ ] Sub task
* [[link]]
  * Child second [[link 2|alias]]
`;

Deno.test("Test item indexing", async () => {
  createMockSystem();
  const tree = parseMarkdown(itemsMd);
  const frontmatter = extractFrontMatter(tree);
  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
  const items = await indexItems(pageMeta, frontmatter, tree);
  assertEquals(items.length, 9);
  // Test regular items
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

  assertEquals(items[2].name, "Item 1.1.1");
  assertEquals(items[2].parent, items[1].ref);

  // Test tasks
  assertEquals(items[3].tag, "task");
  assertEquals(items[3].name, "Task 1");
  assertEquals(items[3].done, false);
  assertEquals(items[3].state, " ");

  assertEquals(items[4].tag, "task");
  assertEquals(items[4].name, "Task 2");
  assertEquals(items[4].done, true);
  assertEquals(items[4].state, "x");

  assertEquals(items[6].tag, "task");
  assertEquals(items[6].name, "Sub task");
  assertEquals(items[6].done, false);
  assertEquals(items[6].parent, items[5].ref);
  assertEquals(new Set(items[6].itags), new Set(["task", "tag4"]));

  assertEquals(items[7].links, ["link"]);
  assertEquals(items[7].ilinks, ["link"]);
  assertEquals(items[8].links, ["link 2"]);
  assertEquals(new Set(items[8].ilinks), new Set(["link", "link 2"]));
});
