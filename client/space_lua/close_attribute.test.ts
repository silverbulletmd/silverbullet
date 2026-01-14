import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from "@std/assert";
import { isPromise } from "./rp.ts";
import { parse } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

async function evalBlock(code: string, env?: LuaEnv): Promise<LuaEnv> {
  const ast = parse(code);
  const G = luaBuildStandardEnv();
  const base = env ?? new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);
  const r = evalStatement(ast, base, sf, false);

  if (isPromise(r)) {
    await r;
  }
  return base;
}

async function runAndCatch(code: string, ref = "close_attribute.lua") {
  const ast = parse(code, { ref });
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);

  try {
    const r = evalStatement(ast, env, sf, false);
    if (isPromise(r)) {
      await r;
    }
    throw new Error("Expected error but evaluation succeeded");
  } catch (e: unknown) {
    return { e, code, ref };
  }
}

async function runAndCatchEnv(code: string, ref = "close_attribute.lua") {
  const ast = parse(code, { ref });
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);
  let err: unknown = null;

  try {
    const r = evalStatement(ast, env, sf, false);
    if (isPromise(r)) {
      await r;
    }
  } catch (e: unknown) {
    err = e;
  }

  return { err, env };
}

// 1. parsing and static validation

Deno.test("close: parse ok", () => {
  parse(
    `
    local x<close> = {}
  `,
    { ref: "close_parse.lua" },
  );
});

Deno.test("close: parse ok without init", () => {
  parse(
    `
    do
      local x<close>
    end
  `,
    { ref: "close_no_init.lua" },
  );
});

Deno.test("close: local list only one", () => {
  try {
    parse(
      `
      do
        local a<close>, b<close> = {}, {}
      end
    `,
      { ref: "multi_close.lua" },
    );
    throw new Error("Expected parse error");
  } catch (e) {
    assertStringIncludes(String((e as any)?.message ?? e), "<close>");
    assertStringIncludes(String((e as any)?.message ?? e), "local list");
  }
});

Deno.test("close: <const> parse ok", () => {
  parse(
    `
    do
      local x<const> = 1
    end
  `,
    { ref: "const_parse.lua" },
  );
});

Deno.test("close: <const> and <close> parse ok", () => {
  parse(
    `
    do
      local x<const> = 1
      local y<close> = setmetatable({}, {
        __close = function()
        end
      })
    end
  `,
    { ref: "const_and_close_parse.lua" },
  );
});

Deno.test("close: invalid goto into scope", () => {
  try {
    parse(
      `
      do
        goto L
        local x<close> = setmetatable({}, {
          __close = function()
          end
        })
        ::L::
      end
    `,
      { ref: "goto_into_scope.lua" },
    );
    throw new Error("Expected parse error");
  } catch (e) {
    assertStringIncludes(String((e as any)?.message ?? e), "goto");
  }
});

// 2. basic scope exit

Deno.test("close: nil ignored; false is non-closable", async () => {
  const { e, ref, code } = await runAndCatch(
    `
    do
      local x<close> = nil
      local y<close> = false
    end
  `,
    "close_nil_false.lua",
  );

  assertStringIncludes(ref, "close_nil_false.lua");
  assertStringIncludes(code, "local y<close> = false");

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: normal close gets nil error", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local x<close> = setmetatable({"X"}, {
        __close = function(self, err)
          if err == nil then
            table.insert(t, "nil")
          else
            table.insert(t, "not-nil")
          end
        end
      })
    end
  `);

  assertEquals((env.get("t") as any).get(1), "nil");
});

Deno.test("close: close order", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local a<close> = setmetatable({1}, {
        __close = function(self)
          table.insert(t, self[1])
        end
      })

      local b<close> = setmetatable({2}, {
        __close = function(self)
          table.insert(t, self[1])
        end
      })
    end
  `);

  assertEquals((env.get("t") as any).get(1), 2);
  assertEquals((env.get("t") as any).get(2), 1);
});

