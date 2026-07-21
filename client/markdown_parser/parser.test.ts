import { expect, test } from "vitest";
import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parseMarkdown } from "./parser.ts";
import { extractHashtag } from "../../plug-api/lib/tags.ts";
import { renderHashtag } from "../../plugs/index/tags.ts";
import { mdLinkRegex } from "./constants.ts";

const sample1 = `---
type: page
tags:
- hello
- world
---
# This is a doc

Here is a [[wiki link]] and a [[wiki link|alias]].

Supper`;

const sampleInvalid1 = `---
name: Zef
# This is a doc

Supper`;

test("Test parser", () => {
  let tree = parseMarkdown(sample1);
  // console.log("tree", JSON.stringify(tree, null, 2));
  // Check if rendering back to text works
  expect(renderToText(tree)).toEqual(sample1);

  const tree2 = parseMarkdown(sample1, 3);
  // console.log("tree", JSON.stringify(tree, null, 2));
  // Check if rendering back to text works
  expect(renderToText(tree2)).toEqual(sample1);

  // Find wiki link and wiki link alias
  const links = collectNodesOfType(tree, "WikiLink");
  expect(links.length).toEqual(2);
  const nameNode = findNodeOfType(links[0], "WikiLinkPage");
  expect(nameNode!.children![0].text).toEqual("wiki link");

  // Check if alias is parsed properly
  const aliasNode = findNodeOfType(links[1], "WikiLinkAlias");
  expect(aliasNode!.children![0].text).toEqual("alias");

  // Find frontmatter
  let node = findNodeOfType(tree, "FrontMatter");
  expect(node).not.toBeNull();
  tree = parseMarkdown(sampleInvalid1);
  node = findNodeOfType(tree, "FrontMatter");
  // console.log("Invalid node", node);
  expect(node).toBeNull();
});

const inlineAttributeSample = `
Hello there [a link](http://zef.plus)
[age: 100]
[age:: 200]

Here's a more [ambiguous: case](http://zef.plus)

And one with nested brackets: [array: [1, 2, 3]]
`;

test("Test inline attribute syntax", () => {
  const tree = parseMarkdown(inlineAttributeSample);
  // console.log("Attribute parsed", JSON.stringify(tree, null, 2));
  const attributes = collectNodesOfType(tree, "Attribute");
  let nameNode = findNodeOfType(attributes[0], "AttributeName");
  expect(nameNode!.children![0].text).toEqual("age");
  let valueNode = findNodeOfType(attributes[0], "AttributeValue");
  expect(valueNode!.children![0].text).toEqual("100");

  nameNode = findNodeOfType(attributes[1], "AttributeName");
  expect(nameNode!.children![0].text).toEqual("age");
  valueNode = findNodeOfType(attributes[1], "AttributeValue");
  expect(valueNode!.children![0].text).toEqual("200");

  nameNode = findNodeOfType(attributes[2], "AttributeName");
  expect(nameNode!.children![0].text).toEqual("array");
  valueNode = findNodeOfType(attributes[2], "AttributeValue");
  expect(valueNode!.children![0].text).toEqual("[1, 2, 3]");
});

const multiStatusTaskExample = `
* [ ] Task 1
- [x] Task 2
* [TODO] Task 3
`;

test("Test multi-status tasks", () => {
  const tree = parseMarkdown(multiStatusTaskExample);
  // console.log("Tasks parsed", JSON.stringify(tree, null, 2));
  const tasks = collectNodesOfType(tree, "Task");
  expect(tasks.length).toEqual(3);
  // Check " " checkbox state parsing
  expect(tasks[0].children![0].children![1].text).toEqual(" ");
  expect(tasks[1].children![0].children![1].text).toEqual("x");
  expect(tasks[2].children![0].children![1].text).toEqual("TODO");
});

test("Test escaped brackets in list item does not parse as task", () => {
  const tree = parseMarkdown(`- [\\[Sample Text\\]](https://example.org/)`);
  const tasks = collectNodesOfType(tree, "Task");
  expect(tasks.length).toEqual(0);
});

test("Test lua directive parser", () => {
  const simpleExample = `Simple \${query_coll("something")}`;
  console.log(JSON.stringify(parseMarkdown(simpleExample), null, 2));
});

