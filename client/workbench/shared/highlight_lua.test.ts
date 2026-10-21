import { expect, test } from "vitest";
import { highlightLua } from "./highlight_lua.ts";

test("splits code into classed segments with the editor's token classes", () => {
  const segments = highlightLua('local x = "hi" -- note');
  expect(segments.map((s) => s.text).join("")).toBe('local x = "hi" -- note');
  expect(segments).toContainEqual({ text: "local", cls: "sb-keyword" });
  expect(segments).toContainEqual({ text: '"hi"', cls: "sb-string" });
  expect(segments).toContainEqual({ text: "-- note", cls: "sb-comment" });
});

test("keeps line breaks", () => {
  const text = highlightLua("x = 1\ny = 2")
    .map((s) => s.text)
    .join("");
  expect(text).toBe("x = 1\ny = 2");
});

test("unparseable input still comes back whole", () => {
  const segments = highlightLua("local = = (");
  expect(segments.map((s) => s.text).join("")).toBe("local = = (");
});
