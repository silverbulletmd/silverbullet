// Regression coverage for the virtual `link` collection.
//
// `link` records are no longer indexed directly; they're projected
// from `relation` records via `relationToLink` whenever something
// queries the `link` tag.

import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { type LinkObject, relationToLink } from "./link.ts";
import { indexRelations } from "./relation.ts";

// Mirrors what the legacy `link` indexer would have emitted:
//
//   - frontmatter `attribute: "[[fm-link]]"`     → page link
//   - body `[[page-link]]`                       → page link
//   - body `[[aliased-link|aliased]]`            → page link with alias
//   - markdown `[this](md-link)`                 → page link (relative)
//   - body `[[broken]]`                          → page link (broken)
//   - markdown `[external](https://example.com)` → url link
//   - markdown `[document](test.jpg)`            → file link
//   - body `[[test2.jpg]]`                       → file link
const fixturePage = `
---
attribute: "[[fm-link]]"
---
This is a [[page-link]] to [[aliased-link|aliased]], or [this](md-link), and [[broken]], or [external](https://example.com), or [document](test.jpg), or [[test2.jpg]]
`.trim();

type Expected = {
  type: LinkObject["type"];
  target: string;
  alias?: string;
};

const expected: Expected[] = [
  { type: "page", target: "fm-link" },
  { type: "page", target: "page-link" },
  { type: "page", target: "aliased-link", alias: "aliased" },
  // Markdown-link text becomes the alias on the link record.
  { type: "page", target: "folder/md-link", alias: "this" },
  { type: "page", target: "broken" },
  { type: "url", target: "https://example.com", alias: "external" },
  { type: "file", target: "folder/test.jpg", alias: "document" },
  { type: "file", target: "test2.jpg" },
];

function meta(name = "folder/test"): PageMeta {
  return {
    ref: name,
    name,
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };
}

async function setupSpace() {
  const { space } = createMockSystem();
  await space.writePage("page-link", "");
  await space.writePage("fm-link", "");
  await space.writePage("aliased-link", "");
  await space.writePage("folder/md-link", "");
  return space;
}

function virtualLinks(relations: any[]): LinkObject[] {
  return relations
    .filter((o) => o.tag === "relation")
    .map((r) => relationToLink(r))
    .filter((l): l is LinkObject => l !== undefined);
}

function aspiringNames(objects: any[]): string[] {
  return objects
    .filter((o) => o.tag === "aspiring-page")
    .map((o: any) => o.name)
    .sort();
}

function targetOf(l: LinkObject): string {
  return l.toPage ?? l.toFile ?? l.toURL ?? "";
}

test("virtual link inclusion: every classified target appears", async () => {
  await setupSpace();
  const tree = parseMarkdown(fixturePage);
  const fm = extractFrontMatter(tree);
  const links = virtualLinks(
    await indexRelations(meta(), fm, tree, fixturePage),
  );

  expect(links).toHaveLength(expected.length);

  const actual = links.map((l) => ({
    type: l.type,
    target: targetOf(l),
    alias: l.alias,
  })).sort((a, b) => a.target.localeCompare(b.target));

  const expectedSorted = expected.slice().sort((a, b) =>
    a.target.localeCompare(b.target)
  );
  expect(actual).toEqual(expectedSorted);
});

test("virtual link shape: each record carries the legacy fields", async () => {
  await setupSpace();
  const tree = parseMarkdown(fixturePage);
  const fm = extractFrontMatter(tree);
  const links = virtualLinks(
    await indexRelations(meta(), fm, tree, fixturePage),
  );

  for (const l of links) {
    expect(l.tag).toBe("link");
    expect(l.page).toBe("folder/test");
    expect(typeof l.pos).toBe("number");
    expect(Array.isArray(l.range)).toBe(true);
    expect(l.range![0]).toBe(l.pos);
    // Exactly one of the to{Page,File,URL} fields populated.
    const populated = [l.toPage, l.toFile, l.toURL].filter((x) =>
      x !== undefined
    );
    expect(populated).toHaveLength(1);
  }
});

test("virtual link projects attribute relations but still skips co-mention", async () => {
  createMockSystem();
  const page = `Body [attr: "[[Jack]]"] with extra [[Jack]] and [[Linda]].

\`\`\`#person
spouse: "[[Jack]]"
\`\`\`
`;
  const tree = parseMarkdown(page);
  const fm = extractFrontMatter(tree);
  const relations = await indexRelations(meta("People"), fm, tree, page);

  // Inline attributes and `#tag` data blocks now carry the attribute key
  // as their `kind` (e.g. `attr`, `spouse`), which projects into the
  // legacy `link` index. Co-mentions still have no `link` representation.
  const kinds = new Set(
    relations
      .filter((o: any) => o.tag === "relation")
      .map((o: any) => o.kind),
  );
  expect(kinds.has("attr")).toBe(true);
  expect(kinds.has("spouse")).toBe(true);
  expect(kinds.has("co-mention")).toBe(true);

  const virtual = virtualLinks(relations);
  expect(virtual.every((l) => l.type === "page")).toBe(true);
  // Both the inline attribute and the data block contribute a Jack link
  // now, alongside the two prose mentions.
  expect(new Set(virtual.map((l) => l.toPage))).toEqual(
    new Set(["Jack", "Linda"]),
  );
  expect(virtual.filter((l) => l.toPage === "Jack").length).toBe(3);
});

test("attribute relation to a document projects as a file link", async () => {
  createMockSystem();
  const page = `\`\`\`#person\nresume: "[[cv.pdf]]"\n\`\`\`\n`;
  const tree = parseMarkdown(page);
  const fm = extractFrontMatter(tree);
  const relations = await indexRelations(meta("People"), fm, tree, page);
  const links = virtualLinks(relations);
  const fileLink = links.find((l) => l.toFile === "cv.pdf");
  expect(fileLink).toBeDefined();
  expect(fileLink!.type).toBe("file");
});

test("aspiring-page set: broken wikilinks emit `aspiring-page` records", async () => {
  await setupSpace();
  // Only `broken` is intentionally not created in setupSpace.
  const tree = parseMarkdown(fixturePage);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(meta(), fm, tree, fixturePage);
  expect(aspiringNames(objects)).toEqual(["broken"]);
});
