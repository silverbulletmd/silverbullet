import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexMarkdown } from "./indexer.ts";
import { indexRelations } from "./relation.ts";

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

  const r = objects.find(
    (o) => o.tag === "relation" && o.to === "https://example.com",
  );
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("mention");
  expect(r!.toTag).toEqual("url");
});

test("frontmatter scalar wikilink emits typed attribute relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = `---
spouse: "[[Jack]]"
---
Body.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Linda"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.kind === "spouse");
  expect(r).toBeDefined();
  expect(r!.to).toEqual("Jack");
  expect(r!.from).toEqual("Linda");
  expect(r!.range).toBeDefined();
  expect(text.substring(r!.range![0], r!.range![0] + 2)).toEqual("[[");
});

test("frontmatter list of wikilinks emits one relation per entry", async () => {
  const { space } = createMockSystem();
  await space.writePage("First_author", "");
  await space.writePage("Second_author", "");

  const text = `---
authors:
- "[[First_author]]"
- "[[Second_author]]"
---
Body.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Some_paper"), fm, tree, text);

  const authors = objects.filter(
    (o) => o.tag === "relation" && o.kind === "authors",
  );
  expect(authors.map((r) => r.to).sort()).toEqual([
    "First_author",
    "Second_author",
  ]);
  // Each entry gets its own splice-able range pointing at its own `[[`.
  for (const r of authors) {
    expect(text.substring(r.range![0], r.range![0] + 2)).toEqual("[[");
  }
  expect(new Set(authors.map((r) => r.ref)).size).toEqual(2);
});

test("frontmatter list of wikilinks works indented and in flow style", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");
  await space.writePage("B", "");

  for (const body of [
    `authors:\n  - "[[A]]"\n  - "[[B]]"`,
    `authors: ["[[A]]", "[[B]]"]`,
  ]) {
    const text = `---\n${body}\n---\nBody.`;
    const tree = parseMarkdown(text);
    const fm = extractFrontMatter(tree);
    const objects = await indexRelations(pageMeta("P"), fm, tree, text);
    const authors = objects.filter(
      (o) => o.tag === "relation" && o.kind === "authors",
    );
    expect(authors.map((r) => r.to).sort(), `for: ${body}`).toEqual(["A", "B"]);
  }
});

test("frontmatter list entries don't leak into the next key", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");
  await space.writePage("B", "");
  await space.writePage("C", "");

  const text = `---
authors:
- "[[A]]"
- "[[B]]"
publisher: "[[C]]"
---
Body.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("P"), fm, tree, text);

  const byKind = (kind: string) =>
    objects
      .filter((o) => o.tag === "relation" && o.kind === kind)
      .map((r) => r.to)
      .sort();
  expect(byKind("authors")).toEqual(["A", "B"]);
  expect(byKind("publisher")).toEqual(["C"]);
});

test("nested frontmatter key does not carry its indentation into the kind", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");

  const text = `---
meta:
  author: "[[A]]"
---
Body.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("P"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.to === "A");
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("author");
});

test("inline attribute with wikilink value emits typed attribute relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = `Some text [spouse: "[[Jack]]"] more.`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Linda"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.kind === "spouse");
  expect(r).toBeDefined();
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
    objects.filter((o) => o.tag === "relation" && o.kind === "color"),
  ).toHaveLength(0);
});

test("mention to a markdown page has toTag=page", async () => {
  const { space } = createMockSystem();
  await space.writePage("Target", "");

  const text = "Hello [[Target]].";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Src"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.kind === "mention");
  expect(r!.toTag).toEqual("page");
});

test("url relation has toTag=url", async () => {
  createMockSystem();
  const text = "[link](https://example.com)";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Src"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.toTag === "url");
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("mention");
  expect(r!.toTag).toEqual("url");
});

test("two refs in same item emit co-mention edges in both directions", async () => {
  const { space } = createMockSystem();
  await space.writePage("Linda", "");
  await space.writePage("Jack", "");

  const text = "* [[Linda]] talks to [[Jack]]";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Diary"), fm, tree, text);

  const coments = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
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

  const coments = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
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

  const coments = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
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

  const coments = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
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

  const r = objects.find((o) => o.tag === "relation" && o.kind === "mention");
  expect(r).toBeDefined();
  expect(r!.from).toMatch(/^Diary@\d+$/);
  expect(r!.fromTag).toEqual("item");
});

test("co-mention pairs attribute targets in the same item", async () => {
  const { space } = createMockSystem();
  await space.writePage("Angela", "");
  await space.writePage("Super Team", "");

  const text = `* #contact $pete Pete [spouse: "[[Angela]]"] [team: "[[Super Team]]"]`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);

  const coms = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
  );
  const pairs = new Set(coms.map((r) => `${r.from}->${r.to}`));
  expect(pairs.has("Angela->Super Team")).toBe(true);
  expect(pairs.has("Super Team->Angela")).toBe(true);
});