const hashtagSample = `
Hashtags, e.g. #mytag but ignore in code \`#mytag\`.
They can contain slashes like #level/beginner, single quotes, and dashes: #Mike's-idea.
Can be just #a single letter.
But no other #interpunction: #exclamation! #question?
There is a way to write #<tag with spaces>
These cannot span #<multiple
lines>
#no#spacing also works.
Hashtags can start with number if there's something after it: #3dprint #15-52_Trip-to-NYC.
But magazine issue #1 or #123 are not hashtags.
Should support other languages, like #żółć or #井号
`;

test("Test hashtag parser", () => {
  const tree = parseMarkdown(hashtagSample);
  const hashtags = collectNodesOfType(tree, "Hashtag");
  expect(hashtags.length).toEqual(14);

  expect(hashtags[0].children![0].text).toEqual("#mytag");
  expect(hashtags[1].children![0].text).toEqual("#level/beginner");
  expect(hashtags[2].children![0].text).toEqual("#Mike's-idea");
  expect(hashtags[3].children![0].text).toEqual("#a");
  expect(hashtags[4].children![0].text).toEqual("#interpunction");
  expect(hashtags[5].children![0].text).toEqual("#exclamation");
  expect(hashtags[6].children![0].text).toEqual("#question");
  expect(hashtags[7].children![0].text).toEqual("#<tag with spaces>");
  // multiple lines not allowed
  expect(hashtags[8].children![0].text).toEqual("#no");
  expect(hashtags[9].children![0].text).toEqual("#spacing");
  expect(hashtags[10].children![0].text).toEqual("#3dprint");
  expect(hashtags[11].children![0].text).toEqual("#15-52_Trip-to-NYC");
  expect(hashtags[12].children![0].text).toEqual("#żółć");
  expect(hashtags[13].children![0].text).toEqual("#井号");
});

test("Test hashtag helper functions", () => {
  expect(extractHashtag("#name")).toEqual("name");
  expect(extractHashtag("#123-content")).toEqual("123-content");
  expect(extractHashtag("#<escaped tag>")).toEqual("escaped tag");
  expect(extractHashtag("#<allow < and # inside>")).toEqual(
    "allow < and # inside",
  );

  expect(renderHashtag("simple")).toEqual("#simple");
  expect(renderHashtag("123-content")).toEqual("#123-content");
  expect(renderHashtag("with spaces")).toEqual("#<with spaces>");
  expect(renderHashtag("single'quote")).toEqual("#single'quote");
  // should behave like this for all characters in tagRegex
  expect(renderHashtag("exclamation!")).toEqual("#<exclamation!>");
});

const nakedURLSample = `
http://abc.com is a URL
Also http://no-trailing-period.com. That's a URL. It ends with m, not '.'.
http://no-trailing-comma.com, that same a URL, ends with m (and not ',').
http://trailing-slash.com/. That ends with '/' (still not '.').
http://abc.com?e=2.71,pi=3.14 is a URL too.
http://abc.com?e=2.71. That is a URL, which ends with 1 (and not '.').
`;

test("Test NakedURL parser", () => {
  const tree = parseMarkdown(nakedURLSample);
  const urls = collectNodesOfType(tree, "NakedURL");

  expect(urls.map((x) => x.children![0].text)).toEqual([
    "http://abc.com",
    "http://no-trailing-period.com",
    "http://no-trailing-comma.com",
    "http://trailing-slash.com/",
    "http://abc.com?e=2.71,pi=3.14",
    "http://abc.com?e=2.71",
  ]);
});

const tableSample = `
| Header A | Header B |
|----------|----------|
| [[Wiki|Alias]] | 1B |
| 2A             | 2B |
`;

test("Test table parser", () => {
  const tree = parseMarkdown(tableSample);
  const cells = collectNodesOfType(tree, "TableCell");

  expect(cells.map((x) => x.children![0].text)).toEqual([
    "Header A",
    "Header B",
    undefined,
    "1B",
    "2A",
    "2B",
  ]);

  // Check the Wiki Link - Make sure no backslash has been added (issue 943)
  expect(cells[2].children![0].type).toEqual("WikiLink");
  const wikiName = findNodeOfType(cells[2], "WikiLinkPage");
  const wikiAlias = findNodeOfType(cells[2], "WikiLinkAlias");
  expect(wikiName!.children![0].text).toEqual("Wiki");
  expect(wikiAlias!.children![0].text).toEqual("Alias");
});

