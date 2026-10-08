import { expect, test } from "vitest";
import { jsToLuaValue } from "../space_lua/runtime.ts";
import { contentResult } from "./lua_views.ts";

test("a markdown widget with evaluate = false stays a widget, keeping the flag", () => {
  const result = contentResult(
    jsToLuaValue({ markdown: "${1 + 1}", evaluate: false, _isWidget: true }),
  ) as { widget?: { markdown?: string; evaluate?: boolean } };
  expect(result.widget?.evaluate).toBe(false);
  expect(result.widget?.markdown).toBe("${1 + 1}");
});

test("a plain markdown widget still collapses to markdown", () => {
  expect(
    contentResult(jsToLuaValue({ markdown: "**hi**", _isWidget: true })),
  ).toEqual({ markdown: "**hi**" });
});
