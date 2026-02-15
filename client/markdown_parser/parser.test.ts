import { expect, test } from "vitest";
import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parseMarkdown } from "./parser.ts";
import { extractHashtag } from "../../plug-api/lib/tags.ts";
import { renderHashtag } from "../../plugs/index/tags.ts";

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
  expect(node).not.toEqual(undefined);
  tree = parseMarkdown(sampleInvalid1);
  node = findNodeOfType(tree, "FrontMatter");
  // console.log("Invalid node", node);
  expect(node).toEqual(undefined);
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
  expect(extractHashtag("#<allow < and # inside>")).toEqual("allow < and # inside",
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