// Table parsing: bracket-depth pipe protection
const tableEdgeCases = `
| Col A | Col B | Col C |
|-------|-------|-------|
| [[page|alias]] | **bold** | plain |
| [[page]] | #tag | [attr: val] |
| [attr: a|b] | [[w|x]] | text |
| [arr: [1, 2|3]] | normal | end |
| \\| escaped | col2 | col3 |
| mixed [[l|a]] and [x: y|z] | last | cell |
| **b** *i* ~s~ | \`code\\|pipe\` | end |
`;

test("Test table parser with bracket-depth pipe protection", () => {
  const tree = parseMarkdown(tableEdgeCases);
  const rows = collectNodesOfType(tree, "TableRow");
  expect(rows.length).toBe(7);

  // Row 1: [[page|alias]] | **bold** | plain
  const row1Cells = collectNodesOfType(rows[0], "TableCell");
  expect(row1Cells.length).toBe(3);

  const wl = findNodeOfType(row1Cells[0], "WikiLink");
  expect(wl).not.toBeUndefined();
  expect(findNodeOfType(wl!, "WikiLinkPage")!.children![0].text).toBe("page");
  expect(findNodeOfType(wl!, "WikiLinkAlias")!.children![0].text).toBe("alias");

  const bold = findNodeOfType(row1Cells[1], "StrongEmphasis");
  expect(bold).not.toBeUndefined();

  expect(renderToText(row1Cells[2]).trim()).toBe("plain");

  // Row 2: [[page]] | #tag | [attr: val]
  const row2Cells = collectNodesOfType(rows[1], "TableCell");
  expect(row2Cells.length).toBe(3);
  expect(findNodeOfType(row2Cells[0], "WikiLink")).not.toBeUndefined();
  expect(findNodeOfType(row2Cells[1], "Hashtag")).not.toBeUndefined();
  expect(findNodeOfType(row2Cells[2], "Attribute")).not.toBeUndefined();
  const an = findNodeOfType(row2Cells[2], "AttributeName");
  expect(an!.children![0].text).toBe("attr");
  const av = findNodeOfType(row2Cells[2], "AttributeValue");
  expect(av!.children![0].text).toBe("val");

  // Row 3: [attr: a|b] | [[w|x]] | text
  const row3Cells = collectNodesOfType(rows[2], "TableCell");
  expect(row3Cells.length).toBe(3);
  const attr3 = findNodeOfType(row3Cells[0], "Attribute");
  expect(attr3).not.toBeUndefined();
  expect(findNodeOfType(attr3!, "AttributeValue")!.children![0].text).toBe(
    "a|b",
  );
  const wl3 = findNodeOfType(row3Cells[1], "WikiLink");
  expect(wl3).not.toBeUndefined();
  expect(findNodeOfType(wl3!, "WikiLinkAlias")!.children![0].text).toBe("x");

  // Row 4: [arr: [1, 2|3]] | normal | end
  const row4Cells = collectNodesOfType(rows[3], "TableCell");
  expect(row4Cells.length).toBe(3);
  const attr4 = findNodeOfType(row4Cells[0], "Attribute");
  expect(attr4).not.toBeUndefined();
  expect(findNodeOfType(attr4!, "AttributeValue")!.children![0].text).toBe(
    "[1, 2|3]",
  );

  // Row 5: \| escaped | col2 | col3
  const row5Cells = collectNodesOfType(rows[4], "TableCell");
  expect(row5Cells.length).toBe(3);
  expect(renderToText(row5Cells[0])).toContain("|");

  // Row 6: mixed [[l|a]] and [x: y|z] | last | cell
  const row6Cells = collectNodesOfType(rows[5], "TableCell");
  expect(row6Cells.length).toBe(3);
  expect(findNodeOfType(row6Cells[0], "WikiLink")).not.toBeUndefined();
  expect(findNodeOfType(row6Cells[0], "Attribute")).not.toBeUndefined();

  // Row 7: **b** *i* ~s~ | `code\|pipe` | end
  const row7Cells = collectNodesOfType(rows[6], "TableCell");
  expect(row7Cells.length).toBe(3);
  expect(findNodeOfType(row7Cells[0], "StrongEmphasis")).not.toBeUndefined();
  expect(findNodeOfType(row7Cells[0], "Emphasis")).not.toBeUndefined();
  expect(findNodeOfType(row7Cells[1], "InlineCode")).not.toBeUndefined();
});

