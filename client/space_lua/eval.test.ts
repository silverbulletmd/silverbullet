import { expect, test } from "vitest";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
  singleResult,
} from "./runtime.ts";
import { parse } from "./parse.ts";
import type { LuaBlock, LuaFunctionCallStatement } from "./ast.ts";
import { evalExpression, evalStatement } from "./eval.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

const sf = LuaStackFrame.lostFrame;

function evalExpr(s: string, e = new LuaEnv(), sf?: LuaStackFrame): any {
  const node = parse(`e(${s})`).statements[0] as LuaFunctionCallStatement;
  sf = sf || new LuaStackFrame(e, node.ctx);
  return evalExpression(
    node.call.args[0],
    e,
    sf,
  );
}

async function evalBlock(s: string, e = new LuaEnv()): Promise<void> {
  const node = parse(s) as LuaBlock;
  const sf = new LuaStackFrame(e, node.ctx);
  await evalStatement(node, e, sf);
}

test("Evaluator test", async () => {
  const env = new LuaEnv();
  env.set("test", new LuaNativeJSFunction((n) => n));
  env.set("asyncTest", new LuaNativeJSFunction((n) => Promise.resolve(n)));

  // Basic arithmetic
  expect(evalExpr(`1 + 2 + 3 - 3`)).toEqual(3);
  expect(evalExpr(`4 // 3`)).toEqual(1);
  expect(evalExpr(`4 % 3`)).toEqual(1);

  // Bitwise arithmetic
  expect(evalExpr(`~171`)).toEqual(-172); // signed two's complement
  expect(evalExpr(`5 & 3`)).toEqual(1); // 101 & 011 = 001
  expect(evalExpr(`5 | 3`)).toEqual(7); // 101 | 011 = 111
  expect(evalExpr(`5 ~ 3`)).toEqual(6); // 101 ^ 011 = 110
  expect(evalExpr(`5 << 3`)).toEqual(40); // 101 << 3 = 101000
  expect(evalExpr(`5 >> 2`)).toEqual(1); // 101 >> 2 = 1

  // Strings
  expect(evalExpr(`"a" .. "b"`)).toEqual("ab");

  // Logic
  expect(evalExpr(`true and false`)).toEqual(false);
  expect(evalExpr(`true or false`)).toEqual(true);
  expect(evalExpr(`not true`)).toEqual(false);
  // Test eager evaluation of left operand
  expect(
    evalExpr(
      `true or (function() error("this should not be evaluated") end)()`,
    ),
  ).toEqual(true);
  // Tables
  const tbl = await evalExpr(`{3, 1, 2}`);
  expect(tbl.get(1)).toEqual(3);
  expect(tbl.get(2)).toEqual(1);
  expect(tbl.get(3)).toEqual(2);
  expect(luaValueToJS(tbl, sf)).toEqual([3, 1, 2]);

  expect(
    luaValueToJS(await evalExpr(`{name=test("Zef"), age=100}`, env), sf),
  ).toEqual({
    name: "Zef",
    age: 100,
  });

  expect(
    luaValueToJS(await evalExpr(`{name="Zef", age=asyncTest(100)}`, env), sf),
  ).toEqual({
    name: "Zef",
    age: 100,
  });

  const result = await evalExpr(`{[3+2]=1, ["a".."b"]=2}`);
  expect(result.get(5)).toEqual(1);
  expect(result.get("ab")).toEqual(2);

  expect(await evalExpr(`#{}`)).toEqual(0);
  expect(await evalExpr(`#{1, 2, 3}`)).toEqual(3);

  // Unary operators
  expect(await evalExpr(`-asyncTest(3)`, env)).toEqual(-3);

  // Function calls
  expect(singleResult(evalExpr(`test(3)`, env))).toEqual(3);
  expect(singleResult(await evalExpr(`asyncTest(3) + 1`, env))).toEqual(4);

  // Function expressions and table access
  expect(
    await evalExpr(`(function() return {name="John"} end)().name`),
  ).toEqual("John");

  // Function definitions
  const fn = evalExpr(`function(a, b) return a + b end`);
  expect(fn.body.parameters).toEqual(["a", "b"]);
});

