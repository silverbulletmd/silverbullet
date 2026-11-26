import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import {
  findFrontmatter,
  isLibraryPage,
  libraryPageLua,
} from "./library_pages.ts";

describe("isLibraryPage", () => {
  it("accepts Library/ pages, including Library/Config", () => {
    expect(isLibraryPage("Library/Std/Config")).toBe(true);
    expect(isLibraryPage("Library/Repository/Std")).toBe(true);
    expect(isLibraryPage("Library/Config")).toBe(true);
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
      expect(isLibraryPage(n)).toBe(false);
    }
  });
  it("builds a Lua predicate over .name", () => {
    expect(libraryPageLua("p")).toBe('string.startsWith(p.name, "Library/")');
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