Deno.test("close: shadowed variables close independently", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local x<close> = setmetatable({"OUTER"}, {
        __close = function(self) table.insert(t, "close-" .. self[1]) end
      })

      do
        local x<close> = setmetatable({"INNER"}, {
          __close = function(self) table.insert(t, "close-" .. self[1]) end
        })
        table.insert(t, "inner-end")
      end

      table.insert(t, "middle")
    end

    table.insert(t, "outer-end")
  `);

  const t = env.get("t") as any;

  assertEquals(t.get(1), "inner-end");
  assertEquals(t.get(2), "close-INNER");
  assertEquals(t.get(3), "middle");
  assertEquals(t.get(4), "close-OUTER");
  assertEquals(t.get(5), "outer-end");
});

Deno.test("close: metatable swap after mark closes with new __close", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local mt1 = {
        __close = function()
          table.insert(t, "close-1")
        end
      }
      local mt2 = {
        __close = function()
          table.insert(t, "close-2")
        end
      }

      local x<close> = setmetatable({}, mt1)
      setmetatable(x, mt2)
    end
  `);

  const t = env.get("t") as any;

  // Lua uses the metamethod at close time; this verifies close-time
  // lookup
  assertEquals(t.get(1), "close-2");
});

Deno.test("close: replacing __close function affects close-time behavior", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local mt = {
        __close = function()
          table.insert(t, "close-1")
        end
      }

      local x<close> = setmetatable({}, mt)

      mt.__close = function()
        table.insert(t, "close-2")
      end
    end
  `);

  const t = env.get("t") as any;
  assertEquals(t.length, 1);
  assertEquals(t.get(1), "close-2");
});

// 3. errors and unwinding

Deno.test("close: non-closable init", async () => {
  const { e } = await runAndCatch(`
    do
      local x<close> = {}
    end
  `);

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: reassign after implicit nil errors", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close>
      a = 1
    end
  `,
    "close_reassign_after_implicit_nil.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("close: reassign after explicit nil errors", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = nil
      a = 1
    end
  `,
    "close_reassign_after_explicit_nil.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("close: reassign after false is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = false
      a = 1
    end
  `,
    "close_reassign_after_false.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: reassign after closable value errors", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = setmetatable({"A"}, {
        __close = function(self)
        end
      })
      a = 1
    end
  `,
    "close_reassign_after_closable.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("close: reassignment through closure is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = false

      local function g()
        a = nil
      end

      g()
    end
  `,
    "close_reassign_through_closure.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: initializer true is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = true
    end
  `,
    "close_init_true.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: initializer integer is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = 1
    end
  `,
    "close_init_int.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: initializer float is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = 3.14
    end
  `,
    "close_init_float.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: initializer string is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = "string"
    end
  `,
    "close_init_string.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: initializer function is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local a<close> = function() end
    end
  `,
    "close_init_function.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: __close called exactly once on normal exit", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local called = 0
      local x<close> = setmetatable({}, {
        __close = function()
          called = called + 1
          table.insert(t, called)
        end
      })
    end
  `);

  const t = env.get("t") as any;

  assertEquals(t.length, 1);
  assertEquals(t.get(1), 1);
});

Deno.test("close: async __close awaited on normal exit", async () => {
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);

  // Promise-returning function: forces async close path deterministically.
  (env as any).setLocal(
    "delay",
    (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  );

  await evalBlock(
    `
    t = {}

    do
      local x<close> = setmetatable({}, {
        __close = function()
          delay(10)
          table.insert(t, "closed")
        end
      })
    end
  `,
    env,
  );

  const t = env.get("t") as any;
  assertEquals(t.length, 1);
  assertEquals(t.get(1), "closed");
});

