import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { extractFrontMatter } from "./frontmatter.ts";

test("extracts the frontmatter block's own range", () => {
  const text = `---\nstuff: things\n---\n\nBody\n`;
  const fm = extractFrontMatter(parseMarkdown(text));
  expect(fm.range).toEqual([0, text.indexOf("---\n\nBody") + 3]);
});

test("a user `range` attribute cannot overwrite the frontmatter's own range", () => {
  // Regression for #2028: `range` reaches CodeMirror as a position pair
  // (X-Ray diagnostics, lint), so a user-authored value took the tab down.
  const text = `---\nstuff: things\nrange: 0, 36\notherstuff: more things\n---\n\nBody\n`;
  const fm = extractFrontMatter(parseMarkdown(text));
  expect(Array.isArray(fm.range)).toBe(true);
  expect(fm.range!.every((n) => typeof n === "number")).toBe(true);
  expect(text.slice(fm.range![0], fm.range![1])).toContain("stuff: things");
  // Other frontmatter data is untouched.
  expect(fm.stuff).toEqual("things");
  expect(fm.otherstuff).toEqual("more things");
});

test("a user `pos` attribute cannot overwrite a synthesized position either", () => {
  const text = `---\npos: not a number\n---\n\nBody\n`;
  const fm = extractFrontMatter(parseMarkdown(text));
  expect(fm.pos).toBeUndefined();
});
