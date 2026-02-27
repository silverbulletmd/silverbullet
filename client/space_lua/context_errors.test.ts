import { expect, test } from "vitest";
import { parse } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

async function runAndCatch(code: string, ref = "ctx_test.lua") {
  const ast = parse(code, { ref });
  const global = luaBuildStandardEnv();
  const env = new LuaEnv(global);
  const sf = LuaStackFrame.createWithGlobalEnv(global, ast.ctx);
  try {
    const r = evalStatement(ast, env, sf, false);
    if (r instanceof Promise) await r;
    throw new Error("Expected LuaRuntimeError but evaluation succeeded");
  } catch (e: any) {
    return { e, code, ref };
  }
}

function assertCtxErrorContains(
  e: unknown,
  code: string,
  ref: string,
  msgIncludes: string,
) {
  expect(e).toBeInstanceOf(LuaRuntimeError);
  const err = e as LuaRuntimeError;
  expect(err.message).toContain(msgIncludes);
  const pretty = err.toPrettyString(code);
  expect(pretty).toContain(msgIncludes);
  expect(pretty).toContain(ref);
  // caret presence sanity check
  expect(pretty).toContain("^");
}

test("Context error: indexing nil value includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local t = nil
    local x = t[1]
  `,
    "index_nil.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to index a nil value");
});


test("Context error: calling nil includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local f = nil
    f()
  `,
    "call_nil.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to call a nil value");
});

test("Context error: modulo by zero includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local a = 1
    local b = 0
    local c = a % b
  `,
    "mod_zero.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to perform 'n%0'");
});

test("Context error: type mismatch in comparison includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local x = "a" < 1
  `,
    "compare_type.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to compare string with number");
});

/**
 * Additional generic context-error coverage for lazy dispatch:
 * - __index metamethod wrong type (neither function nor table)
 * - __call metamethod wrong type (non-callable)
 * - length operator on unsupported type
 */
test("Context error: __index metamethod must be function or table", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local t = {}
    setmetatable(t, { __index = 5 })
    local x = t.foo
  `,
    "meta_index_wrong.lua",
  );
  assertCtxErrorContains(
    e,
    code,
    ref,
    "attempt to index a number value",
  );
});

test("Context error: __call metamethod must be a function", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local t = {}
    setmetatable(t, { __call = 5 })
    t()
  `,
    "meta_call_wrong.lua",
  );
  assertCtxErrorContains(
    e,
    code,
    ref,
    "attempt to call a number value",
  );
});

test("Context error: length operator wrong type (number)", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local x = #1
  `,
    "len_number.lua",
  );
  assertCtxErrorContains(
    e,
    code,
    ref,
    "attempt to get length of a number value",
  );
});
