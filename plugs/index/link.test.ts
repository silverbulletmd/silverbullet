import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexLinks } from "./link.ts";

const testPage = `
---
attribute: "[[fm-link]]"
---
This is a [[page-link]] to [[aliased-link|aliased]], or [this](md-link), and [[broken]], or [external](https://example.com), or [document](test.jpg), or [[test2.jpg]]
`.trim();

test("Test page link indexing", async () => {
  const { space } = createMockSystem();

  // Create dummy targets to avoid a lot of aspiring pages
  await space.writePage("page-link", "");
  await space.writePage("fm-link", "");
  await space.writePage("aliased-link", "");
  await space.writePage("folder/md-link", "");

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

  const objects = await indexLinks(pageMeta, frontmatter, tree, testPage);
  expect(objects.length).toEqual(9); // 7 links + 1 aspiring page
  expect(objects[0].toPage).toEqual("fm-link");
  expect(objects[0].type).toEqual("page");
  expect(objects[1].toPage).toEqual("page-link");
  expect(objects[1].type).toEqual("page");
  expect(objects[2].toPage).toEqual("aliased-link");
  expect(objects[2].type).toEqual("page");
  expect(objects[2].alias).toEqual("aliased");
  expect(objects[3].toPage).toEqual("folder/md-link"); // relative
  expect(objects[3].type).toEqual("page");
  expect(objects[4].toPage).toEqual("broken");
  expect(objects[4].type).toEqual("page");
  expect(objects[5].toURL).toEqual("https://example.com");
  expect(objects[5].type).toEqual("url");
  expect(objects[6].toFile).toEqual("folder/test.jpg");
  expect(objects[6].type).toEqual("file");
  expect(objects[7].toFile).toEqual("test2.jpg");
  expect(objects[7].type).toEqual("file");
});
