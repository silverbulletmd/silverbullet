import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { parseMarkdown } from "../client/markdown_parser/parser.ts";
import { createMockSystem } from "../plug-api/system_mock.ts";
import { extractFrontMatter } from "../plugs/index/frontmatter.ts";
import { indexRelations } from "../plugs/index/relation.ts";

const root = import.meta.dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".md")) out.push(path);
  }
  return out;
}

// The bundled library lands in every space, next to pages it knows nothing
// about: a link from it to a page of its own that does not exist would show
// up as an aspiring page (a "Create" suggestion) in every space.
test("bundled library pages only link to pages that ship with them", async () => {
  const { space } = createMockSystem();
  const pages = walk(join(root, "Library")).map((path) => ({
    name: relative(root, path).slice(0, -".md".length),
    text: readFileSync(path, "utf-8"),
  }));
  for (const { name, text } of pages) await space.writePage(name, text);

  const dangling: string[] = [];
  for (const { name, text } of pages) {
    const tree = parseMarkdown(text);
    const objects = await indexRelations(
      {
        ref: name,
        name,
        tag: "page",
        created: "",
        lastModified: "",
        perm: "ro",
      },
      extractFrontMatter(tree),
      tree,
      text,
    );
    for (const o of objects) {
      if (o.tag === "aspiring-page") dangling.push(`${name} -> ${o.name}`);
    }
  }
  expect(dangling).toEqual([]);
});