Deno.test("close: __close called exactly once on error unwind", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}
    called = 0

    do
      local x<close> = setmetatable({}, {
        __close = function(self, err)
          called = called + 1
          table.insert(t, called)
        end
      })
      error("boom")
    end
  `,
    "close_once_on_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");

  const t = env.get("t") as any;
  assertEquals(t.length, 1);
  assertEquals(t.get(1), 1);
});

Deno.test("close: async __close awaited on error unwind", async () => {
  const code = `
    t = {}

    do
      local x<close> = setmetatable({"X"}, {
        __close = function(self, err)
          delay(10)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      error("boom")
    end
  `;

  const ast = parse(code, { ref: "close_async_unwind.lua" });
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);

  env.setLocal(
    "delay",
    (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  );

  let e: unknown = null;
  try {
    const r = evalStatement(ast, env, sf, false);
    if (isPromise(r)) {
      await r;
    }
  } catch (err: unknown) {
    e = err;
  }

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");

  const t = env.get("t") as any;
  assertEquals(t.length, 1);
  assertEquals(t.get(1), "close-X-boom");
});

Deno.test("close: error in __close inside vararg function", async () => {
  const { e } = await runAndCatch(
    `
    local function mk()
      return setmetatable({}, {
        __close = function()
          error("closefail")
        end
      })
    end

    local function f(...)
      local x<close> = mk()
      return ...
    end

    f(1, 2, 3)
  `,
    "close_vararg_close_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "closefail");
});

Deno.test("close: __close not callable", async () => {
  const { e } = await runAndCatch(
    `
    do
      local x<close> = setmetatable({}, {
        __close = 1
      })
    end
  `,
    "close_not_callable.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: __close not found via __index", async () => {
  const { e } = await runAndCatch(
    `
    do
      local mt = {
        __index = {
          __close = function()
          end
        }
      }

      local x<close> = setmetatable({}, mt)
    end
  `,
    "close_index_metaclose.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: mutate __close", async () => {
  const { e } = await runAndCatch(
    `
    do
      local mt = {
        __close = function()
        end
      }
      local x<close> = setmetatable({}, mt)
      mt.__close = 1
    end
  `,
    "close_mutate.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "not callable");
});

Deno.test("close: remove __close after mark errors at close time", async () => {
  const { err: e } = await runAndCatchEnv(
    `
    do
      local mt = {
        __close = function()
        end
      }
      local x<close> = setmetatable({}, mt)

      mt.__close = nil
    end
  `,
    "close_remove_metaclose.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "not callable");
});

Deno.test("close: __close callable via __call", async () => {
  const { e } = await runAndCatch(
    `
    do
      local c = setmetatable({}, {
        __call = function(self, obj, err)
          table.insert(t, "called")
        end
      })

      local x<close> = setmetatable({}, {
        __close = c
      })
    end
  `,
    "close_callable_via_call.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: error after close var init still closes", async () => {
  const { e } = await runAndCatch(
    `
    t = {}

    local function mk()
      return setmetatable({"A"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })
    end

    do
      local a<close> = mk()
      error("boom")
    end
  `,
    "close_error_after_init_closes.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");
});

Deno.test("close: close gets error", async () => {
  const { e } = await runAndCatch(`
    t = {}

    local function mk()
      return setmetatable({}, {
        __close = function(self, err)
          table.insert(t, tostring(err))
        end
      })
    end

    do
      local a<close> = mk()
      error("boom")
    end
  `);

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");
});

Deno.test("close: close error", async () => {
  const { e } = await runAndCatch(
    `
    do
      local x<close> = setmetatable({}, {
        __close = function()
          error("closefail")
        end
      })
    end
  `,
    "close_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "closefail");
});

Deno.test("close: close error on error", async () => {
  const { e } = await runAndCatch(
    `
    do
      local x<close> = setmetatable({}, {
        __close = function()
          error("closefail")
        end
      })

      error("boom")
    end
  `,
    "close_error_on_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "closefail");
});

Deno.test("close: close errors stop", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    do
      local a<close> = setmetatable({"A"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
          error("c1")
        end
      })

      local b<close> = setmetatable({"B"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
          error("c2")
        end
      })
    end
  `,
    "close_errors_stop.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "c2");

  // verify that both closes were attempted (Lua 5.4), but the first
  // close error (from B, closed first) is the reported error
  const t = env.get("t") as any;
  assertEquals(t.length, 2);
  assertEquals(t.get(1), "close-B");
  assertEquals(t.get(2), "close-A");
});