test("co-mention emits unique refs when target appears multiple times in different scopes", async () => {
  const { space } = createMockSystem();
  await space.writePage("A", "");
  await space.writePage("B", "");
  // [[A]] shares a (nested) scope with both occurrences of [[B]]; without
  // ref-granularity dedupe, both j-iterations would emit the same ref
  // (A's position + B's name) but with different `via` scopes.
  const text = "* outer\n  * [[A]]\n    * [[B]]\n  * also [[B]] here\n";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("P"), fm, tree, text);
  const coms = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
  );
  const refs = coms.map((r) => r.ref);
  expect(new Set(refs).size).toEqual(refs.length);
});

test("co-mention carries fromTag/toTag from target relations", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");
  await space.writePage("Linda", "");
  const text = "Both [[Jack]] and [[Linda]] are mentioned.";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Diary"), fm, tree, text);
  const coms = objects.filter(
    (o) => o.tag === "relation" && o.kind === "co-mention",
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

  const text = `* #contact $pete Pete [spouse: "[[Angela]]"] [team: "[[Super Team]]"]`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);

  const attrs = objects.filter(
    (o) => o.tag === "relation" && (o.kind === "spouse" || o.kind === "team"),
  );
  expect(attrs).toHaveLength(2);
  for (const r of attrs) {
    expect(r.from).toEqual("pete");
    expect(r.fromTag).toEqual("item");
  }
});

test("same-page anchor wikilink: to = anchor name, kind = mention", async () => {
  createMockSystem();
  const text = `* #contact $pete-ref Pete\n\nSee also [[$pete-ref]].\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);
  const mentions = objects.filter(
    (o) => o.tag === "relation" && o.kind === "mention",
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
  const text = `# $intro Intro\n\n* [ ] $todo Do something\n\nLinks: [[$intro]] [[$todo]] [[$elsewhere]]\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Notes"), fm, tree, text);
  const anchorMentions = objects.filter(
    (o) =>
      o.tag === "relation" &&
      o.kind === "mention" &&
      ["intro", "todo", "elsewhere"].includes(o.to),
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
  const r = objects.find((o) => o.tag === "relation" && o.kind === "mention");
  expect(r).toBeDefined();
  expect(r!.to).toEqual("Other");
  expect(r!.toTag).toEqual("page");
});

test("anchor wikilink inside attribute value: to = anchor name", async () => {
  createMockSystem();
  const text = `* $a Alice [friend: "[[$b]]"]\n* $b Bob\n`;
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);
  const attr = objects.find((o) => o.tag === "relation" && o.kind === "friend");
  expect(attr).toBeDefined();
  expect(attr!.to).toEqual("b");
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

  const r = objects.find((o) => o.tag === "relation" && o.kind === "mention");
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

  const r = objects.find((o) => o.tag === "relation" && o.kind === "mention");
  expect(r).toBeDefined();
  expect(r!.fromTag).toEqual("task");
  expect(r!.from).toMatch(/^Today@\d+$/);
});

test("fenced #tag data block with wikilink value emits attribute relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Jack", "");

  const text = 'Header\n\n```#person\nname: Linda\nspouse: "[[Jack]]"\n```\n';
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("People"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.kind === "spouse");
  expect(r).toBeDefined();
  expect(r!.to).toEqual("Jack");
  // `from` / `fromTag` still encode the data-block provenance.
  expect(r!.fromTag).toEqual("person");
  expect(r!.range).toBeDefined();
  expect(text.substring(r!.range![0], r!.range![0] + 2)).toEqual("[[");
});

test("document markdown link emits document relation", async () => {
  createMockSystem();
  const text = "See [doc](attachment.pdf).";
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Source"), fm, tree, text);

  const r = objects.find((o) => o.tag === "relation" && o.toTag === "document");
  expect(r).toBeDefined();
  expect(r!.kind).toEqual("mention");
  expect(r!.toTag).toEqual("document");
  expect(r!.to).toEqual("attachment.pdf");
});

