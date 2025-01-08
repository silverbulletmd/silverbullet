import { assertEquals } from "@std/assert/equals";
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
import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";

function evalExpr(s: string, e = new LuaEnv(), sf?: LuaStackFrame): any {
  const node = parse(`e(${s})`).statements[0] as LuaFunctionCallStatement;
  sf = sf || new LuaStackFrame(e, node.ctx);
  return evalExpression(
    node.call.args[0],
    e,
    sf,
  );
}

function evalBlock(s: string, e = new LuaEnv()): Promise<void> {
  const node = parse(s) as LuaBlock;
  const sf = new LuaStackFrame(e, node.ctx);
  return evalStatement(node, e, sf);
}

Deno.test("Evaluator test", async () => {
  const env = new LuaEnv();
  env.set("test", new LuaNativeJSFunction((n) => n));
  env.set("asyncTest", new LuaNativeJSFunction((n) => Promise.resolve(n)));

  // Basic arithmetic
  assertEquals(evalExpr(`1 + 2 + 3 - 3`), 3);
  assertEquals(evalExpr(`4 // 3`), 1);
  assertEquals(evalExpr(`4 % 3`), 1);

  // Strings
  assertEquals(evalExpr(`"a" .. "b"`), "ab");

  // Logic
  assertEquals(evalExpr(`true and false`), false);
  assertEquals(evalExpr(`true or false`), true);
  assertEquals(evalExpr(`not true`), false);

  // Tables
  const tbl = evalExpr(`{3, 1, 2}`);
  assertEquals(tbl.get(1), 3);
  assertEquals(tbl.get(2), 1);
  assertEquals(tbl.get(3), 2);
  assertEquals(luaValueToJS(tbl), [3, 1, 2]);

  assertEquals(luaValueToJS(evalExpr(`{name=test("Zef"), age=100}`, env)), {
    name: "Zef",
    age: 100,
  });

  assertEquals(
    luaValueToJS(await evalExpr(`{name="Zef", age=asyncTest(100)}`, env)),
    {
      name: "Zef",
      age: 100,
    },
  );

  const result = evalExpr(`{[3+2]=1, ["a".."b"]=2}`);
  assertEquals(result.get(5), 1);
  assertEquals(result.get("ab"), 2);

  assertEquals(evalExpr(`#{}`), 0);
  assertEquals(evalExpr(`#{1, 2, 3}`), 3);

  // Unary operators
  assertEquals(await evalExpr(`-asyncTest(3)`, env), -3);

  // Function calls
  assertEquals(singleResult(evalExpr(`test(3)`, env)), 3);
  assertEquals(singleResult(await evalExpr(`asyncTest(3) + 1`, env)), 4);

  // Function expressions and table access
  assertEquals(
    await evalExpr(`(function() return {name="John"} end)().name`),
    "John",
  );

  // Function definitions
  const fn = evalExpr(`function(a, b) return a + b end`);
  assertEquals(fn.body.parameters, ["a", "b"]);
});

Deno.test("Statement evaluation", async () => {
  const env = new LuaEnv();
  env.set("test", new LuaNativeJSFunction((n) => n));
  env.set("asyncTest", new LuaNativeJSFunction((n) => Promise.resolve(n)));

  assertEquals(undefined, await evalBlock(`a = 3`, env));
  assertEquals(env.get("a"), 3);
  assertEquals(undefined, await evalBlock(`b = test(3)`, env));
  assertEquals(env.get("b"), 3);

  await evalBlock(`c = asyncTest(3)`, env);
  assertEquals(env.get("c"), 3);

  // Multiple assignments
  const env2 = new LuaEnv();
  assertEquals(undefined, await evalBlock(`a, b = 1, 2`, env2));
  assertEquals(env2.get("a"), 1);
  assertEquals(env2.get("b"), 2);

  // Other lvalues
  const env3 = new LuaEnv();
  await evalBlock(`tbl = {1, 2, 3}`, env3);
  await evalBlock(`tbl[1] = 3`, env3);
  assertEquals(luaValueToJS(env3.get("tbl")), [3, 2, 3]);
  await evalBlock("tbl.name = 'Zef'", env3);
  assertEquals(env3.get("tbl").get("name"), "Zef");
  await evalBlock(`tbl[2] = {age=10}`, env3);
  await evalBlock(`tbl[2].age = 20`, env3);
  assertEquals(env3.get("tbl").get(2).get("age"), 20);

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
  assertEquals(env4.get("a"), 3);

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
  assertEquals(env5.get("a"), 3);

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
  assertEquals(env5.get("a"), 1);

  await evalBlock(
    `
        var = 1
        do
            local var
            var = 2
        end`,
    env5,
  );
  assertEquals(env5.get("var"), 1);

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
  assertEquals(env6.get("c"), 3);

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
  assertEquals(env7.get("c"), 3);

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
  assertEquals(env10.get("c"), 6);

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
});

Deno.test("Thread local _CTX", async () => {
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
  assertEquals(singleResult(result), "test123");
});

Deno.test("Thread local _CTX - advanced cases", async () => {
  // Create environment with standard library
  const env = new LuaEnv(luaBuildStandardEnv());
  const threadLocal = new LuaEnv();

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
  assertEquals(await evalExpr("outer()", env, sf), "alice");

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
  assertEquals(await evalExpr("checkAdmin()", env, sf), true);
  assertEquals(await evalExpr("revokeAdmin()", env, sf), false);
  assertEquals(threadLocal.get("permissions").get("admin"), false);

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
  assertEquals(await evalExpr("getNestedData()", env, sf), "dark");
  assertEquals(await evalExpr("updateTheme('light')", env, sf), "light");

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
  assertEquals(await evalExpr("getUser()", env, sf), "alice");
  assertEquals(await evalExpr("getUser()", env, sf2), "bob");

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

  assertEquals(await evalExpr("asyncTest()", env, sf), "completed");
  assertEquals(threadLocal.get("status"), "completed");

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

  assertEquals(await evalExpr("errorTest()", env, sf), "caught");
  assertEquals(threadLocal.get("error"), "caught");
});
