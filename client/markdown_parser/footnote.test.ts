import { expect, test } from "vitest";
import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { parseMarkdown } from "./parser.ts";

const footnoteRefSample = `Here is a footnote[^1] and another[^my-note].`;

test("Test footnote ref parser", () => {
  const tree = parseMarkdown(footnoteRefSample);
  const refs = collectNodesOfType(tree, "FootnoteRef");
  expect(refs.length).toEqual(2);

  const label1 = findNodeOfType(refs[0], "FootnoteRefLabel");
  expect(label1!.children![0].text).toEqual("1");

  const label2 = findNodeOfType(refs[1], "FootnoteRefLabel");
  expect(label2!.children![0].text).toEqual("my-note");

  expect(renderToText(tree)).toEqual(footnoteRefSample);
});

test("Unclosed footnote ref does not parse", () => {
  const tree = parseMarkdown("This is [^ not a footnote");
  const refs = collectNodesOfType(tree, "FootnoteRef");
  expect(refs.length).toEqual(0);
});

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

const inlineFootnoteSample = `This has an inline footnote^[some content here] in it.`;

test("Test inline footnote parser", () => {
  const tree = parseMarkdown(inlineFootnoteSample);
  const fns = collectNodesOfType(tree, "InlineFootnote");
  expect(fns.length).toEqual(1);

  const content = findNodeOfType(fns[0], "InlineFootnoteContent");
  expect(content!.children![0].text).toEqual("some content here");

  expect(renderToText(tree)).toEqual(inlineFootnoteSample);
});
