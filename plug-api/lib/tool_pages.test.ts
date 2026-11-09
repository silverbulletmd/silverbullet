import { describe, expect, it } from "vitest";
import { isToolPage, toolPageLua } from "./tool_pages.ts";

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