Deno.test("close: multiple closers unwind on error", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    local function mk(x)
      return setmetatable({x}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
    end

    do
      local a<close> = mk("A")
      local b<close> = mk("B")
      error("boom")
    end
  `,
    "close_multi_unwind.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");

  // verify both were closed in reverse order with the error object
  const t = env.get("t") as any;
  assertEquals(t.length, 2);
  assertEquals(t.get(1), "close-B-boom");
  assertEquals(t.get(2), "close-A-boom");
});

Deno.test("close: close errors stop during unwind", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    local function mk(x, fail)
      return setmetatable({x}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
          if fail then
            error("closefail-" .. self[1])
          end
        end
      })
    end

    do
      local a<close> = mk("A", false)
      local b<close> = mk("B", true)
      error("boom")
    end
  `,
    "close_unwind_close_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "closefail-B");

  // verify both closes were attempted (Lua 5.4), but the first close
  // error (from B, closed first) is the reported error
  const t = env.get("t") as any;
  assertEquals(t.length, 2);
  assertEquals(t.get(1), "close-B-boom");
  assertEquals(t.get(2), "close-A-boom");
});

Deno.test("close: complex assignment error closes prior", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    local function f1()
      return setmetatable({}, {
        __close = function()
          table.insert(t, "a_closed")
        end
      })
    end

    local function f2()
      error("assign_error")
    end

    do
      local a<close> = f1()
      local b = f2()
    end
  `,
    "complex_assign_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "assign_error");

  // verify 'a' was closed despite 'b' failing to assign
  const t = env.get("t") as any;
  assertEquals(t.get(1), "a_closed");
});

Deno.test("close: multi-init closes prior when later init errors", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    local function mk()
      return setmetatable({}, {
        __close = function()
          table.insert(t, "a_closed")
        end
      })
    end

    local function fail()
      error("boom")
    end

    do
      local a<close>, b = mk(), fail()
    end
  `,
    "close_multi_init_later_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");

  const t = env.get("t") as any;
  assertEquals(t.get(1), "a_closed");
});

Deno.test("close: async close error reported; later closers still run", async () => {
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);

  env.setLocal(
    "delay",
    (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  );

  const { err: e } = await (async () => {
    const code = `
      t = {}

      do
        local a<close> = setmetatable({"A"}, {
          __close = function(self, err)
            delay(5)
            table.insert(t, "close-" .. self[1])
          end
        })

        local b<close> = setmetatable({"B"}, {
          __close = function(self, err)
            delay(5)
            table.insert(t, "close-" .. self[1])
            error("b-closefail")
          end
        })
      end
    `;
    const ast = parse(code, { ref: "close_async_close_error.lua" });
    const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);

    let err: unknown = null;
    try {
      const r = evalStatement(ast, env, sf, false);
      if (isPromise(r)) await r;
    } catch (x) {
      err = x;
    }
    return { err };
  })();

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "b-closefail");

  const t = env.get("t") as any;
  // B closes first and errors, but A must still be closed in Lua 5.4 intent
  assertEquals(t.length, 2);
  assertEquals(t.get(1), "close-B");
  assertEquals(t.get(2), "close-A");
});

// 4. control flow exits

Deno.test("close: return closes", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      do
        local x<close> = setmetatable({"X"}, {
          __close = function(self)
            table.insert(t, "close-" .. self[1])
          end
        })
        return 1
      end
    end

    table.insert(t, f())
  `);

  assertEquals((env.get("t") as any).get(1), "close-X");
  assertEquals((env.get("t") as any).get(2), 1);
});

Deno.test("close: return in if closes", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      do
        local x<close> = setmetatable({"X"}, {
          __close = function(self)
            table.insert(t, "close-" .. self[1])
          end
        })
        if true then
          return 2
        end
        return 3
      end
    end

    table.insert(t, f())
  `);

  assertEquals((env.get("t") as any).get(1), "close-X");
  assertEquals((env.get("t") as any).get(2), 2);
});

