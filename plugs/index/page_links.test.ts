import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { assertEquals } from "@std/assert";
import { indexLinks } from "./page_links.ts";

const testPage = `
---
attribute: "[[fm-link]]"
---
This is a [[page-link]] to [[aliased-link|aliased]], or [this](md-link), and [[broken]]
`.trim();

Deno.test("Test page link indexing", async () => {
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
  // console.log(objects);
  assertEquals(objects.length, 6); // 5 links + 1 aspiring page
  assertEquals(objects[0].toPage, "fm-link");
  assertEquals(objects[1].toPage, "page-link");
  assertEquals(objects[2].toPage, "aliased-link");
  assertEquals(objects[2].alias, "aliased");
  assertEquals(objects[3].toPage, "folder/md-link"); // relative
});
