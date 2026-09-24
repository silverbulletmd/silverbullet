import { expect, test } from "vitest";
import type { LuaFunctionCallStatement } from "../space_lua/ast.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { LuaEnv, LuaStackFrame, LuaTable } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import { luaHandle } from "./lua_views.ts";
import { isViewValue, newView, normalizeDefineSpec } from "./view_value.ts";

function luaSpec(
  source: string,
  env = new LuaEnv(luaBuildStandardEnv()),
): LuaTable {
  const node = parseBlock(`e(${source})`)
    .statements[0] as LuaFunctionCallStatement;
  return evalExpression(
    node.call.args[0],
    env,
    new LuaStackFrame(env, node.ctx),
  ) as LuaTable;
}

test("view.new retains Lua callbacks and defers source evaluation", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.setLocal("runs", 0);
  const spec = luaSpec(
    `{
    source = function(ctx)
      runs = runs + 1
      return { { name = "dock=" .. ctx.dock } }
    end,
    presentation = { mode = "tree" },
    stateKey = "example",
  }`,
    env,
  );
  const value = newView(spec);

  expect(value).toBeInstanceOf(LuaTable);
  expect(isViewValue(value)).toBe(true);
  expect(isViewValue(spec)).toBe(false);
  expect(value.spec).toBeInstanceOf(LuaTable);
  expect(value.spec).not.toBe(spec);
  expect((value.spec as LuaTable).rawGet("source")).toBe(spec.rawGet("source"));
  expect(value.meta).toMatchObject({ name: "", mode: "tree" });
  expect(value.stateKey).toBe("example");
  expect(value.selectable).toBe(false);
  expect(value.meta.hasSelect).toBe(false);
  expect(value.keys()).toEqual([]);
  expect(env.get("runs")).toBe(0);
  expect(
    await luaHandle(value.spec, "rows", { ctx: { dock: "inline" } }, env),
  ).toEqual([{ obj: { name: "dock=inline" }, primary: "dock=inline" }]);
  expect(env.get("runs")).toBe(1);
});

test("onSelect is optional and marks interactive values", () => {
  const informational = newView(
    luaSpec(`{
    source = function() return {} end,
  }`),
  );
  const interactive = newView(
    luaSpec(`{
    source = function() return {} end,
    onSelect = function() end,
  }`),
  );
  expect(informational.selectable).toBe(false);
  expect(informational.meta.hasSelect).toBe(false);
  expect(interactive.selectable).toBe(true);
  expect(interactive.meta.hasSelect).toBe(true);
});

test("view.new accepts an inline title and registration can override it", async () => {
  const value = newView(
    luaSpec(`{ source = function() return {} end, title = "Projects" }`),
  );
  expect(value.meta.title).toBe("Projects");
  const definition = luaSpec('{ name = "example", title = "Docked projects" }');
  await definition.rawSet("view", value);
  const normalized = normalizeDefineSpec(definition) as LuaTable;
  expect(normalized.rawGet("title")).toBe("Docked projects");
  expect(() =>
    newView(luaSpec(`{ source = function() return {} end, title = 42 }`)),
  ).toThrow("title must be a string");
});

test.each([
  ["missing source", "{}", "source is required"],
  ["bad source", "{ source = true }", "source must be a function"],
  [
    "bad state key",
    "{ source = function() end, stateKey = 42 }",
    "stateKey must be a non-empty string",
  ],
  [
    "empty state key",
    '{ source = function() end, stateKey = "" }',
    "stateKey must be a non-empty string",
  ],
  [
    "blank state key",
    '{ source = function() end, stateKey = "  " }',
    "stateKey must be a non-empty string",
  ],
  [
    "bad selection",
    "{ source = function() end, onSelect = true }",
    "onSelect must be a function",
  ],
  ["name", '{ source = function() end, name = "v" }', "name is not allowed"],
  [
    "command",
    '{ source = function() end, command = "Open" }',
    "command is not allowed",
  ],
  ["dock", '{ source = function() end, dock = "rhs" }', "dock is not allowed"],
  [
    "bad presentation",
    '{ source = function() end, presentation = { mode = "grid" } }',
    'presentation.mode must be "list", "tree", or "table"',
  ],
])("view.new rejects %s", (_label, source, message) => {
  expect(() => newView(luaSpec(source))).toThrow(`view.new: ${message}`);
});

test("explicit registration preserves the value's Lua source and accepts no selection", async () => {
  const value = newView(
    luaSpec(`{
    source = function() return { { name = "One" } } end,
    presentation = { mode = "tree" },
  }`),
  );
  const definition = luaSpec('{ name = "example", dock = "rhs" }');
  await definition.rawSet("view", value);
  const normalized = normalizeDefineSpec(definition);

  expect(normalized).toBeInstanceOf(LuaTable);
  expect(normalized.rawGet("name")).toBe("example");
  expect(normalized.rawGet("dock")).toBe("rhs");
  expect(normalized.rawGet("source")).toBe(value.spec.rawGet("source"));
  expect(normalized.rawGet("presentation")).toBe(
    value.spec.rawGet("presentation"),
  );
  expect(await luaHandle(normalized, "rows", {})).toEqual([
    { obj: { name: "One" }, primary: "One" },
  ]);
});

test("flat registration constructs a value while retaining Lua callbacks", () => {
  const flat = luaSpec(`{
    name = "example",
    source = function() return {} end,
    custom = 42,
  }`);
  const normalized = normalizeDefineSpec(flat) as LuaTable;
  expect(normalized).not.toBe(flat);
  expect(normalized.rawGet("name")).toBe("example");
  expect(normalized.rawGet("source")).toBe(flat.rawGet("source"));
  expect(normalized.rawGet("custom")).toBe(42);
});

test("view.new snapshots top-level fields so metadata and dispatch agree", async () => {
  const spec = luaSpec(`{
    source = function() return { { name = "Original" } } end,
    presentation = { mode = "tree" },
  }`);
  const value = newView(spec);
  await spec.rawSet(
    "source",
    luaSpec("{ source = function() return {} end }").rawGet("source"),
  );
  await spec.rawSet(
    "presentation",
    luaSpec('{ presentation = { mode = "list" } }').rawGet("presentation"),
  );

  expect(value.meta.mode).toBe("tree");
  expect(await luaHandle(value.spec, "rows", {})).toEqual([
    { obj: { name: "Original" }, primary: "Original" },
  ]);
});

test("explicit registration rejects competing flat content", async () => {
  const value = newView(luaSpec("{ source = function() return {} end }"));
  const definition = luaSpec(`{
    name = "example",
    source = function() return {} end,
  }`);
  await definition.rawSet("view", value);
  expect(() => normalizeDefineSpec(definition)).toThrow(
    "view.define: 'source' cannot be combined with 'view'",
  );
});

test("explicit registration requires a view.new value", () => {
  expect(() =>
    normalizeDefineSpec(luaSpec('{ name = "example", view = {} }')),
  ).toThrow("view.define: view must be a view.new value");
});