Deno.test("close: goto closes", async () => {
  const env = await evalBlock(`
    t = {}

    do
      local x<close> = setmetatable({"X"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })

      goto L1
      ::L2::
      error("bad")
      ::L1::
      goto L3
      ::L3::
    end
  `);

  assertEquals((env.get("t") as any).get(1), "close-X");
});

Deno.test("close: goto nested", async () => {
  const env = await evalBlock(`
    t = {}

    do
      do
        local a<close> = setmetatable({"A"}, {
          __close = function(self)
            table.insert(t, "close-" .. self[1])
          end
        })
        do
          local b<close> = setmetatable({"B"}, {
            __close = function(self)
              table.insert(t, "close-" .. self[1])
            end
          })
          goto L
        end
      end
      ::L::
    end
  `);

  assertEquals((env.get("t") as any).get(1), "close-B");
  assertEquals((env.get("t") as any).get(2), "close-A");
});

Deno.test("close: return to-be-closed variable", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      local x<close> = setmetatable({"X"}, {
        __close = function(self)
          table.insert(t, "closed")
        end
      })
      return x
    end

    local r = f()
    table.insert(t, type(r))
  `);

  const t = env.get("t") as any;
  assertEquals(t.get(1), "closed");
  assertEquals(t.get(2), "table");
});

// 5. generic-for loop-scoped closing

Deno.test("close: for-in no close", async () => {
  const env = await evalBlock(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1, "v"
      end
      return nil
    end

    local function gen()
      return iter, nil, nil
    end

    for k, v in gen() do
      table.insert(t, "body")
    end
  `);

  assertEquals((env.get("t") as any).get(1), "body");
  assertEquals((env.get("t") as any).length, 1);
});

Deno.test("close: for-in false close is non-closable", async () => {
  const { e } = await runAndCatch(
    `
    local function iter(state, ctrl)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      return iter, nil, nil, false
    end

    for k in gen() do
    end
  `,
    "for_in_false_close.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: for-in bad close", async () => {
  const { e } = await runAndCatch(
    `
    local function iter(state, ctrl)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      return iter, nil, nil, {}
    end

    for k in gen() do
    end
  `,
    "for_in_bad_close.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "non-closable");
});

Deno.test("close: for-in updates control", async () => {
  const env = await evalBlock(`
    t = {}
    local calls = 0

    local function iter(state, ctrl)
      calls = calls + 1
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })

      return iter, nil, nil, closing
    end

    for k in gen() do
      table.insert(t, "body")
    end

    table.insert(t, calls)
  `);

  assertEquals((env.get("t") as any).get(1), "body");
  assertEquals((env.get("t") as any).get(2), "close-C");
  assertEquals((env.get("t") as any).get(3), 2);
});

Deno.test("close: for-in closes", async () => {
  const env = await evalBlock(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1, "v"
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })

      return iter, nil, nil, closing
    end

    for k, v in gen() do
      table.insert(t, "body")
    end
  `);

  assertEquals((env.get("t") as any).get(1), "body");
  assertEquals((env.get("t") as any).get(2), "close-C");
});

Deno.test("close: for-in async iterator and async closing are awaited", async () => {
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);

  (env as any).setLocal(
    "delay",
    (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  );

  await evalBlock(
    `
    t = {}
    local calls = 0

    local function iter(state, ctrl)
      calls = calls + 1
      delay(5)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self, err)
          delay(5)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      return iter, nil, nil, closing
    end

    for k in gen() do
      table.insert(t, "body")
    end

    table.insert(t, calls)
  `,
    env,
  );

  const t = env.get("t") as any;
  assertEquals(t.get(1), "body");
  assertEquals(t.get(2), "close-C-nil");
  assertEquals(t.get(3), 2);
});

Deno.test("close: loop scope", async () => {
  const env = await evalBlock(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })
      return iter, nil, nil, closing
    end

    for k in gen() do
      table.insert(t, "body")
    end

    table.insert(t, "after")
  `);

  assertEquals((env.get("t") as any).get(1), "body");
  assertEquals((env.get("t") as any).get(2), "close-C");
  assertEquals((env.get("t") as any).get(3), "after");
});

