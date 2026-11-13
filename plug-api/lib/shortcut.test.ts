import { describe, expect, test } from "vitest";
import { firstKeyboardHint, isMacLike } from "./shortcut.ts";

describe("firstKeyboardHint", () => {
  test("only the first binding, arrows as arrows", () => {
    expect(
      firstKeyboardHint({
        key: ["Alt-ArrowUp", "Ctrl-. k"],
        mac: ["Alt-ArrowUp", "Cmd-. k"],
      }),
    ).toBe(isMacLike ? "⌥↑" : "Alt-↑");
  });

  test("a single binding, or none", () => {
    expect(firstKeyboardHint({ key: "Ctrl-b", mac: "Cmd-b" })).toBe(
      isMacLike ? "⌘B" : "Ctrl-b",
    );
    expect(firstKeyboardHint({})).toBeUndefined();
    expect(firstKeyboardHint({ key: [] })).toBeUndefined();
  });

  test("a key sequence reads stroke by stroke, a lone letter upper-cased", () => {
    // Outline: Move Left
    expect(firstKeyboardHint({ key: "Mod-. h" })).toBe(
      isMacLike ? "⌘. then H" : "Ctrl-. then H",
    );
    // Outline: Toggle Fold really is Mod-. pressed twice
    expect(firstKeyboardHint({ key: "Mod-. Mod-." })).toBe(
      isMacLike ? "⌘. then ⌘." : "Ctrl-. then Ctrl-.",
    );
    expect(firstKeyboardHint({ key: "Mod-. t" })).toMatch(/ then T$/);
  });
});