test("Parser rejects unary plus - parenthesized", () => {
  for (
    const src of [
      "return +(1)",
      "return +((1))",
      "return +(1 + 2)",
      "return +({})",
    ]
  ) {
    let err: any = null;
    try {
      parse(src);
    } catch (e: any) {
      err = e;
    }
    expect(err !== null).toEqual(true);
    expect(
      String(err?.message ?? err).includes("unexpected symbol near '+'"),
    ).toEqual(true);
  }
});

test("Parser rejects unary plus - variables and calls", () => {
  for (
    const src of [
      "return +(a)",
      "return +(a.b)",
      "return +(a[1])",
      "return +f()",
      "return +(f())",
    ]
  ) {
    let err: any = null;
    try {
      parse(src);
    } catch (e: any) {
      err = e;
    }
    expect(err !== null).toEqual(true);
    expect(
      String(err?.message ?? err).includes("unexpected symbol near '+'"),
    ).toEqual(true);
  }
});

test("Parser rejects unary plus - whitespace/newlines", () => {
  for (
    const src of [
      "return + 1",
      "return +\n1",
      "return +\t(1)",
      "return \n+\n(1)",
    ]
  ) {
    let err: any = null;
    try {
      parse(src);
    } catch (e: any) {
      err = e;
    }
    expect(err !== null).toEqual(true);
    expect(
      String(err?.message ?? err).includes("unexpected symbol near '+'"),
    ).toEqual(true);
  }
});

test("Comparison metamethods: __lt", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());

  await evalBlock(
    `
      local mt = {
        __lt = function(a, b) return a.v < b.v end
      }
      local a = setmetatable({ v = 1 }, mt)
      local b = setmetatable({ v = 2 }, mt)
      res = (a < b)
    `,
    env,
  );

  expect(env.get("res")).toEqual(true);
});

test("Comparison metamethods: __le does not fallback to __lt", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());

  let threw = false;
  try {
    await evalBlock(
      `
      local mt = {
        __lt = function(a, b) return a.v < b.v end
      }
      local a = setmetatable({ v = 2 }, mt)
      local b = setmetatable({ v = 2 }, mt)
      res = (a <= b)
    `,
      env,
    );
  } catch (e: any) {
    threw = true;
    const msg = String(e?.message ?? e);
    if (!msg.includes("attempt to compare")) {
      throw e;
    }
  }

  expect(threw).toEqual(true);
});

test("Equality metamethod: __eq requires same function", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());

  await evalBlock(
    `
      local f1 = function(a, b) return true end
      local f2 = function(a, b) return true end
      local mt1 = { __eq = f1 }
      local mt2 = { __eq = f2 } -- different function object
      local a = setmetatable({}, mt1)
      local b = setmetatable({}, mt2)
      res = (a == b)
    `,
    env,
  );

  // Lua calls __eq even when the functions differ
  expect(env.get("res")).toEqual(true);
});

