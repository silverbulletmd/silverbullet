import { assertEquals } from "@std/assert/equals";
import { parse } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { LuaEnv, LuaNativeJSFunction, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

async function evalBlock(code: string, env?: LuaEnv) {
  const ast = parse(code);
  // Use the same global env for both the base env's parent and the StackFrame's _GLOBAL
  const G = luaBuildStandardEnv();
  const base = env ?? new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);
  const r = evalStatement(ast, base, sf, false);
  if (r instanceof Promise) await r;
  return base;
}

Deno.test("Nested for loops: inner break (sync body)", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  await evalBlock(
    `
      local t = {1,2,3}
      found = 0
      for i = 1, #t do
        for j = i + 1, #t do
          found = found + 1
          break
	  error("BUG! Execution continued after break!")
        end
      end
    `,
    env,
  );
  assertEquals(env.get("found"), 2);
});

Deno.test("Nested for loops: inner break with async call in body (Promise path)", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set(
    "asyncOne",
    new LuaNativeJSFunction(() => Promise.resolve(1)),
  );
  await evalBlock(
    `
      local t = {1,2,3}
      found = 0
      for i = 1, #t do
        for j = i + 1, #t do
          asyncOne()         -- forces Promise in body
          found = found + 1  -- still must execute before break
          break              -- breaks only inner loop
	  error("BUG! Execution continued after break!")
        end
      end
    `,
    env,
  );
  assertEquals(env.get("found"), 2);
});

Deno.test("While: Promise condition, break inside body", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  // asyncTrue returns a truthy value via Promise to trigger Promise-based while path
  env.set(
    "asyncTrue",
    new LuaNativeJSFunction(() => Promise.resolve(1)),
  );
  await evalBlock(
    `
      cnt = 0
      local first = true
      local function cond()
        if first then
          first = false
          return asyncTrue()
        end
        return nil
      end
      while cond() do
        cnt = cnt + 1
        break
        error("BUG! Execution continued after break!")
      end
    `,
    env,
  );
  assertEquals(env.get("cnt"), 1);
});

Deno.test("Repeat-until: body goes Promise once, break handled locally", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set(
    "asyncOne",
    new LuaNativeJSFunction(() => Promise.resolve(1)),
  );
  await evalBlock(
    `
      n = 0
      repeat
        asyncOne() -- body Promise
        n = n + 1
        break
        error("BUG! Execution continued after break!")
      until true
    `,
    env,
  );
  assertEquals(env.get("n"), 1);
});

Deno.test("For-in: custom iterator, Promise in body before break", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set(
    "asyncOne",
    new LuaNativeJSFunction(() => Promise.resolve(1)),
  );
  await evalBlock(
    `
      function gen(n)
        local i = 0
        return function()
          i = i + 1
          if i <= n then return i end
        end
      end

      hits = 0
      for v in gen(3) do
        asyncOne() -- force Promise during body
        hits = hits + 1
        break
        error("BUG! Execution continued after break!")
      end
    `,
    env,
  );
  assertEquals(env.get("hits"), 1);
});

Deno.test("Jaro-like inner-window matching: inner break with occasional Promise", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set(
    "tick",
    new LuaNativeJSFunction(() => Promise.resolve(true)),
  );
  await evalBlock(
    `
      local s1 = "#aa"
      local s2 = "#ab"
      local l1, l2 = #s1, #s2
      local md = (l1 > l2 and l1 or l2) // 2 - 1
      if md < 0 then md = 0 end

      s1m = {}
      s2m = {}
      mc  = 0

      for i = 1, l1 do
        local start  = (1 > i - md) and 1 or (i - md)
        local finish = ((i + md) < l2) and (i + md) or l2

        for j = start, finish do
          tick() -- Promise in inner loop body to exercise Promise path
          if not s2m[j] and s1:byte(i) == s2:byte(j) then
            s1m[i] = true
            s2m[j] = true
            mc = mc + 1
            break
            error("BUG! Execution continued after break!")
          end
        end
      end

      ok = (mc >= 1)
    `,
    env,
  );
  assertEquals(env.get("ok"), true);
});