Deno.test("close: for-in closing closes before outer block closers", async () => {
  const env = await evalBlock(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    do
      local outer<close> = setmetatable({"O"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })

      local function gen()
        local closing = setmetatable({"L"}, {
          __close = function(self)
            table.insert(t, "close-" .. self[1])
          end
        })
        return iter, nil, nil, closing
      end

      for k in gen() do
        table.insert(t, "body")
      end

      table.insert(t, "after-loop")
    end

    table.insert(t, "after-block")
  `);

  const t = env.get("t") as any;

  // Required ordering:
  // body runs
  // loop closing value closes at loop end
  // after-loop runs
  // outer closes when leaving do-block
  // after-block runs
  assertEquals(t.get(1), "body");
  assertEquals(t.get(2), "close-L");
  assertEquals(t.get(3), "after-loop");
  assertEquals(t.get(4), "close-O");
  assertEquals(t.get(5), "after-block");
});

Deno.test("close: for-in closes on break", async () => {
  const env = await evalBlock(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1, "v"
      end
      return 2, "w"
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })

      return iter, nil, nil, closing
    end

    for k, v in gen() do
      table.insert(t, "body")
      break
    end
  `);

  assertEquals((env.get("t") as any).get(1), "body");
  assertEquals((env.get("t") as any).get(2), "close-C");
});

Deno.test("close: for-in closes on error", async () => {
  const { err: e, env } = await runAndCatchEnv(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1, "v"
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })

      return iter, nil, nil, closing
    end

    for k, v in gen() do
      error("boom")
    end
  `);

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");

  // verify closer received error
  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-C-boom");
});

Deno.test("close: for-in closes if iterator errors", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    local function iter(state, ctrl)
      error("iterboom")
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })

      return iter, nil, nil, closing
    end

    for k in gen() do
    end
  `,
    "for_in_iterator_error.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "iterboom");

  // verify closer received error
  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-C-iterboom");
});

Deno.test("close: return inside for-in body closes loop closing value", async () => {
  const env = await evalBlock(`
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      return iter, nil, nil, closing
    end

    local function f()
      for k in gen() do
        return 1
      end
      return 2
    end

    table.insert(t, f())
  `);

  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-C-nil");
  assertEquals(t.get(2), 1);
});

Deno.test("close: error inside for-in body closes loop closing value with error", async () => {
  const { err: e, env } = await runAndCatchEnv(
    `
    t = {}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1
      end
      return nil
    end

    local function gen()
      local closing = setmetatable({"C"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      return iter, nil, nil, closing
    end

    for k in gen() do
      error("boom")
    end
  `,
    "for_in_body_error_close_value.lua",
  );

  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "boom");

  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-C-boom");
});

// 6. pairs integration

Deno.test("close: pairs closes", async () => {
  const env = await evalBlock(`
    t = {}
    local closed = false

    local a = {10, 20}

    local function iter(state, ctrl)
      if ctrl == nil then
        return 1, state[1]
      end
      return nil
    end

    setmetatable(a, {
      __pairs = function(self)
        local tbc = setmetatable({"P"}, {
          __close = function()
            table.insert(t, "close-P")
            closed = true
          end
        })
        return iter, self, nil, tbc
      end
    })

    for k, v in pairs(a) do
      table.insert(t, "body")
    end

    if closed then
      table.insert(t, "closed")
    end
  `);

  assertEquals((env.get("t") as any).get(1), "body");
  assertEquals((env.get("t") as any).get(2), "close-P");
  assertEquals((env.get("t") as any).get(3), "closed");
});

