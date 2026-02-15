import { bench } from "vitest";
import { readFile } from "node:fs/promises";
// Benchmark suite for Space Lua RP (Result-or-Promise) optimizations
// that exercises hot synchronous paths (binary ops, loops, function
// calls, argument lists, table get/set, concatenation).
//
// # NOTES
//
// * Parsing cost is excluded from measured time by compiling each
//   snippet once.
//
// * Each bench creates a fresh Lua environment to isolate state.
//
// * Minimal global environment (`_GLOBAL`) is installed with included:
//
//   * `string.format` (simple `%s` formatter) and
//   * `type`.
//
// * To add benches that need more stdlib, extend makeEnv() accordingly.

import { evalStatement } from "./eval.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  LuaTable,
  luaTypeOf,
} from "./runtime.ts";
import { parse as parseLua } from "./parse.ts";

const LOOP = 100000;
const SMALL = 20000;

function makeEnv(): { global: LuaEnv; sf: LuaStackFrame } {
  const global = new LuaEnv();

  const stringLib = new LuaTable({
    format: (fmt: string, ...args: any[]) => {
      let i = 0;
      return String(fmt).replace(/%s/g, () => String(args[i++]));
    },
  });

  global.setLocal("string", stringLib);

  global.setLocal(
    "type",
    new LuaBuiltinFunction((_sf, v) => luaTypeOf(v)),
  );

  const sf = LuaStackFrame.createWithGlobalEnv(global);

  return { global, sf };
}

async function run(ast: any) {
  const { global, sf } = makeEnv();
  try {
    const r = evalStatement(ast, global, sf, false);
    if (r instanceof Promise) {
      await r;
    }
  } catch (e) {
    if (e instanceof LuaRuntimeError) {
      throw e;
    }
    throw new Error(`Lua execution error: ${e && (e as any).message || e}`);
  }
}

// Snippets

const luaWhileSync = `
  local i = 0
  local s = 0
  while i < ${LOOP} do
    i = i + 1
    s = s + i
  end
`;

const luaForNumeric = `
  local s = 0
  for i = 1, ${LOOP} do
    s = s + i
  end
`;

const luaWhileFuncCondTruthy = `
  local n = 0
  local function next_or_nil()
    n = n + 1
    if n <= 2 then
      return 0  -- 0 is truthy; should loop exactly twice
    end
    return nil
  end
  local count = 0
  while next_or_nil() do
    count = count + 1
  end
`;

const luaFuncCallArgs = `
  local s = 0
  local function f(a, b, c) return a + b + c end
  for i = 1, ${LOOP}, 3 do
    s = s + f(i, i + 1, i + 2)
  end
`;

const luaTableGetSet = `
  local t = { a = 1 }
  for i = 1, ${LOOP} do
    t.a = t.a + 1
  end
`;

const luaTableIndexNumeric = `
  local t = {}
  for i = 1, ${LOOP} do
    t[i] = i
  end
  local s = 0
  for i = 1, ${LOOP} do
    s = s + t[i]
  end
`;

const luaConcatStrings = `
  local s = ""
  for i = 1, ${SMALL} do
    s = s .. "x"
  end
`;

const luaArithmeticBinary = `
  local a, b, c = 1, 2, 3
  local s = 0
  for i = 1, ${LOOP} do
    s = s + (a * b) - (c / a) + (a ^ 2) % 5
  end
`;

const luaWhileTruthinessMix = `
  local items = { 0, "", {}, 1, -0.0, "x" }
  local idx = 0
  local function next_item()
    idx = idx + 1
    local v = items[idx]
    if v ~= nil then return v end
    return nil
  end
  local cnt = 0
  while next_item() do
    cnt = cnt + 1
  end
`;

const luaTableDeepDotGetSet = `
  local t = { a = { b = { c = 1 } } }
  for i = 1, ${LOOP} do
    t.a.b.c = t.a.b.c + 1
  end
`;

const luaTableDotMissRead = `
  local t = { a = 1 }
  local s = 0
  for i = 1, ${LOOP} do
    if t.m == nil then
      s = s + 1
    end
  end
`;

// The truthiness_test.lua uses the `string.format`.
const truthinessPath =
  new URL("./truthiness_test.lua", import.meta.url).pathname;
const truthinessCode = await readFile(truthinessPath, "utf-8");

const astWhileSync = parseLua(luaWhileSync);
const astForNumeric = parseLua(luaForNumeric);
const astWhileFuncCondTruthy = parseLua(luaWhileFuncCondTruthy);
const astFuncCallArgs = parseLua(luaFuncCallArgs);
const astTableGetSet = parseLua(luaTableGetSet);
const astTableIndexNumeric = parseLua(luaTableIndexNumeric);
const astConcatStrings = parseLua(luaConcatStrings);
const astArithmeticBinary = parseLua(luaArithmeticBinary);
const astWhileTruthinessMix = parseLua(luaWhileTruthinessMix);
const astTableDeepDotGetSet = parseLua(luaTableDeepDotGetSet);
const astTableDotMissRead = parseLua(luaTableDotMissRead);
const astTruthiness = parseLua(truthinessCode);

bench("RP: while (sync cond) numeric sum", async () => {
  await run(astWhileSync);
});

bench("RP: for (numeric) sum", async () => {
  await run(astForNumeric);
});

bench("RP: while (function cond -> truthy then nil)", async () => {
  await run(astWhileFuncCondTruthy);
});

bench("RP: function calls + arg eval", async () => {
  await run(astFuncCallArgs);
});

bench("RP: table dot get/set", async () => {
  await run(astTableGetSet);
});

bench("RP: table numeric index get/set", async () => {
  await run(astTableIndexNumeric);
});

bench("RP: table deep dot get/set (3 levels)", async () => {
  await run(astTableDeepDotGetSet);
});

bench("RP: table dot miss (nil reads, no metatable)", async () => {
  await run(astTableDotMissRead);
});

bench("RP: string concatenation (..)", async () => {
  await run(astConcatStrings);
});

bench("RP: arithmetic (binary ops)", async () => {
  await run(astArithmeticBinary);
});

bench("RP: while truthiness mix (0,'' ,{},...)", async () => {
  await run(astWhileTruthinessMix);
});

bench("RP: truthiness_test.lua (end-to-end)", async () => {
  await run(astTruthiness);
});
