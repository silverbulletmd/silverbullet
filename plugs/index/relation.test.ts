import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexRelations } from "./relation.ts";
import { indexMarkdown } from "./indexer.ts";

function pageMeta(name = "Test"): PageMeta {
  return {
    ref: name,
    name,
    tag: "page",
    created: "",
    lastModified: "2026-05-19T00:00:00Z",
    perm: "rw",
  };
}

test("emits no records for an empty page", async () => {
  createMockSystem();
  const text = "";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta(), fm, tree, text);
  expect(objects).toEqual([]);
});

test("body wikilink emits a mention relation rooted at the page", async () => {
  const { space } = createMockSystem();
  await space.writePage("Target", "");

  const text = "Hello [[Target]] world.";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Source"), fm, tree, text);

  const relations = objects.filter((o) => o.tag === "relation");
  expect(relations).toHaveLength(1);
  const [r] = relations;
  expect(r.kind).toEqual("mention");
  expect(r.from).toEqual("Source");
  expect(r.fromTag).toEqual("page");
  expect(r.to).toEqual("Target");
  expect(r.type).toBeUndefined();
  expect(r.alias).toBeUndefined();
  expect(r.range).toEqual([text.indexOf("[["), text.indexOf("]]") + 2]);
  expect(text.substring(r.range![0], r.range![1])).toEqual("[[Target]]");
});

test("body wikilink with alias preserves alias", async () => {
  const { space } = createMockSystem();
  await space.writePage("Target", "");

  const text = "See [[Target|the target]].";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Source"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation");
  expect(r).toBeDefined();
  expect(r!.alias).toEqual("the target");
});

test("local markdown link emits mention relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Target", "");

  const text = "See [the target](Target.md).";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Source"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation");
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("mention");
  expect(r!.to).toEqual("Target");
  expect(r!.alias).toEqual("the target");
});

test("external markdown link emits url relation", async () => {
  createMockSystem();
  const text = "Go to [home](https://example.com).";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Source"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation");
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("url");
  expect(r!.to).toEqual("https://example.com");
});

test("frontmatter scalar wikilink emits typed frontmatter relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = `---
spouse: "[[Jack]]"
---
Body.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Linda"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "frontmatter"
  );
  expect(r).toBeDefined();
  expect(r!.type).toEqual("spouse");
  expect(r!.to).toEqual("Jack");
  expect(r!.from).toEqual("Linda");
  expect(r!.range).toBeDefined();
  expect(text.substring(r!.range![0], r!.range![0] + 2)).toEqual("[[");
});

test("inline attribute with wikilink value emits typed attribute relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = `Some text [spouse: "[[Jack]]"] more.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Linda"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "attribute"
  );
  expect(r).toBeDefined();
  expect(r!.type).toEqual("spouse");
  expect(r!.to).toEqual("Jack");
  expect(r!.range).toBeDefined();
  expect(text.substring(r!.range![0], r!.range![0] + 2)).toEqual("[[");
});

