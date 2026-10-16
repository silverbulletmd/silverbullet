import { afterEach, expect, test, vi } from "vitest";
import { evalStatement } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import { emitRuntimeLog, setRuntimeLogSink } from "./runtime_log.ts";

afterEach(() => setRuntimeLogSink(null));

test("without a sink, records go to the console with their label", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  emitRuntimeLog({ source: "lua", level: "log", text: "hello" });
  emitRuntimeLog({
    source: "plug",
    scope: "index",
    level: "warn",
    text: "slow",
  });
  expect(log).toHaveBeenCalledWith("[Lua]", "hello");
  expect(warn).toHaveBeenCalledWith("[index]", "slow");
  log.mockRestore();
  warn.mockRestore();
});

test("Lua print goes to the installed sink with its source position", async () => {
  const records: any[] = [];
  setRuntimeLogSink((r) => records.push(r));
  const env = new LuaEnv(luaBuildStandardEnv());
  const ast = parseBlock('print("a", 1)', { ref: "Sample Page@10" });
  await evalStatement(
    ast,
    env,
    LuaStackFrame.createWithGlobalEnv(env, ast.ctx),
  );
  expect(records).toEqual([
    {
      source: "lua",
      level: "log",
      text: "a 1",
      origin: { ref: "Sample Page@10", from: 0 },
    },
  ]);
});
