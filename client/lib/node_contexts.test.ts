import { codeFolding, foldEffect } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  contextsAt,
  matchesNodeContexts,
  PSEUDO_CONTEXTS,
} from "./node_contexts.ts";

const inOutline = ["Paragraph", "ListItem", "BulletList", "Document"];
const inLuaBlock = ["CodeText", "FencedCode:lua\nx = 1", "Document"];

test("no filter matches everywhere", () => {
  expect(matchesNodeContexts({}, inOutline)).toBe(true);
  expect(matchesNodeContexts({}, [])).toBe(true);
});

test("onlyContexts requires an enclosing node", () => {
  expect(matchesNodeContexts({ onlyContexts: ["ListItem"] }, inOutline)).toBe(
    true,
  );
  expect(
    matchesNodeContexts({ onlyContexts: ["ListItem"] }, ["Paragraph"]),
  ).toBe(false);
});

test("exceptContexts excludes enclosing nodes", () => {
  expect(
    matchesNodeContexts({ exceptContexts: ["FencedCode"] }, inLuaBlock),
  ).toBe(false);
  expect(
    matchesNodeContexts({ exceptContexts: ["FencedCode"] }, inOutline),
  ).toBe(true);
});

test("contexts match by prefix, including a fenced code language", () => {
  expect(
    matchesNodeContexts({ onlyContexts: ["FencedCode:lua"] }, inLuaBlock),
  ).toBe(true);
  expect(
    matchesNodeContexts({ onlyContexts: ["FencedCode:js"] }, inLuaBlock),
  ).toBe(false);
});

describe("contextsAt", () => {
  // As Client.extractParentNodes, minus the code bodies
  const client = {
    extractParentNodes(_state: EditorState, node: SyntaxNode) {
      const names: string[] = [];
      for (let n: SyntaxNode | null = node; n; n = n.parent) names.push(n.name);
      return names;
    },
  };
  const stateOf = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [buildExtendedMarkdownLanguage(), codeFolding()],
    });
  const contexts = (doc: string | EditorState, line: number, column = 0) => {
    const state = typeof doc === "string" ? stateOf(doc) : doc;
    return contextsAt(client, state, state.doc.line(line).from + column);
  };

  test("syntax nodes come first, innermost first", () => {
    expect(contexts("- one", 1, 3).slice(0, 3)).toEqual([
      "Paragraph",
      "ListItem",
      "BulletList",
    ]);
  });

  test("an empty or whitespace-only line is @blank; a line with text isn't", () => {
    expect(contexts("one\n\nthree", 2)).toContain("@blank");
    expect(contexts("one\n   \nthree", 2, 1)).toContain("@blank");
    expect(contexts("one\n\nthree", 1)).not.toContain("@blank");
    expect(contexts("- one", 1, 2)).not.toContain("@blank");
  });

  test("a list item with nested items is @hasChildren; a leaf item or a paragraph isn't", () => {
    const doc = "- parent\n  - child\n    - grandchild\n- leaf\n\nPara";
    expect(contexts(doc, 1, 2)).toContain("@hasChildren");
    expect(contexts(doc, 2, 4)).toContain("@hasChildren");
    expect(contexts(doc, 3, 6)).not.toContain("@hasChildren");
    expect(contexts(doc, 4, 2)).not.toContain("@hasChildren");
    expect(contexts(doc, 6)).not.toContain("@hasChildren");
    // Numbered and task items too
    expect(contexts("1. a\n   1. b", 1, 3)).toContain("@hasChildren");
    expect(contexts("- [ ] a\n  - [ ] b", 1, 6)).toContain("@hasChildren");
  });

  test("a line where a fold starts is @folded", () => {
    const doc = "## A heading\nBody";
    const folded = stateOf(doc).update({
      effects: foldEffect.of({ from: 12, to: doc.length }),
    }).state;
    expect(contexts(folded, 1, 3)).toContain("@folded");
    expect(contexts(doc, 1, 3)).not.toContain("@folded");
  });

  test("anywhere on a page that starts with frontmatter is @hasFrontmatter", () => {
    const doc = "---\ntags: x\n---\nBody\n\nMore";
    expect(contexts(doc, 4)).toContain("@hasFrontmatter");
    expect(contexts(doc, 6)).toContain("@hasFrontmatter");
    expect(contexts("Body\n\nMore", 3)).not.toContain("@hasFrontmatter");
    // A `---` rule further down is no frontmatter
    expect(contexts("Body\n\n---\n", 1)).not.toContain("@hasFrontmatter");
  });

  test("pseudo-contexts filter like nodes, and never by a node name's prefix", () => {
    const blank = contexts("one\n\nthree", 2);
    expect(matchesNodeContexts({ onlyContexts: ["@blank"] }, blank)).toBe(true);
    expect(matchesNodeContexts({ onlyContexts: ["@blank"] }, ["Blank"])).toBe(
      false,
    );
    for (const pseudo of Object.values(PSEUDO_CONTEXTS)) {
      expect(pseudo.startsWith("@")).toBe(true);
    }
  });
});
