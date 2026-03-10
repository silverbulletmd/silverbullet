import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexTags } from "./tags.ts";

const testPage = `
#page-tag

* Item #item-tag
* [ ] Task #task-tag
`.trim();

test("Test tag indexing", async () => {
  createMockSystem();

  const tree = parseMarkdown(testPage);
  const frontmatter = extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "folder/test",
    name: "folder/test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const objects = await indexTags(pageMeta, frontmatter, tree);
  expect(objects.length).toEqual(3);
  expect(objects[0].name).toEqual("page-tag");
  expect(objects[0].parent).toEqual("page");
  expect(objects[1].name).toEqual("item-tag");
  expect(objects[1].parent).toEqual("item");
  expect(objects[2].name).toEqual("task-tag");
  expect(objects[2].parent).toEqual("task");
});