const tableNoCmdButton = `
| A | B |
|---|---|
| {[not|cmd]} | text |
`;

test("Test table parser does not treat {[...]} specially", () => {
  const tree = parseMarkdown(tableNoCmdButton);
  const rows = collectNodesOfType(tree, "TableRow");
  expect(rows.length).toBe(1);
  // The pipe in {[not|cmd]} is inside brackets, so bracket-depth protects it
  // but only because of the [ — not because of {[ special-casing
  const row1Cells = collectNodesOfType(rows[0], "TableCell");
  expect(row1Cells.length).toBe(2);
});

// Links with escaped square brackets
test("Test markdown links with escaped square brackets", () => {
  // Parser should produce a Link node for escaped brackets
  const tree = parseMarkdown(`[\\[link\\]](address)`);
  const links = collectNodesOfType(tree, "Link");
  expect(links.length).toBe(1);

  // Should contain Escape nodes for the brackets
  const escapes = collectNodesOfType(links[0], "Escape");
  expect(escapes.length).toBe(2);
  expect(escapes[0].children![0].text).toBe("\\[");
  expect(escapes[1].children![0].text).toBe("\\]");

  // Should have a URL node
  const urlNode = findNodeOfType(links[0], "URL");
  expect(urlNode).not.toBeUndefined();
  expect(urlNode!.children![0].text).toBe("address");

  // Full roundtrip
  expect(renderToText(tree)).toBe(`[\\[link\\]](address)`);
});

test("Anchor parsing", () => {
  const tree = parseMarkdown(
    `
This paragraph carries an anchor $toc1 inline.

- Item with anchor $tasks/7

- [ ] Task body $work-1

# Header with anchor $sec1

Inline code with \`$ignored\` should not parse as anchor.

\`\`\`
fenced $alsoIgnored
\`\`\`

Bare $ alone is not an anchor.

A $100 dollar bill (digit-leading is not an anchor).
`,
  );
  const anchors = collectNodesOfType(tree, "NamedAnchor").map((n) =>
    renderToText(n),
  );
  expect(anchors).toEqual(["$toc1", "$tasks/7", "$work-1", "$sec1"]);
});

test("Test mdLinkRegex with escaped square brackets", () => {
  // Normal link
  mdLinkRegex.lastIndex = 0;
  let match = mdLinkRegex.exec("[link](address)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("link");
  expect(match!.groups!.url).toBe("address");

  // Escaped brackets in link text (issue #1896)
  mdLinkRegex.lastIndex = 0;
  match = mdLinkRegex.exec("[\\[link\\]](address)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("\\[link\\]");
  expect(match!.groups!.url).toBe("address");

  // Escaped brackets with other text
  mdLinkRegex.lastIndex = 0;
  match = mdLinkRegex.exec("[see \\[ref\\] here](http://example.com)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("see \\[ref\\] here");
  expect(match!.groups!.url).toBe("http://example.com");

  // Image with escaped brackets
  mdLinkRegex.lastIndex = 0;
  match = mdLinkRegex.exec("![\\[img\\]](image.png)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("\\[img\\]");
  expect(match!.groups!.url).toBe("image.png");

  // Other escaped characters (backslash itself)
  mdLinkRegex.lastIndex = 0;
  match = mdLinkRegex.exec("[a\\\\b](url)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("a\\\\b");
  expect(match!.groups!.url).toBe("url");

  // Normal link still works (no regressions)
  mdLinkRegex.lastIndex = 0;
  match = mdLinkRegex.exec("[simple text](http://example.com)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("simple text");

  // Empty title still works
  mdLinkRegex.lastIndex = 0;
  match = mdLinkRegex.exec("[](url)");
  expect(match).not.toBeNull();
  expect(match!.groups!.title).toBe("");
});
