import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexMarkdown } from "./indexer.ts";
import { indexTags, tagComplete } from "./tags.ts";

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

const commentedPage = `
A #live tag.

<!--
A #commented tag.
-->

A #both tag.

<!--
Another #both tag.
-->
`.trim();

const commentedPageMeta: PageMeta = {
  ref: "TagPage",
  name: "TagPage",
  tag: "page",
  created: "",
  lastModified: "",
  perm: "rw",
};

test("a tag occurring only inside a comment is marked as commented", async () => {
  createMockSystem();

  const objects = await indexMarkdown(commentedPage, commentedPageMeta);
  const byName: Record<string, any> = Object.fromEntries(
    objects.filter((o: any) => o.tag === "tag").map((o: any) => [o.name, o]),
  );
  expect(byName.live.inComment).toBeUndefined();
  expect(byName.commented.inComment).toBe(true);
  // One record per page: a tag written outside a comment too is live.
  expect(byName.both.inComment).toBeUndefined();
});

test("commented-out tags are left out of # completion", async () => {
  createMockSystem();

  const objects = await indexMarkdown(commentedPage, commentedPageMeta);
  await (globalThis as any).syscall("index.indexObjects", "TagPage", objects);

  const result = await tagComplete({
    linePrefix: "Something #",
    pos: 11,
    pageName: "TagPage",
    parentNodes: [],
  });
  const labels = result!.options.map((o) => o.label);
  expect(labels).toContain("#live");
  expect(labels).toContain("#both");
  expect(labels).not.toContain("#commented");
});
