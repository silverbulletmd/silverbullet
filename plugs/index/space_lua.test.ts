import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexSpaceLua } from "./space_lua.ts";

const testPage = `
Hello
\`\`\`space-lua
function sup()
end
\`\`\`

\`\`\`space-lua
-- priority: 10
function sup()
end
\`\`\`
`.trim();

test("Test space lua indexing", async () => {
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

  const objects = await indexSpaceLua(pageMeta, frontmatter, tree);
  expect(objects.length).toEqual(2);
  expect(objects[0].priority).toEqual(undefined);
  expect(objects[1].priority).toEqual(10);
});
