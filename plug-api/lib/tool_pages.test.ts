import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { findFrontmatter, isToolPage, toolPageLua } from "./tool_pages.ts";

describe("isToolPage", () => {
  it("accepts Library/ pages, including Library/Config", () => {
    expect(isToolPage("Library/Std/Config")).toBe(true);
    expect(isToolPage("Library/Repository/Std")).toBe(true);
    expect(isToolPage("Library/Config")).toBe(true);
  });
  it("rejects lookalikes", () => {
    for (const n of [
      "Library",
      "LibraryNotes/x",
      "config",
      "Notes/Library/x",
      "CONFIG/sub",
      "CONFIG",
    ]) {
      expect(isToolPage(n)).toBe(false);
    }
  });
  it("builds a Lua predicate over .name", () => {
    expect(toolPageLua("p")).toBe('string.startsWith(p.name, "Library/")');
  });
});

describe("findFrontmatter", () => {
  const fm = (text: string) => findFrontmatter(parseMarkdown(text));
  it("is empty without frontmatter", () => {
    expect(fm("# Just a page\n")).toEqual({});
  });
  it("is empty when the YAML is a scalar or a list", () => {
    expect(fm("---\njust text\n---\n")).toEqual({});
    expect(fm("---\n- a\n- b\n---\n")).toEqual({});
  });
  it("is the mapping of valid YAML", () => {
    expect(fm("---\ntags: meta/theme\nscheme: dark\n---\nBody")).toEqual({
      tags: "meta/theme",
      scheme: "dark",
    });
  });
});
