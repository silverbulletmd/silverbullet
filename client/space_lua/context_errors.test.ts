import { parse } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { assertInstanceOf, assertStringIncludes } from "@std/assert";

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
  assertInstanceOf(e, LuaRuntimeError);
  const err = e as LuaRuntimeError;
  assertStringIncludes(err.message, msgIncludes);
  const pretty = err.toPrettyString(code);
  assertStringIncludes(pretty, msgIncludes);
  assertStringIncludes(pretty, ref);
  // caret presence sanity check
  assertStringIncludes(pretty, "^");
}

Deno.test("Context error: indexing nil value includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local t = nil
    local x = t[1]
  `,
    "index_nil.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to index a nil value");
});

Deno.test("Context error: indexing with nil key includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local t = {}
    local k = nil
    local x = t[k]
  `,
    "nil_key.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to index with a nil key");
});

Deno.test("Context error: calling nil includes message and ref", async () => {
  const { e, code, ref } = await runAndCatch(
    `
    local f = nil
    f()
  `,
    "call_nil.lua",
  );
  assertCtxErrorContains(e, code, ref, "attempt to call a nil value");
});

Deno.test("Context error: modulo by zero includes message and ref", async () => {
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

Deno.test("Context error: type mismatch in comparison includes message and ref", async () => {
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
Deno.test("Context error: __index metamethod must be function or table", async () => {
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

Deno.test("Context error: __call metamethod must be a function", async () => {
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

Deno.test("Context error: length operator wrong type (number)", async () => {
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