test("at-mentions index as relations", async () => {
  createMockSystem();
  await (globalThis as any).syscall("index.indexObjects", "People/Pete Smith", [
    {
      ref: "People/Pete Smith",
      tag: "page",
      name: "People/Pete Smith",
      tags: ["recipient"],
      aliases: ["PeteSmith"],
    },
  ]);

  const text = [
    "Talked to @PeteSmith today.",
    "",
    "* [ ] Follow up @petesmith @Petra",
    "",
    "And @nobody is captured too.",
  ].join("\n");
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Test"), fm, tree, text);
  const atMentions = objects.filter(
    (o) => o.tag === "relation" && o.kind === "at-mention",
  );
  expect(atMentions.length).toBe(4);
  // Every mention records the nickname, never the page claiming it: which
  // page that is gets joined at read time, so index order can't change it.
  expect(atMentions[0].to).toBe("recipient:petesmith");
  expect(atMentions[0].toTag).toBe("recipient");
  expect(atMentions[0].fromTag).toBe("page");
  expect(atMentions[0].alias).toBe("PeteSmith");
  // Case-insensitive: a differently cased spelling converges, task container
  expect(atMentions[1].to).toBe("recipient:petesmith");
  expect(atMentions[1].fromTag).toBe("task");
  expect(atMentions[1].alias).toBe("petesmith");
  expect(atMentions[2].to).toBe("recipient:petra");
  expect(atMentions[2].toTag).toBe("recipient");
  expect(atMentions[2].alias).toBe("Petra");
  expect(atMentions[3].to).toBe("recipient:nobody");
  expect(atMentions[3].toTag).toBe("recipient");
  // A recipient: identifier is not a page target: no aspiring page
  expect(
    objects.filter(
      (o) =>
        o.tag === "aspiring-page" && (o as any).name.startsWith("recipient:"),
    ).length,
  ).toBe(0);
});

test("relation records flow through indexMarkdown", async () => {
  createMockSystem();
  const text = "Hello [[Target]] world.";
  const objects = await indexMarkdown(text, pageMeta("Source"));
  const relations = objects.filter((o: any) => o.tag === "relation");
  expect(relations.length).toBeGreaterThan(0);
});

test("a frontmatter recipients nickname emits a recipient relation", async () => {
  createMockSystem();
  const text = [
    "---",
    "recipients:",
    "- zef",
    "- Pete Smith",
    "---",
    "Yo there",
  ].join("\n");
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Notes"), fm, tree, text);
  const declared = objects.filter(
    (o) => o.tag === "relation" && o.kind === "recipients",
  );
  expect(declared.length).toBe(2);
  expect(declared[0].to).toBe("recipient:zef");
  expect(declared[0].toTag).toBe("recipient");
  expect(declared[0].from).toBe("Notes");
  expect(declared[0].fromTag).toBe("page");
  expect(declared[0].alias).toBe("zef");
  expect(declared[0].range).toBeUndefined();
  // Spaces are stripped the same way an alias-derived nickname is, so
  // `Pete Smith` and `@PeteSmith` converge.
  expect(declared[1].to).toBe("recipient:petesmith");
  expect(declared[1].alias).toBe("PeteSmith");
  // Each entry needs its own ref, or the second overwrites the first
  expect(declared[0].ref).not.toBe(declared[1].ref);
});

test("a frontmatter recipients wikilink stays a page relation", async () => {
  const { space } = createMockSystem();
  await space.writePage("Team/Operations", "");
  const text = [
    "---",
    "recipients:",
    "- zef",
    '- "[[Team/Operations]]"',
    "---",
    "Yo there",
  ].join("\n");
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Notes"), fm, tree, text);
  const declared = objects.filter(
    (o) => o.tag === "relation" && o.kind === "recipients",
  );
  expect(declared.length).toBe(2);
  const page = declared.find((o) => o.toTag === "page")!;
  expect(page.to).toBe("Team/Operations");
  // The wikilink form keeps its range: unlike a nickname it is link syntax
  // the rename refactor rewrites.
  expect(page.range).toBeDefined();
  expect(declared.filter((o) => o.toTag === "recipient").length).toBe(1);
});

test("a recipients declaration is summarised by the page's opening line", async () => {
  const { space } = createMockSystem();
  await space.writePage("Team/Operations", "");
  const text = [
    "---",
    "recipients:",
    "- zef",
    '- "[[Team/Operations]]"',
    "---",
    "",
    "Please review the launch plan",
    "before Friday.",
    "",
    "A second paragraph.",
  ].join("\n");
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Handoff"), fm, tree, text);
  const declared = objects.filter(
    (o) => o.tag === "relation" && o.kind === "recipients",
  );
  expect(declared.length).toBe(2);
  // Both forms: the frontmatter line a declaration was written on says
  // nothing about the page it addresses.
  for (const d of declared) {
    expect(d.snippet).toBe("Please review the launch plan");
  }
});

test("a recipients declaration on a page with no paragraph has no snippet", async () => {
  createMockSystem();
  const text = ["---", "recipients:", "- zef", "---", "# Just a heading"].join(
    "\n",
  );
  const tree = parseMarkdown(text);
  const fm = extractFrontMatter(tree);
  const objects = await indexRelations(pageMeta("Bare"), fm, tree, text);
  const declared = objects.find(
    (o) => o.tag === "relation" && o.kind === "recipients",
  )!;
  expect(declared.snippet).toBeUndefined();
});