test("Statement evaluation", async () => {
  const env = new LuaEnv();
  env.set("test", new LuaNativeJSFunction((n) => n));
  env.set("asyncTest", new LuaNativeJSFunction((n) => Promise.resolve(n)));

  expect(await evalBlock(`a = 3`, env)).toEqual(undefined);
  expect(env.get("a")).toEqual(3);
  expect(await evalBlock(`b = test(3)`, env)).toEqual(undefined);
  expect(env.get("b")).toEqual(3);

  await evalBlock(`c = asyncTest(3)`, env);
  expect(env.get("c")).toEqual(3);

  // Multiple assignments
  const env2 = new LuaEnv();
  expect(await evalBlock(`a, b = 1, 2`, env2)).toEqual(undefined);
  expect(env2.get("a")).toEqual(1);
  expect(env2.get("b")).toEqual(2);

  // Other lvalues
  const env3 = new LuaEnv();
  await evalBlock(`tbl = {1, 2, 3}`, env3);
  await evalBlock(`tbl[1] = 3`, env3);
  expect(luaValueToJS(env3.get("tbl"), sf)).toEqual([3, 2, 3]);
  await evalBlock("tbl.name = 'Zef'", env3);
  expect(env3.get("tbl").get("name")).toEqual("Zef");
  await evalBlock(`tbl[2] = {age=10}`, env3);
  await evalBlock(`tbl[2].age = 20`, env3);
  expect(env3.get("tbl").get(2).get("age")).toEqual(20);

  // Blocks and scopes
  const env4 = new LuaEnv();
  env4.set("print", new LuaNativeJSFunction(console.log));
  await evalBlock(
    `
    a = 1
    do
        -- sets global a to 3
        a = 3
        print("The number is: " .. a)
    end`,
    env4,
  );
  expect(env4.get("a")).toEqual(3);

  const env5 = new LuaEnv();
  env5.set("print", new LuaNativeJSFunction(console.log));

  await evalBlock(
    `
    a = 1
    if a > 0 then
        a = 3
    else
        a = 0
    end`,
    env5,
  );
  expect(env5.get("a")).toEqual(3);

  await evalBlock(
    `
    if a < 0 then
        a = -1
    elseif a > 0 then
        a = 1
    else
        a = 0
    end`,
    env5,
  );
  expect(env5.get("a")).toEqual(1);

  await evalBlock(
    `
        var = 1
        do
            local var
            var = 2
        end`,
    env5,
  );
  expect(env5.get("var")).toEqual(1);

  // While loop
  const env6 = new LuaEnv();
  await evalBlock(
    `
        c = 0
        while true do
            c = c + 1
            if c == 3 then
                break
            end
        end
    `,
    env6,
  );
  expect(env6.get("c")).toEqual(3);

  // Repeat loop
  const env7 = new LuaEnv();
  await evalBlock(
    `
        c = 0
        repeat
            c = c + 1
            if c == 3 then
                break
            end
        until false
    `,
    env7,
  );
  expect(env7.get("c")).toEqual(3);

  // Function definition and calling
  const env8 = new LuaEnv();
  env8.set("print", new LuaNativeJSFunction(console.log));
  await evalBlock(
    `
        function test(a)
            return a + 1
        end
        print("3 + 1 = " .. test(3))
    `,
    env8,
  );

  // Local fucntion definition
  const env9 = new LuaEnv();
  env9.set("print", new LuaNativeJSFunction(console.log));
  await evalBlock(
    `
        local function test(a)
            return a + 1
        end
        print("3 + 1 = " .. test(3))
    `,
    env9,
  );

  // For loop over range
  const env10 = new LuaEnv();
  await evalBlock(
    `
        c = 0
        for i = 1, 3 do
            c = c + i
        end
    `,
    env10,
  );
  expect(env10.get("c")).toEqual(6);

  // For loop over iterator
  const env11 = new LuaEnv(luaBuildStandardEnv());
  await evalBlock(
    `
      function fruits()
        local list = { "apple", "banana", "cherry" }
        -- Track index internally
        local index = 0

        return function()
            index = index + 1
            if list[index] then
                return list[index]
            end
        end
      end

      for fruit in fruits() do
        print("Fruit: " .. fruit)
      end
    `,
    env11,
  );

  await evalBlock(
    `
    for _, f in ipairs({ "apple", "banana", "cherry" }) do
      print("Fruit: " .. f)
    end`,
    luaBuildStandardEnv(),
  );

  // Passing a Lua function as callback to a JS function
  const env12 = new LuaEnv();
  env12.set(
    "runMe",
    new LuaNativeJSFunction((fn) => {
      return fn("Lua");
    }),
  );
  expect(
    await evalExpr(
      `runMe(function(name) return "Hello from " .. name end)`,
      env12,
    ),
  ).toEqual("Hello from Lua");
});

test("Thread local _CTX", async () => {
  const env = new LuaEnv();
  const threadLocal = new LuaEnv();
  threadLocal.setLocal("threadValue", "test123");

  const sf = new LuaStackFrame(threadLocal, null);

  await evalBlock(
    `
    function test()
      return _CTX.threadValue
    end
  `,
    env,
  );

  const result = await evalExpr("test()", env, sf);
  expect(singleResult(result)).toEqual("test123");
});

