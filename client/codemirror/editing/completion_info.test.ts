import { expect, test } from "vitest";
import { withCompletionInfo } from "./completion_info.ts";

test("converts serializable documentation into completion info", () => {
  const completion = withCompletionInfo({
    label: "parseBlock(code)",
    apply: "parseBlock",
    detail: "Parses Lua.",
    documentation: "### `lua.parseBlock`\n\nParses Lua.",
  });

  expect(completion).toMatchObject({
    label: "parseBlock(code)",
    apply: "parseBlock",
    detail: "Parses Lua.",
  });
  expect("documentation" in completion).toBe(false);
  expect(completion.info).toBeTypeOf("function");
});

test("preserves native completion info", () => {
  const info = () => null;

  const completion = withCompletionInfo({
    label: "parseBlock(code)",
    documentation: "Documentation from the event bridge.",
    info,
  });

  expect(completion.info).toBe(info);
  expect("documentation" in completion).toBe(false);
});

test("converts a serializable snippet into a native apply function", () => {
  const completion = withCompletionInfo({
    label: "parseBlock(code)",
    snippet: "parseBlock(${})",
  });

  expect("snippet" in completion).toBe(false);
  expect(completion.apply).toBeTypeOf("function");
});

test("preserves a native apply function instead of a serializable snippet", () => {
  const apply = () => {};
  const completion = withCompletionInfo({
    label: "parseBlock(code)",
    snippet: "parseBlock(${})",
    apply,
  });

  expect("snippet" in completion).toBe(false);
  expect(completion.apply).toBe(apply);
});
