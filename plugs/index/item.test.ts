import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { indexItems } from "./item.ts";
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

test("Test item indexing", async () => {
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
  expect(items.length).toEqual(9);
  // Test regular items
  expect(items[0].name).toEqual("Item 1");
  expect(items[0].age).toEqual(100);
  expect(items[0].page).toEqual("test");
  expect(items[0].parent).toEqual(undefined);
  expect(items[0].text).toEqual("Item 1 #tag1 #tag2 [age: 100]");
  expect(new Set(items[0].tags)).toEqual(new Set(["tag1", "tag2"]));
  expect(new Set(items[0].itags)).toEqual(new Set(["item", "tag1", "tag2"]));

  expect(items[1].name).toEqual("Item 1.1");
  expect(new Set(items[1].tags)).toEqual(new Set(["tag3", "tag1"]));
  expect(new Set(items[1].itags)).toEqual(new Set(["tag3", "tag2", "tag1", "item"]),
  );
  expect(items[1].parent).toEqual(items[0].ref);

  expect(items[2].name).toEqual("Item 1.1.1");
  expect(items[2].parent).toEqual(items[1].ref);

  // Test tasks
  expect(items[3].tag).toEqual("task");
  expect(items[3].name).toEqual("Task 1");
  expect(items[3].done).toEqual(false);
  expect(items[3].state).toEqual(" ");

  expect(items[4].tag).toEqual("task");
  expect(items[4].name).toEqual("Task 2");
  expect(items[4].done).toEqual(true);
  expect(items[4].state).toEqual("x");

  expect(items[6].tag).toEqual("task");
  expect(items[6].name).toEqual("Sub task");
  expect(items[6].done).toEqual(false);
  expect(items[6].parent).toEqual(items[5].ref);
  expect(new Set(items[6].itags)).toEqual(new Set(["task", "tag4"]));

  expect(items[7].links).toEqual(["link"]);
  expect(items[7].ilinks).toEqual(["link"]);
  expect(items[8].links).toEqual(["link 2"]);
  expect(new Set(items[8].ilinks)).toEqual(new Set(["link", "link 2"]));
});
