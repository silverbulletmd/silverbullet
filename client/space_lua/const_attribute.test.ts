import { expect, test } from "vitest";
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

test("const: Unknown attribute (parse-time)", () => {
  let threw = false;
  try {
    parse(`local x<nope> = 1`, { ref: "unknown_attribute.lua" });
  } catch (e: any) {
    threw = true;
    expect(String(e?.message ?? e)).toContain("unknown attribute 'nope'");
  }
  if (!threw) {
    throw new Error("Expected parse error for unknown attribute");
  }
});

test("const: Case-sensitive attribute (parse-time)", () => {
  let threw = false;
  try {
    parse(`local x<Const> = 1`, { ref: "unknown_attribute.lua" });
  } catch (e: any) {
    threw = true;
    expect(String(e?.message ?? e)).toContain("unknown attribute 'Const'");
  }
  if (!threw) {
    throw new Error("Expected parse error for unknown attribute");
  }
});
test("const: Requires initializer", async () => {
  const { e } = await runAndCatch(`
    local x <const>
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("must be initialized");
});

test("const: Initialization ok, reassignment error", async () => {
  const env = await evalBlock(`
    local x<const> = 1
    y = x
  `);
  expect(env.get("y")).toEqual(1);

  const { e } = await runAndCatch(`
    local x<const> = 1
    x = 2
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'x'",);
});

test("const: Initialization to nil ok, reassignment error", async () => {
  const { e } = await runAndCatch(`
    local x <const> = nil
    x = 2
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'x'",);
});

test("const: Multi-declaration and missing RHS", async () => {
  {
    const env = await evalBlock(`
      local a <const>, b = 1
      y1 = a
      y2 = b
    `);
    expect(env.get("y1")).toEqual(1);
    expect(env.get("y2")).toEqual(null);
  }

  {
    const { e } = await runAndCatch(`
      local a<const>, b <const>; -- missing assignment
    `);
    expect(e).toBeInstanceOf(LuaRuntimeError);
    expect((e as LuaRuntimeError).message).toContain("must be initialized");
  }
});

test("const: Multi-assignment after declaration fails", async () => {
  const { e } = await runAndCatch(`
    local a<const>, b = 1, 2
    a, b = 3, 4
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'a'",);
});

test("const: Second position", async () => {
  const { e } = await runAndCatch(`
    local a, b<const> = 1, 2
    b = 3
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'b'",);
});

test("const: Initialization from function returns", async () => {
  const env = await evalBlock(`
    local function f()
      return 7
    end

    local a <const>, b <const> = f()

    y1, y2 = a, b
  `);
  expect(env.get("y1")).toEqual(7);
  expect(env.get("y2")).toEqual(null);

  const { e } = await runAndCatch(`
    local function f()
      return 7
    end

    local a<const>, b<const> = f()

    a = 2
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'a'",);
});

test("const: Shadowing", async () => {
  {
    const { e } = await runAndCatch(`
      local a<const> = 1

      do
        local a<const> = 2
        a = 3
      end
    `);
    expect(e).toBeInstanceOf(LuaRuntimeError);
    expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'a'",);
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
    expect(env.get("y")).toEqual(1);
  }
});

test("const: Globals and fields not affected", async () => {
  const env = await evalBlock(`
    local a<const> = 1
    G = a

    local T = {}
    T.x = a

    y1, y2 = G, T.x
  `);
  expect(env.get("y1")).toEqual(1);
  expect(env.get("y2")).toEqual(1);
});

test("const: Table binding vs table contents", async () => {
  const env = await evalBlock(`
    local t<const> = { a = 1, 2, 3 }

    t.a  = 10 -- mutate property
    t[2] = 20 -- mutate array part

    y1, y2, y3 = t.a, t[2], #t
  `);
  expect(env.get("y1")).toEqual(10);
  expect(env.get("y2")).toEqual(20);
  expect(env.get("y3")).toEqual(2);
});

test("const: Rebinding table fails", async () => {
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
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 't'",);
});

test("const: Inner block reassignment", async () => {
  const { e } = await runAndCatch(`
    local a<const> = 1
    do
      a = 2 -- must fail
    end
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'a'",);
});

test("const: Closure reassignment", async () => {
  const { e } = await runAndCatch(`
    local a<const> = 1

    local function f()
      a = 2 -- must error
    end

    f()
  `);
  expect(e).toBeInstanceOf(LuaRuntimeError);
  expect((e as LuaRuntimeError).message).toContain("attempt to assign to const variable 'a'",);
});

test("const: Closure mutates table", async () => {
  const env = await evalBlock(`
    local t<const> = { x = 1 }

    local function bump()
      t.x = t.x + 1
    end

    bump()

    y = t.x
  `);
  expect(env.get("y")).toEqual(2);
});
