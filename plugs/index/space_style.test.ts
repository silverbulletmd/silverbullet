import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { assertEquals } from "@std/assert";
import { indexSpaceStyle } from "./space_style.ts";

const testPage = `
Hello
\`\`\`space-style
.hello {}
\`\`\`

\`\`\`space-style
/* priority: 10 */
.hello2 {}
\`\`\`
`.trim();

Deno.test("Test space style indexing", async () => {
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

  const objects = await indexSpaceStyle(pageMeta, frontmatter, tree);
  assertEquals(objects.length, 2);
  assertEquals(objects[0].priority, undefined);
  assertEquals(objects[1].priority, 10);
});
