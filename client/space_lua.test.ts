import { expect, test, vi } from "vitest";
import { System } from "./plugos/system.ts";
import { luaDefinitionRef, SpaceLuaEnvironment } from "./space_lua.ts";
import { evalExpression } from "./space_lua/eval.ts";
import type { ToolBlock } from "./tooling.ts";
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

function block(ref: string, code: string, priority = 0): ToolBlock {
  const [page, pos] = ref.split("@");
  return { ref, page, pos: Number(pos), code, priority, boot: false };
}

test("reload runs blocks in the given order, past a failing one", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  const env = new SpaceLuaEnvironment(new System());

  await env.reload([
    block("B1@0", "order = 'b1'; nil_value.y = 2"),
    block("B2@0", "order = order .. ',b2'"),
  ]);

  expect(env.env.get("order")).toBe("b1,b2");
  expect(env.lastLoad!.scripts.map((s) => [s.ref, s.status])).toEqual([
    ["B1@0", "failed"],
    ["B2@0", "loaded"],
  ]);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    block("Alpha@0", "x = 1", 10),
    block("Beta@5", "nil_value.y = 2"),
    block("Gamma@9", "y = x + 1"),
    block("Delta@20", "while true do end"),
  ];
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  quarantine("Delta@20", "while true do end");
  const env = new SpaceLuaEnvironment(new System());
  const loads: unknown[] = [];
  env.onLoad((load) => loads.push(load));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  await env.reload(scripts);

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

test("while scripts reload, the previous environment stays in use until all have run", async () => {
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  const sle = new SpaceLuaEnvironment(new System());
  vi.spyOn(console, "log").mockImplementation(() => {});
  await sle.reload([block("Defs@0", "late = 1")]);
  expect(sle.env.get("late")).toBe(1);

  // A failing script logs mid-reload: look at what a render would see then
  const seen: unknown[] = [];
  vi.spyOn(console, "error").mockImplementation(() => {
    seen.push(sle.env.get("late"));
  });
  await sle.reload([
    block("Broken@0", "nil_value.y = 2", 10),
    block("Defs@0", "late = 2"),
  ]);
  expect(seen).toEqual([1]);
  expect(sle.env.get("late")).toBe(2);
});
