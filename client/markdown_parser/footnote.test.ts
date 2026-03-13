import { expect, test } from "vitest";
import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parseMarkdown } from "./parser.ts";

// Footnote ref tests

const footnoteRefSample = `Here is a footnote[^1] and another[^my-note].`;

test("Test footnote ref parser", () => {
  const tree = parseMarkdown(footnoteRefSample);
  const refs = collectNodesOfType(tree, "FootnoteRef");
  expect(refs.length).toEqual(2);

  const label1 = findNodeOfType(refs[0], "FootnoteRefLabel");
  expect(label1!.children![0].text).toEqual("1");

  const label2 = findNodeOfType(refs[1], "FootnoteRefLabel");
  expect(label2!.children![0].text).toEqual("my-note");

  // Round-trip
  expect(renderToText(tree)).toEqual(footnoteRefSample);
});

test("Unclosed footnote ref does not parse", () => {
  const tree = parseMarkdown("This is [^ not a footnote");
  const refs = collectNodesOfType(tree, "FootnoteRef");
  expect(refs.length).toEqual(0);
});

test("Footnote ref inside list item", () => {
  const tree = parseMarkdown("* Item with ref[^x]");
  const refs = collectNodesOfType(tree, "FootnoteRef");
  expect(refs.length).toEqual(1);
  expect(
    findNodeOfType(refs[0], "FootnoteRefLabel")!.children![0].text,
  ).toEqual("x");
});

// Footnote definition tests

const footnoteDefSample = `[^1]: This is a footnote definition.`;

test("Test footnote definition parser", () => {
  const tree = parseMarkdown(footnoteDefSample);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const label = findNodeOfType(defs[0], "FootnoteDefLabel");
  expect(label!.children![0].text).toEqual("1");

  const body = findNodeOfType(defs[0], "FootnoteDefBody");
  expect(body!.children![0].text).toContain("This is a footnote definition.");
});

const multipleDefsSample = `[^1]: First footnote.

[^2]: Second footnote.`;

test("Multiple footnote definitions", () => {
  const tree = parseMarkdown(multipleDefsSample);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(2);

  const label1 = findNodeOfType(defs[0], "FootnoteDefLabel");
  expect(label1!.children![0].text).toEqual("1");

  const label2 = findNodeOfType(defs[1], "FootnoteDefLabel");
  expect(label2!.children![0].text).toEqual("2");
});

const footnoteFullSample = `Text with a ref[^1] here.

[^1]: The definition.`;

test("Document with refs and definitions round-trips", () => {
  const tree = parseMarkdown(footnoteFullSample);
  expect(renderToText(tree)).toEqual(footnoteFullSample);

  const refs = collectNodesOfType(tree, "FootnoteRef");
  expect(refs.length).toEqual(1);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);
});

// Footnote definition with markup

test("Footnote definition with bold and italic", () => {
  const tree = parseMarkdown("[^1]: This is **bold** and _italic_ text.");
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const body = findNodeOfType(defs[0], "FootnoteDefBody");
  expect(findNodeOfType(body!, "StrongEmphasis")).not.toBeUndefined();
  expect(findNodeOfType(body!, "Emphasis")).not.toBeUndefined();
  expect(renderToText(tree)).toEqual(
    "[^1]: This is **bold** and _italic_ text.",
  );
});

// Multi-line footnote definitions

test("Multi-line footnote definition with 4-space indent", () => {
  const src = `[^1]: First line of the footnote.
    Second line continues here.
    Third line as well.`;
  const tree = parseMarkdown(src);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const body = findNodeOfType(defs[0], "FootnoteDefBody");
  const bodyText = renderToText(body!);
  expect(bodyText).toContain("First line");
  expect(bodyText).toContain("Second line");
  expect(bodyText).toContain("Third line");
  expect(renderToText(tree)).toEqual(src);
});

test("Multi-line footnote definition with tab indent", () => {
  const src = "[^1]: First line.\n\tContinuation with tab.";
  const tree = parseMarkdown(src);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const bodyText = renderToText(findNodeOfType(defs[0], "FootnoteDefBody")!);
  expect(bodyText).toContain("Continuation with tab");
});

test("Multi-line footnote with blank line between paragraphs", () => {
  const src = `[^1]: First paragraph.

    Second paragraph after blank line.`;
  const tree = parseMarkdown(src);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const bodyText = renderToText(findNodeOfType(defs[0], "FootnoteDefBody")!);
  expect(bodyText).toContain("First paragraph");
  expect(bodyText).toContain("Second paragraph");
});

test("Multi-line footnote definition with markup", () => {
  const src = `[^note]: This has **bold** on the first line.
    And _italic_ on the continuation.`;
  const tree = parseMarkdown(src);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const body = findNodeOfType(defs[0], "FootnoteDefBody");
  expect(findNodeOfType(body!, "StrongEmphasis")).not.toBeUndefined();
  expect(findNodeOfType(body!, "Emphasis")).not.toBeUndefined();
});

test("Multi-line footnote stops at non-indented line", () => {
  const src = `[^1]: Footnote body.
    Continuation.

Regular paragraph.`;
  const tree = parseMarkdown(src);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const bodyText = renderToText(findNodeOfType(defs[0], "FootnoteDefBody")!);
  expect(bodyText).toContain("Continuation");
  expect(bodyText).not.toContain("Regular paragraph");
});

test("2-space indent does not continue footnote", () => {
  const src = `[^1]: First line.
  Not a continuation.`;
  const tree = parseMarkdown(src);
  const defs = collectNodesOfType(tree, "FootnoteDefinition");
  expect(defs.length).toEqual(1);

  const bodyText = renderToText(findNodeOfType(defs[0], "FootnoteDefBody")!);
  expect(bodyText).not.toContain("Not a continuation");
});

// Inline footnote tests

const inlineFootnoteSample = `This has an inline footnote^[some content here] in it.`;

test("Test inline footnote parser", () => {
  const tree = parseMarkdown(inlineFootnoteSample);
  const fns = collectNodesOfType(tree, "InlineFootnote");
  expect(fns.length).toEqual(1);

  const content = findNodeOfType(fns[0], "InlineFootnoteContent");
  expect(content!.children![0].text).toEqual("some content here");

  // Round-trip
  expect(renderToText(tree)).toEqual(inlineFootnoteSample);
});

test("Multiple inline footnotes", () => {
  const tree = parseMarkdown("A^[first] and B^[second].");
  const fns = collectNodesOfType(tree, "InlineFootnote");
  expect(fns.length).toEqual(2);

  expect(
    findNodeOfType(fns[0], "InlineFootnoteContent")!.children![0].text,
  ).toEqual("first");
  expect(
    findNodeOfType(fns[1], "InlineFootnoteContent")!.children![0].text,
  ).toEqual("second");
});

test("Unclosed inline footnote does not parse", () => {
  const tree = parseMarkdown("This is ^[not closed");
  const fns = collectNodesOfType(tree, "InlineFootnote");
  expect(fns.length).toEqual(0);
});

test("Empty inline footnote does not parse", () => {
  const tree = parseMarkdown("This is ^[] empty");
  const fns = collectNodesOfType(tree, "InlineFootnote");
  expect(fns.length).toEqual(0);
});