// 7. protected calls

Deno.test("close: pcall closes on success", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      local x<close> = setmetatable({"X"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      return 1
    end

    local ok, r = pcall(f)
    if ok then
      table.insert(t, r)
    end
  `);

  assertEquals((env.get("t") as any).get(1), "close-X-nil");
  assertEquals((env.get("t") as any).get(2), 1);
});

Deno.test("close: multi-return expansion binds and closes", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk()
      local obj = setmetatable({"A"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      return obj, 99
    end

    do
      local a<close>, b = mk()
      table.insert(t, b)
    end
  `);

  const t = env.get("t") as any;
  assertEquals(t.get(1), 99);
  assertEquals(t.get(2), "close-A-nil");
});

Deno.test("close: pcall return closes with nil error", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk()
      return setmetatable({"R"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
    end

    local function f()
      do
        local x<close> = mk()
        return 7
      end
    end

    local ok, r = pcall(f)
    table.insert(t, ok)
    table.insert(t, r)
  `);

  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-R-nil");
  assertEquals(t.get(2), true);
  assertEquals(t.get(3), 7);
});

Deno.test("close: pcall break closes with nil error", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk()
      return setmetatable({"B"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
    end

    local function f()
      do
        local x<close> = mk()
        while true do
          break
        end
      end
      return 1
    end

    local ok, r = pcall(f)
    table.insert(t, ok)
    table.insert(t, r)
  `);

  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-B-nil");
  assertEquals(t.get(2), true);
  assertEquals(t.get(3), 1);
});

Deno.test("close: pcall goto closes with nil error", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk()
      return setmetatable({"G"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
    end

    local function f()
      do
        local x<close> = mk()
        goto L
        error("unreachable")
        ::L::
      end
      return 2
    end

    local ok, r = pcall(f)
    table.insert(t, ok)
    table.insert(t, r)
  `);

  const t = env.get("t") as any;
  assertEquals(t.get(1), "close-G-nil");
  assertEquals(t.get(2), true);
  assertEquals(t.get(3), 2);
});

Deno.test("close: pcall closes on error", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      local x<close> = setmetatable({"X"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      error("boom")
    end

    local ok, msg = pcall(f)
    if not ok then
      table.insert(t, tostring(msg))
    end
  `);

  assertEquals((env.get("t") as any).get(1), "close-X-boom");
  assertEquals((env.get("t") as any).get(2), "boom");
});

Deno.test("close: pcall close error overrides original and skips remaining closers", async () => {
  const env = await evalBlock(`
      t = {}

      local function mk(label, mode)
        return setmetatable({label}, {
          __close = function(self, err)
            table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
            if mode == "error" then
              error("closefail-" .. self[1])
            end
          end
        })
      end

      local function f()
        do
          local a<close> = mk("A", "ok")
          local b<close> = mk("B", "error")
          local c<close> = mk("C", "ok")
          error("boom")
        end
      end

      local ok, msg = pcall(f)
      table.insert(t, ok)
      table.insert(t, tostring(msg))
    `);

  const t = env.get("t") as any;

  // C closes first, then B closes and errors; A is still closed in Lua 5.4
  assertEquals(t.get(1), "close-C-boom");
  assertEquals(t.get(2), "close-B-boom");
  assertEquals(t.get(3), "close-A-boom");
  assertEquals(t.get(4), false);
  assertEquals(t.get(5), "closefail-B");
  assertEquals(t.length, 5);
});

