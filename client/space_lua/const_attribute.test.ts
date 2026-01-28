import {
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
} from "@std/assert";
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

  if (r instanceof Promise) {
    await r;
  }
  return base;
}

async function runAndCatch(code: string, ref = "const_attribute.lua") {
  const ast = parse(code, { ref });
  const G = luaBuildStandardEnv();
  const env = new LuaEnv(G);
  const sf = LuaStackFrame.createWithGlobalEnv(G, ast.ctx);

  try {
    const r = evalStatement(ast, env, sf, false);
    if (r instanceof Promise) {
      await r;
    }
    throw new Error("Expected LuaRuntimeError but evaluation succeeded");
  } catch (e: unknown) {
    return { e, code, ref };
  }
}

Deno.test("const: Unknown attribute (parse-time)", () => {
  let threw = false;
  try {
    parse(`local x<nope> = 1`, { ref: "unknown_attribute.lua" });
  } catch (e: any) {
    threw = true;
    assertStringIncludes(String(e?.message ?? e), "unknown attribute 'nope'");
  }
  if (!threw) {
    throw new Error("Expected parse error for unknown attribute");
  }
});

Deno.test("const: Case-sensitive attribute (parse-time)", () => {
  let threw = false;
  try {
    parse(`local x<Const> = 1`, { ref: "unknown_attribute.lua" });
  } catch (e: any) {
    threw = true;
    assertStringIncludes(String(e?.message ?? e), "unknown attribute 'Const'");
  }
  if (!threw) {
    throw new Error("Expected parse error for unknown attribute");
  }
});
Deno.test("const: Requires initializer", async () => {
  const { e } = await runAndCatch(`
    local x <const>
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes((e as LuaRuntimeError).message, "must be initialized");
});

Deno.test("const: Initialization ok, reassignment error", async () => {
  const env = await evalBlock(`
    local x<const> = 1
    y = x
  `);
  assertEquals(env.get("y"), 1);

  const { e } = await runAndCatch(`
    local x<const> = 1
    x = 2
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'x'",
  );
});

Deno.test("const: Initialization to nil ok, reassignment error", async () => {
  const { e } = await runAndCatch(`
    local x <const> = nil
    x = 2
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'x'",
  );
});

Deno.test("const: Multi-declaration and missing RHS", async () => {
  {
    const env = await evalBlock(`
      local a <const>, b = 1
      y1 = a
      y2 = b
    `);
    assertEquals(env.get("y1"), 1);
    assertEquals(env.get("y2"), null);
  }

  {
    const { e } = await runAndCatch(`
      local a<const>, b <const>; -- missing assignment
    `);
    assertInstanceOf(e, LuaRuntimeError);
    assertStringIncludes((e as LuaRuntimeError).message, "must be initialized");
  }
});

Deno.test("const: Multi-assignment after declaration fails", async () => {
  const { e } = await runAndCatch(`
    local a<const>, b = 1, 2
    a, b = 3, 4
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("const: Second position", async () => {
  const { e } = await runAndCatch(`
    local a, b<const> = 1, 2
    b = 3
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'b'",
  );
});

Deno.test("const: Initialization from function returns", async () => {
  const env = await evalBlock(`
    local function f()
      return 7
    end

    local a <const>, b <const> = f()

    y1, y2 = a, b
  `);
  assertEquals(env.get("y1"), 7);
  assertEquals(env.get("y2"), null);

  const { e } = await runAndCatch(`
    local function f()
      return 7
    end

    local a<const>, b<const> = f()

    a = 2
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("const: Shadowing", async () => {
  {
    const { e } = await runAndCatch(`
      local a<const> = 1

      do
        local a<const> = 2
        a = 3
      end
    `);
    assertInstanceOf(e, LuaRuntimeError);
    assertStringIncludes(
      (e as LuaRuntimeError).message,
      "attempt to assign to const variable 'a'",
    );
  }

  {
    const env = await evalBlock(`
      local a<const> = 1

      do
        local a = 2
        a = 3
      end

      y = a
    `);
    assertEquals(env.get("y"), 1);
  }
});

Deno.test("const: Globals and fields not affected", async () => {
  const env = await evalBlock(`
    local a<const> = 1
    G = a

    local T = {}
    T.x = a

    y1, y2 = G, T.x
  `);
  assertEquals(env.get("y1"), 1);
  assertEquals(env.get("y2"), 1);
});

Deno.test("const: Table binding vs table contents", async () => {
  const env = await evalBlock(`
    local t<const> = { a = 1, 2, 3 }

    t.a  = 10 -- mutate property
    t[2] = 20 -- mutate array part

    y1, y2, y3 = t.a, t[2], #t
  `);
  assertEquals(env.get("y1"), 10);
  assertEquals(env.get("y2"), 20);
  assertEquals(env.get("y3"), 2);
});

Deno.test("const: Rebinding table fails", async () => {
  const { e } = await runAndCatch(
    `
    local t<const> = {
      a = 1
    }

    t = {
      b = 2
    }
  `,
    "const_table_rebind.lua",
  );
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 't'",
  );
});

Deno.test("const: Inner block reassignment", async () => {
  const { e } = await runAndCatch(`
    local a<const> = 1
    do
      a = 2 -- must fail
    end
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("const: Closure reassignment", async () => {
  const { e } = await runAndCatch(`
    local a<const> = 1

    local function f()
      a = 2 -- must error
    end

    f()
  `);
  assertInstanceOf(e, LuaRuntimeError);
  assertStringIncludes(
    (e as LuaRuntimeError).message,
    "attempt to assign to const variable 'a'",
  );
});

Deno.test("const: Closure mutates table", async () => {
  const env = await evalBlock(`
    local t<const> = { x = 1 }

    local function bump()
      t.x = t.x + 1
    end

    bump()

    y = t.x
  `);
  assertEquals(env.get("y"), 2);
});