test("inline attribute without a wikilink emits no relation", async () => {
  createMockSystem();
  const text = `Note [color: "red"] here.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("X"), fm, tree, text);

  expect(
    objects.filter((o) => o.tag === "relation" && o.kind === "attribute"),
  ).toHaveLength(0);
});

test("mention to a markdown page has toTag=page", async () => {
  const { space } = createMockSystem();
  await space.writePage("Target", "");

  const text = "Hello [[Target]].";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Src"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "mention"
  );
  expect(r!.toTag).toEqual("page");
});

test("url relation has no toTag", async () => {
  createMockSystem();
  const text = "[link](https://example.com)";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Src"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "url"
  );
  expect(r!.toTag).toBeUndefined();
});

test("two refs in same item emit co-mention edges in both directions", async () => {
  const { space } = createMockSystem();
  await space.writePage("Linda", "");
  await space.writePage("Jack", "");

  const text = "* [[Linda]] talks to [[Jack]]";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Diary"), fm, tree, text);

  const coments = objects.filter((o) =>
    o.tag === "relation" && o.kind === "co-mention"
  );
  expect(coments).toHaveLength(2);
  const pairs = new Set(coments.map((r) => `${r.from}->${r.to}`));
  expect(pairs.has("Linda->Jack")).toBe(true);
  expect(pairs.has("Jack->Linda")).toBe(true);
  expect(coments[0].via).toMatch(/^Diary@\d+$/);
});

test("nested-child refs co-mention with parent item", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");
  await space.writePage("B", "");

  const text = "* [[A]]\n  * [[B]]\n";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Page"), fm, tree, text);

  const coments = objects.filter((o) =>
    o.tag === "relation" && o.kind === "co-mention"
  );
  expect(coments).toHaveLength(2);
});

test("two refs in same paragraph (no list) emit co-mention", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");
  await space.writePage("B", "");

  const text = "Both [[A]] and [[B]] went hiking.\n";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Page"), fm, tree, text);

  const coments = objects.filter((o) =>
    o.tag === "relation" && o.kind === "co-mention"
  );
  expect(coments).toHaveLength(2);
});

test("two refs in different paragraphs emit no co-mention", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");
  await space.writePage("B", "");

  const text = "First [[A]].\n\nSecond [[B]].\n";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Page"), fm, tree, text);

  const coments = objects.filter((o) =>
    o.tag === "relation" && o.kind === "co-mention"
  );
  expect(coments).toHaveLength(0);
});

test("wikilink inside list item: from = item ref, fromTag = item", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = "* Note about [[Jack]] today.";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Diary"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "mention"
  );
  expect(r).toBeDefined();
  expect(r!.from).toMatch(/^Diary@\d+$/);
  expect(r!.fromTag).toEqual("item");
});

test("co-mention pairs attribute targets in the same item", async () => {
  const { space } = createMockSystem();
  await space.writePage("Angela", "");
  await space.writePage("Super Team", "");

  const text =
    `* #contact $pete Pete [spouse: "[[Angela]]"] [team: "[[Super Team]]"]`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);

  const coms = objects.filter((o) =>
    o.tag === "relation" && o.kind === "co-mention"
  );
  const pairs = new Set(coms.map((r) => `${r.from}->${r.to}`));
  expect(pairs.has("Angela->Super Team")).toBe(true);
  expect(pairs.has("Super Team->Angela")).toBe(true);
});

test("co-mention carries fromTag/toTag from target relations", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");
  await space.writePage("Linda", "");
  const text = "Both [[Jack]] and [[Linda]] are mentioned.";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Diary"), fm, tree, text);
  const coms = objects.filter((o) =>
    o.tag === "relation" && o.kind === "co-mention"
  );
  expect(coms).toHaveLength(2);
  for (const r of coms) {
    expect(r.fromTag).toEqual("page");
    expect(r.toTag).toEqual("page");
    // Range anchors at the source-side wikilink.
    expect(r.range).toBeDefined();
    expect(text.substring(r.range![0], r.range![0] + 2)).toEqual("[[");
    // Snippet is inherited from the source-side mention.
    expect(r.snippet).toBeTruthy();
  }
});

test("tagged item with $anchor: from = anchor name", async () => {
  const { space } = createMockSystem();
  await space.writePage("Angela", "");
  await space.writePage("Super Team", "");

  const text =
    `* #contact $pete Pete [spouse: "[[Angela]]"] [team: "[[Super Team]]"]`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);

  const attrs = objects.filter((o) =>
    o.tag === "relation" && o.kind === "attribute"
  );
  expect(attrs).toHaveLength(2);
  for (const r of attrs) {
    expect(r.from).toEqual("pete");
    expect(r.fromTag).toEqual("item");
  }
});

