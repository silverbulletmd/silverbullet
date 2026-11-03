import { expect, test, vi } from "vitest";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { LuaStackFrame, LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

test("pairs iterates without converting its invariant state to JavaScript", async () => {
  const env = luaBuildStandardEnv();
  const rows = new LuaTable();
  for (let i = 1; i <= 100; i++) {
    const row = new LuaTable();
    await row.set("name", `Page ${i}`);
    await rows.set(`page${i}`, row);
  }
  env.set("rows", rows);
  const convert = vi.spyOn(rows, "toJS");
  const block = parseBlock(`
    count = 0
    for name, row in pairs(rows) do
      count = count + 1
      assert(row == rows[name])
    end
  `);
  await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  expect(env.get("count")).toBe(100);
  expect(convert.mock.calls.length).toBe(0);
});

test("pairs can traverse a self-referential table and retains its iterator state", async () => {
  const env = luaBuildStandardEnv();
  const block = parseBlock(`
    local t = {}
    t.self = t
    local iter, state, control = pairs(t)
    assert(state == t)
    assert(control == nil)
    local key, value = iter(state, control)
    assert(key == "self")
    assert(value == t)
    assert(iter(state, key) == nil)
    count = 0
    for k, v in pairs(t) do
      assert(k == "self")
      assert(v == t)
      count = count + 1
    end
  `);
  await evalStatement(block, env, LuaStackFrame.createWithGlobalEnv(env));
  expect(env.get("count")).toBe(1);
});
