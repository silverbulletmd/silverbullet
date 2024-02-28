import { parse } from "./parse_tree.ts";
import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
} from "$sb/lib/tree.ts";
import { assertEquals, assertNotEquals } from "$std/testing/asserts.ts";
import { extendedMarkdownLanguage } from "./parser.ts";

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

Deno.test("Test parser", () => {
  let tree = parse(extendedMarkdownLanguage, sample1);
  // console.log("tree", JSON.stringify(tree, null, 2));
  // Check if rendering back to text works
  assertEquals(renderToText(tree), sample1);

  // Find wiki link and wiki link alias
  const links = collectNodesOfType(tree, "WikiLink");
  assertEquals(links.length, 2);
  const nameNode = findNodeOfType(links[0], "WikiLinkPage");
  assertEquals(nameNode?.children![0].text, "wiki link");

  // Check if alias is parsed properly
  const aliasNode = findNodeOfType(links[1], "WikiLinkAlias");
  assertEquals(aliasNode?.children![0].text, "alias");

  // Find frontmatter
  let node = findNodeOfType(tree, "FrontMatter");
  assertNotEquals(node, undefined);
  tree = parse(extendedMarkdownLanguage, sampleInvalid1);
  node = findNodeOfType(tree, "FrontMatter");
  // console.log("Invalid node", node);
  assertEquals(node, undefined);
});

const inlineAttributeSample = `
Hello there [a link](http://zef.plus)
[age: 100]
[age:: 200]

Here's a more [ambiguous: case](http://zef.plus)

And one with nested brackets: [array: [1, 2, 3]]
`;

Deno.test("Test inline attribute syntax", () => {
  const tree = parse(extendedMarkdownLanguage, inlineAttributeSample);
  // console.log("Attribute parsed", JSON.stringify(tree, null, 2));
  const attributes = collectNodesOfType(tree, "Attribute");
  let nameNode = findNodeOfType(attributes[0], "AttributeName");
  assertEquals(nameNode?.children![0].text, "age");
  let valueNode = findNodeOfType(attributes[0], "AttributeValue");
  assertEquals(valueNode?.children![0].text, "100");

  nameNode = findNodeOfType(attributes[1], "AttributeName");
  assertEquals(nameNode?.children![0].text, "age");
  valueNode = findNodeOfType(attributes[1], "AttributeValue");
  assertEquals(valueNode?.children![0].text, "200");

  nameNode = findNodeOfType(attributes[2], "AttributeName");
  assertEquals(nameNode?.children![0].text, "array");
  valueNode = findNodeOfType(attributes[2], "AttributeValue");
  assertEquals(valueNode?.children![0].text, "[1, 2, 3]");
});

Deno.test("Test template directive parsing", () => {
  const tree = parse(
    extendedMarkdownLanguage,
    "Simple {{name}} and {{count({ page })}}",
  );
  console.log("Template directive", JSON.stringify(tree, null, 2));
});

const multiStatusTaskExample = `
* [ ] Task 1
- [x] Task 2
* [TODO] Task 3
`;

Deno.test("Test multi-status tasks", () => {
  const tree = parse(extendedMarkdownLanguage, multiStatusTaskExample);
  // console.log("Tasks parsed", JSON.stringify(tree, null, 2));
  const tasks = collectNodesOfType(tree, "Task");
  assertEquals(tasks.length, 3);
  // Check " " checkbox state parsing
  assertEquals(tasks[0].children![0].children![1].text, " ");
  assertEquals(tasks[1].children![0].children![1].text, "x");
  assertEquals(tasks[2].children![0].children![1].text, "TODO");
});

const commandLinkSample = `
{[Some: Command]}
{[Other: Command|Alias]}
{[Command: Space | Spaces ]}
`;

Deno.test("Test command links", () => {
  const tree = parse(extendedMarkdownLanguage, commandLinkSample);
  const commands = collectNodesOfType(tree, "CommandLink");
  // console.log("Command links parsed", JSON.stringify(commands, null, 2));
  assertEquals(commands.length, 3);
  assertEquals(commands[0].children![1].children![0].text, "Some: Command");
  assertEquals(commands[1].children![1].children![0].text, "Other: Command");
  assertEquals(commands[1].children![3].children![0].text, "Alias");
  assertEquals(commands[2].children![1].children![0].text, "Command: Space ");
  assertEquals(commands[2].children![3].children![0].text, " Spaces ");
});

const commandLinkArgsSample = `
{[Args: Command]("with", "args")}
{[Othargs: Command|Args alias]("other", "args", 123)}
`;

Deno.test("Test command link arguments", () => {
  const tree = parse(extendedMarkdownLanguage, commandLinkArgsSample);
  const commands = collectNodesOfType(tree, "CommandLink");
  assertEquals(commands.length, 2);

  const args1 = findNodeOfType(commands[0], "CommandLinkArgs");
  assertEquals(args1!.children![0].text, '"with", "args"');

  const args2 = findNodeOfType(commands[1], "CommandLinkArgs");
  assertEquals(args2!.children![0].text, '"other", "args", 123');
});

Deno.test("Test directive parser", () => {
  const simpleExample = `Simple {{.}}`;
  let tree = parse(extendedMarkdownLanguage, simpleExample);
  assertEquals(renderToText(tree), simpleExample);

  const eachExample = `{{#each .}}Sup{{/each}}`;
  tree = parse(extendedMarkdownLanguage, eachExample);

  const ifExample = `{{#if true}}Sup{{/if}}`;
  tree = parse(extendedMarkdownLanguage, ifExample);
  assertEquals(renderToText(tree), ifExample);

  const ifElseExample = `{{#if true}}Sup{{else}}Sup2{{/if}}`;
  tree = parse(extendedMarkdownLanguage, ifElseExample);
  assertEquals(renderToText(tree), ifElseExample);
  console.log("Final tree", JSON.stringify(tree, null, 2));

  const letExample = `{{#let @p = true}}{{/let}}`;
  tree = parse(extendedMarkdownLanguage, letExample);
  assertEquals(renderToText(tree), letExample);
});
