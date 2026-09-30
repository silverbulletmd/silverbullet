import { expect, test } from "vitest";
import { highlightTree } from "@lezer/highlight";
import { extendedMarkdownLanguage } from "./parser.ts";
import { editorHighlightStyle } from "../style.ts";

function classesFor(text: string, snippet: string): string[] {
  const tree = extendedMarkdownLanguage.parser.parse(text);
  const start = text.indexOf(snippet);
  const classes: string[] = [];
  highlightTree(tree, editorHighlightStyle(), (from, to, cls) => {
    if (from <= start && to >= start + snippet.length) {
      classes.push(cls);
    }
  });
  return classes.join(" ").split(" ");
}

// Our styleTags must win over @lezer/markdown's built-in ones for the same
// node names
test("Custom style tags override built-in markdown ones", () => {
  expect(classesFor("```space-lua\nprint(1)\n```\n", "space-lua")).toContain(
    "sb-code-info",
  );
  expect(classesFor("Hello\n\n---\n\nThere", "---")).toContain("sb-hr");
  expect(classesFor("Hello <!-- note --> there", "note")).toContain(
    "sb-comment",
  );
});