Deno.test("close: xpcall closes on error", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      local x<close> = setmetatable({"X"}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
      error("boom")
    end

    local function h(err)
      return "handled-" .. tostring(err)
    end

    local ok, msg = xpcall(f, h)
    if not ok then
      table.insert(t, tostring(msg))
    end
  `);

  assertEquals((env.get("t") as any).get(1), "close-X-boom");
  assertEquals((env.get("t") as any).get(2), "handled-boom");
});

Deno.test("close: xpcall boundary contains __close errors", async () => {
  const env = await evalBlock(`
    t = {}

    local function f()
      do
        local x<close> = setmetatable({}, {
          __close = function(self, err)
            table.insert(t, "close-err-" .. tostring(err))
            error("closefail")
          end
        })
        error("boom")
      end
    end

    local function h(err)
      table.insert(t, "handler-" .. tostring(err))
      return "handled-" .. tostring(err)
    end

    local ok, msg = xpcall(f, h)
    table.insert(t, ok)
    table.insert(t, tostring(msg))
  `);

  const t = env.get("t") as any;

  // close runs during unwind and sees original error
  assertEquals(t.get(1), "close-err-boom");

  // the close error overrides the original for `xpcall`, so the
  // handler sees "closefail"
  assertEquals(t.get(2), "handler-closefail");

  assertEquals(t.get(3), false);
  assertEquals(t.get(4), "handled-closefail");
  assertEquals(t.length, 4);
});

Deno.test("close: nested to-be-closed created inside __close", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk(label)
      return setmetatable({label}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
    end

    do
      local outer<close> = setmetatable({"OUTER"}, {
        __close = function(self, err)
          table.insert(t, "outer-close-start-" .. tostring(err))
          do
            local inner<close> = mk("INNER")
            table.insert(t, "inner-scope-end")
          end
          table.insert(t, "outer-close-end")
        end
      })
      table.insert(t, "body-end")
    end
  `);

  const t = env.get("t") as any;

  // Expected order:
  // - body finishes
  // - outer close begins
  // - inner scope ends, so inner closes (during exec of outer __close)
  // - outer close ends
  assertEquals(t.get(1), "body-end");
  assertEquals(t.get(2), "outer-close-start-nil");
  assertEquals(t.get(3), "inner-scope-end");
  assertEquals(t.get(4), "close-INNER-nil");
  assertEquals(t.get(5), "outer-close-end");
});

Deno.test("close: pcall boundary does not close closers created in pcall args", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk(label)
      return setmetatable({label}, {
        __close = function(self)
          table.insert(t, "close-" .. self[1])
        end
      })
    end

    local function f()
      table.insert(t, "in-f")
      return 1
    end

    local function arg()
      local x<close> = mk("ARG")
      table.insert(t, "arg")
      return 123
    end

    local ok, r = pcall(f, arg())
    table.insert(t, ok)
    table.insert(t, r)
  `);

  const t = env.get("t") as any;

  // if `pcall` boundary is correct, ARG is closed at end of its own
  // scope and `pcall` does not close it
  assertEquals(t.get(1), "arg");
  assertEquals(t.get(2), "close-ARG");
  assertEquals(t.get(3), "in-f");
  assertEquals(t.get(4), true);
  assertEquals(t.get(5), 1);
});

Deno.test("close: nested pcall boundaries", async () => {
  const env = await evalBlock(`
    t = {}

    local function mk(label)
      return setmetatable({label}, {
        __close = function(self, err)
          table.insert(t, "close-" .. self[1] .. "-" .. tostring(err))
        end
      })
    end

    local function inner()
      local b<close> = mk("B")
      error("inner")
    end

    local function outer()
      local a<close> = mk("A")
      local ok, msg = pcall(inner)
      table.insert(t, ok)
      table.insert(t, tostring(msg))
      return 1
    end

    local ok, r = pcall(outer)
    table.insert(t, ok)
    table.insert(t, r)
  `);

  const t = env.get("t") as any;

  // inner closes with "inner" outer continues, then outer closes with
  // nil on success of outer itself
  assertEquals(t.get(1), "close-B-inner");
  assertEquals(t.get(2), false);
  assertEquals(t.get(3), "inner");
  assertEquals(t.get(4), "close-A-nil");
  assertEquals(t.get(5), true);
  assertEquals(t.get(6), 1);
});
