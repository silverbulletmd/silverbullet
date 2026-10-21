import { expect, test } from "vitest";
import { luaString } from "./lua_string.ts";

test("luaString escapes quotes, backslashes and control characters", () => {
  expect(luaString('say "hi"\nnow\\')).toBe('"say \\"hi\\"\\nnow\\\\"');
  expect(luaString("a\tb\rc")).toBe('"a\\tb\\rc"');
});