test("same-page anchor wikilink: to = anchor name, kind = mention", async () => {
  createMockSystem();
  const text =
    `* #contact $pete-ref Pete\n\nSee also [[$pete-ref]].\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);
  const mentions = objects.filter((o) =>
    o.tag === "relation" && o.kind === "mention"
  );
  expect(mentions).toHaveLength(1);
  expect(mentions[0].to).toEqual("pete-ref");
  // Anchors are space-global; the relation indexer doesn't try to
  // resolve which kind of block the anchor lives on. The meta-tag
  // `anchor` flags the target as anchor-shaped.
  expect(mentions[0].toTag).toEqual("anchor");
  expect(mentions[0].from).toEqual("People");
});

test("anchor wikilinks: toTag = 'anchor' regardless of host block type", async () => {
  createMockSystem();
  const text =
    `# $intro Intro\n\n* [ ] $todo Do something\n\nLinks: [[$intro]] [[$todo]] [[$elsewhere]]\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Notes"), fm, tree, text);
  const anchorMentions = objects.filter((o) =>
    o.tag === "relation" && o.kind === "mention" &&
    ["intro", "todo", "elsewhere"].includes(o.to)
  );
  expect(anchorMentions).toHaveLength(3);
  for (const r of anchorMentions) {
    expect(r.toTag).toEqual("anchor");
  }
});

test("same-page non-anchor wikilinks ([[#Header]], [[@123]]) emit no relation", async () => {
  createMockSystem();
  const text = `# Heading\n\nSee [[#Heading]] and [[@5]].\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Notes"), fm, tree, text);
  const rels = objects.filter((o) => o.tag === "relation");
  expect(rels).toHaveLength(0);
});

test("cross-page anchor wikilink: to = page (anchor segment is UI nav)", async () => {
  const { space } = createMockSystem();
  await space.writePage("Other", "");
  const text = `See [[Other$pete]].`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Notes"), fm, tree, text);
  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "mention"
  );
  expect(r).toBeDefined();
  expect(r!.to).toEqual("Other");
  expect(r!.toTag).toEqual("page");
});

test("anchor wikilink inside attribute value: to = anchor name", async () => {
  createMockSystem();
  const text =
    `* $a Alice [friend: "[[$b]]"]\n* $b Bob\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);
  const attr = objects.find((o) =>
    o.tag === "relation" && o.kind === "attribute"
  );
  expect(attr).toBeDefined();
  expect(attr!.to).toEqual("b");
  expect(attr!.type).toEqual("friend");
  expect(attr!.from).toEqual("a");
});

test("anchor on sub-list item does not bleed into parent item ref", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  // Parent has no anchor; child has $kid. Parent's [[Jack]] should
  // stay at byte-offset ref, not pick up the child's anchor.
  const text = "* Note about [[Jack]] today.\n  * $kid Sub item\n";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Diary"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "mention"
  );
  expect(r).toBeDefined();
  expect(r!.from).toMatch(/^Diary@\d+$/);
});

test("wikilink inside task: fromTag = task", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = "* [ ] Call [[Jack]]";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Today"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "mention"
  );
  expect(r).toBeDefined();
  expect(r!.fromTag).toEqual("task");
  expect(r!.from).toMatch(/^Today@\d+$/);
});

test("fenced #tag data block with wikilink value emits data relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text =
    "Header\n\n```#person\nname: Linda\nspouse: \"[[Jack]]\"\n```\n";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);

  const r = objects.find((o) =>
    o.tag === "relation" && o.kind === "data"
  );
  expect(r).toBeDefined();
  expect(r!.type).toEqual("spouse");
  expect(r!.to).toEqual("Jack");
  expect(r!.range).toBeDefined();
  expect(text.substring(r!.range![0], r!.range![0] + 2)).toEqual("[[");
});

test("document markdown link emits document relation", async () => {
  createMockSystem();
  const text = "See [doc](attachment.pdf).";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Source"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation");
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("document");
  expect(r!.to).toEqual("attachment.pdf");
});

test("relation records flow through indexMarkdown", async () => {
  createMockSystem();
  const text = "Hello [[Target]] world.";
  const objects = await indexMarkdown(text, pageMeta("Source"));
  const relations = objects.filter((o: any) => o.tag === "relation");
  expect(relations.length).toBeGreaterThan(0);
});