test("Thread local _CTX - advanced cases", async () => {
  // Create environment with standard library
  const env = new LuaEnv(luaBuildStandardEnv());
  const threadLocal = new LuaEnv();

  env.setLocal("globalEnv", "GLOBAL");

  // Set up some thread local values
  threadLocal.setLocal("user", "alice");
  threadLocal.setLocal("permissions", new LuaTable());
  threadLocal.get("permissions").set("admin", true);
  threadLocal.setLocal("data", {
    id: 123,
    settings: { theme: "dark" },
  });

  const sf = new LuaStackFrame(threadLocal, null);

  // Test 1: Nested function access
  await evalBlock(
    `
    function outer()
      local function inner()
        return _CTX.user
      end
      return inner()
    end
  `,
    env,
  );
  expect(await evalExpr("outer()", env, sf)).toEqual("alice");

  // Test 2: Table access and modification
  await evalBlock(
    `
    function checkAdmin()
      return _CTX.permissions.admin
    end

    function revokeAdmin()
      _CTX.permissions.admin = false
      return _CTX.permissions.admin
    end
  `,
    env,
  );
  expect(await evalExpr("checkAdmin()", env, sf)).toEqual(true);
  expect(await evalExpr("revokeAdmin()", env, sf)).toEqual(false);
  expect(threadLocal.get("permissions").get("admin")).toEqual(false);

  // Test 3: Complex data structures
  await evalBlock(
    `
    function getNestedData()
      return _CTX.data.settings.theme
    end
    
    function updateTheme(newTheme)
      _CTX.data.settings.theme = newTheme
      return _CTX.data.settings.theme
    end
    `,
    env,
  );
  expect(await evalExpr("getNestedData()", env, sf)).toEqual("dark");
  expect(await evalExpr("updateTheme('light')", env, sf)).toEqual("light");

  // Test 4: Multiple thread locals
  const threadLocal2 = new LuaEnv();
  threadLocal2.setLocal("user", "bob");
  const sf2 = new LuaStackFrame(threadLocal2, null);

  await evalBlock(
    `
    function getUser()
      return _CTX.user
    end
  `,
    env,
  );

  // Same function, different thread contexts
  expect(await evalExpr("getUser()", env, sf)).toEqual("alice");
  expect(await evalExpr("getUser()", env, sf2)).toEqual("bob");

  // Test 5: Async operations with _CTX
  env.set(
    "asyncOperation",
    new LuaNativeJSFunction(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    }),
  );

  await evalBlock(
    `
    function asyncTest()
      _CTX.status = "starting"
      local result = asyncOperation()
      _CTX.status = "completed"
      return _CTX.status
    end
  `,
    env,
  );

  expect(await evalExpr("asyncTest()", env, sf)).toEqual("completed");
  expect(threadLocal.get("status")).toEqual("completed");

  // Test 6: Error handling with _CTX
  await evalBlock(
    `
    function errorTest()
      _CTX.error = nil
      local status, err = pcall(function()
        error("test error")
      end)
      _CTX.error = "caught"
      return _CTX.error
    end
  `,
    env,
  );

  expect(await evalExpr("errorTest()", env, sf)).toEqual("caught");
  expect(threadLocal.get("error")).toEqual("caught");

  // Test string interpolation
  sf.threadLocal.setLocal("_GLOBAL", env);
  expect(
    await evalExpr(
      "spacelua.interpolate('Hello, ${globalEnv} and ${loc}!', {loc='local'})",
      env,
      sf,
    ),
  ).toEqual("Hello, GLOBAL and local!");

  // Some more complex string interpolation with more complex lua expressions, with nested {}
  expect(
    await evalExpr(
      `spacelua.interpolate('Some JSON \${js.stringify(js.tojs({name="Pete"}))}!')`,
      env,
      sf,
    ),
  ).toEqual(`Some JSON {"name":"Pete"}!`);
});

test("Length: rawlen ignores __len", async () => {
  const env = new LuaEnv(luaBuildStandardEnv());

  await evalBlock(
    `
      local t = {1,2,3}
      setmetatable(t, { __len = function() return 99 end })
      a = #t
      b = rawlen(t)
    `,
    env,
  );

  expect(env.get("a")).toEqual(99);
  expect(env.get("b")).toEqual(3);
});
