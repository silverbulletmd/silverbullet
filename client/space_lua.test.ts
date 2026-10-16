import { expect, test, vi } from "vitest";
import { System } from "./plugos/system.ts";
import { luaDefinitionRef, SpaceLuaEnvironment } from "./space_lua.ts";
import { evalExpression } from "./space_lua/eval.ts";
import { quarantine } from "./space_lua/quarantine.ts";
import { parseBlock } from "./space_lua/parse.ts";
import type { LuaFunctionCallStatement } from "./space_lua/ast.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaRuntimeError,
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

test("reload records each script's outcome in load order", async () => {
  const scripts = [
    { ref: "Alpha@0", script: "x = 1", priority: 10 },
    { ref: "Beta@5", script: "nil_value.y = 2" },
    { ref: "Gamma@9", script: "y = x + 1" },
    { ref: "Delta@20", script: "while true do end" },
  ];
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  quarantine("Delta@20", "while true do end");
  const objectIndex = { queryLuaObjects: async () => scripts };
  const env = new SpaceLuaEnvironment(new System(), objectIndex as any);
  const loads: unknown[] = [];
  env.onLoad((load) => loads.push(load));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  await env.reload();

  const load = env.lastLoad!;
  expect(loads).toEqual([load]);
  expect(load.scripts.map((s) => [s.ref, s.priority, s.status])).toEqual([
    ["Alpha@0", 10, "loaded"],
    ["Beta@5", 0, "failed"],
    ["Gamma@9", 0, "loaded"],
    ["Delta@20", 0, "quarantined"],
  ]);
  const failed = load.scripts[1];
  expect(failed.status === "failed" && failed.error).toBeInstanceOf(
    LuaRuntimeError,
  );
  expect(env.sourceFor("Gamma@9")).toBe("y = x + 1");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
