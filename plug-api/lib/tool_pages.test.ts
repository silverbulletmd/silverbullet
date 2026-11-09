import { describe, expect, it } from "vitest";
import { isToolPage, toolPageLua } from "./tool_pages.ts";

describe("isToolPage", () => {
  it("accepts Library/ pages and CONFIG", () => {
    expect(isToolPage("Library/Std/Config")).toBe(true);
    expect(isToolPage("Library/Repository/Std")).toBe(true);
    expect(isToolPage("CONFIG")).toBe(true);
  });
  it("rejects lookalikes", () => {
    for (const n of [
      "Library",
      "LibraryNotes/x",
      "config",
      "Notes/Library/x",
      "CONFIG/sub",
    ]) {
      expect(isToolPage(n)).toBe(false);
    }
  });
  it("builds a Lua predicate over .name", () => {
    expect(toolPageLua("p")).toBe(
      'p.name == "CONFIG" or string.startsWith(p.name, "Library/")',
    );
  });
});
