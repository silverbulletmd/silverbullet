import { expect, test } from "vitest";
import { luaDefinitionRef } from "./space_lua.ts";
import { evalExpression } from "./space_lua/eval.ts";
import { parseBlock } from "./space_lua/parse.ts";
import type { LuaFunctionCallStatement } from "./space_lua/ast.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "./space_lua/runtime.ts";

test("Lua definition references survive conversion to JavaScript", () => {
  const block = parseBlock("_(function() return 1 end)", {
    ref: "Test/Page@10",
  });
  const expression = (block.statements[0] as LuaFunctionCallStatement).call
    .args[0];
  const fn = evalExpression(
    expression,
    new LuaEnv(),
    new LuaStackFrame(new LuaEnv(), expression.ctx),
  );
  const expected = {
    path: "Test/Page.md",
    details: { type: "position", pos: 33 },
  };
  expect(luaDefinitionRef(fn)).toEqual(expected);
  expect(luaDefinitionRef(luaValueToJS(fn, LuaStackFrame.lostFrame))).toEqual(
    expected,
  );
});

test("Builtins and ordinary JavaScript functions have no Lua definition", () => {
  const builtin = new LuaBuiltinFunction({ callback: () => 1 });
  expect(luaDefinitionRef(builtin)).toBeNull();
  expect(
    luaDefinitionRef(luaValueToJS(builtin, LuaStackFrame.lostFrame)),
  ).toBeNull();
  expect(luaDefinitionRef(() => 1)).toBeNull();
});
