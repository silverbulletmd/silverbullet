import { expect, test } from "vitest";
import {
  collectNodesOfType,
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { buildExtendedMarkdownLanguage } from "./parser.ts";
import { parse } from "./parse_tree.ts";

test("Custom inline syntax - basic", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $E=mc^2$ world");
  const nodes = collectNodesOfType(tree, "LatexInline");
  expect(nodes.length).toEqual(1);
  // Body between markers
  const body = findNodeOfType(nodes[0], "LatexInlineBody");
  expect(body!.children![0].text).toEqual("E=mc^2");
  // Markers are present
  const marks = collectNodesOfType(nodes[0], "LatexInlineMark");
  expect(marks.length).toEqual(2);
  // Round-trip
  expect(renderToText(tree)).toEqual("Hello $E=mc^2$ world");
});

test("Custom block syntax - basic", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexBlock: {
      name: "LatexBlock",
      startMarker: "^\\$\\$$",
      endMarker: "^\\$\\$$",
      mode: "block",
    },
  });
  const tree = parse(lang, "$$\nE=mc^2\n$$");
  const nodes = collectNodesOfType(tree, "LatexBlock");
  expect(nodes.length).toEqual(1);
  const body = findNodeOfType(nodes[0], "LatexBlockBody");
  expect(body!.children![0].text).toContain("E=mc^2");
  expect(renderToText(tree)).toEqual("$$\nE=mc^2\n$$");
});

test("Custom inline syntax - unclosed marker", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $unclosed");
  const nodes = collectNodesOfType(tree, "LatexInline");
  expect(nodes.length).toEqual(0);
});

test("Custom inline syntax - empty body", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $$ world");
  const nodes = collectNodesOfType(tree, "LatexInline");
  expect(nodes.length).toEqual(1);
});

test("Multiple custom syntax extensions", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
    CustomHighlight: {
      name: "CustomHighlight",
      startMarker: "%%",
      endMarker: "%%",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $math$ and %%highlight%%");
  expect(collectNodesOfType(tree, "LatexInline").length).toEqual(1);
  expect(collectNodesOfType(tree, "CustomHighlight").length).toEqual(1);
});

test("Custom block syntax - multi-line", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexBlock: {
      name: "LatexBlock",
      startMarker: "^\\$\\$$",
      endMarker: "^\\$\\$$",
      mode: "block",
    },
  });
  const tree = parse(lang, "Before\n\n$$\nline1\nline2\n$$\n\nAfter");
  const nodes = collectNodesOfType(tree, "LatexBlock");
  expect(nodes.length).toEqual(1);
});

test("Custom syntax doesn't break existing syntax", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
  });
  const tree = parse(lang, "A [[wiki link]] and $math$");
  expect(collectNodesOfType(tree, "WikiLink").length).toEqual(1);
  expect(collectNodesOfType(tree, "LatexInline").length).toEqual(1);
});

test("Custom block syntax - unclosed block", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexBlock: {
      name: "LatexBlock",
      startMarker: "^\\$\\$$",
      endMarker: "^\\$\\$$",
      mode: "block",
    },
  });
  const tree = parse(lang, "$$\nunclosed content");
  const nodes = collectNodesOfType(tree, "LatexBlock");
  expect(nodes.length).toEqual(0);
});

test("Custom inline syntax - escaped end marker", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $a\\$b$ world");
  const nodes = collectNodesOfType(tree, "LatexInline");
  expect(nodes.length).toEqual(1);
  const body = findNodeOfType(nodes[0], "LatexInlineBody");
  expect(body!.children![0].text).toEqual("a\\$b");
  expect(renderToText(tree)).toEqual("Hello $a\\$b$ world");
});

test("Custom inline syntax - escaped backslash before end marker", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$",
      endMarker: "\\$",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $a\\\\$ world");
  const nodes = collectNodesOfType(tree, "LatexInline");
  expect(nodes.length).toEqual(1);
  const body = findNodeOfType(nodes[0], "LatexInlineBody");
  expect(body!.children![0].text).toEqual("a\\\\");
  expect(renderToText(tree)).toEqual("Hello $a\\\\$ world");
});

test("Custom inline syntax - $ with lookahead doesn't clash with ${expr}", () => {
  const lang = buildExtendedMarkdownLanguage({
    LatexInline: {
      name: "LatexInline",
      startMarker: "\\$(?!\\{)",
      endMarker: "\\$(?!\\{)",
      mode: "inline",
    },
  });
  const tree = parse(lang, "Hello $math ${expr} more$ world");
  const nodes = collectNodesOfType(tree, "LatexInline");
  expect(nodes.length).toEqual(1);
  const body = findNodeOfType(nodes[0], "LatexInlineBody");
  expect(body!.children![0].text).toEqual("math ${expr} more");
  expect(renderToText(tree)).toEqual("Hello $math ${expr} more$ world");
});

test("No custom extensions returns default language", () => {
  const lang1 = buildExtendedMarkdownLanguage();
  const lang2 = buildExtendedMarkdownLanguage({});
  // Both should return the same static instance
  expect(lang1).toBe(lang2);
});
