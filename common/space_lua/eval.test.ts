import { assertEquals } from "@std/assert/equals";
import { LuaEnv, LuaNativeJSFunction, singleResult } from "./runtime.ts";
import { parse } from "./parse.ts";
import type { LuaBlock, LuaFunctionCallStatement } from "./ast.ts";
import { evalExpression, evalStatement } from "./eval.ts";

function evalExpr(s: string, e = new LuaEnv()): any {
    return evalExpression(
        (parse(`e(${s})`).statements[0] as LuaFunctionCallStatement).call
            .args[0],
        e,
    );
}

function evalBlock(s: string, e = new LuaEnv()): Promise<void> {
    return evalStatement(parse(s) as LuaBlock, e);
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
    assertEquals(tbl.toArray(), [3, 1, 2]);

    assertEquals(evalExpr(`{name=test("Zef"), age=100}`, env).toObject(), {
        name: "Zef",
        age: 100,
    });

    assertEquals(
        (await evalExpr(`{name="Zef", age=asyncTest(100)}`, env)).toObject(),
        {
            name: "Zef",
            age: 100,
        },
    );

    assertEquals(evalExpr(`{[3+2]=1, ["a".."b"]=2}`).toObject(), {
        5: 1,
        ab: 2,
    });

    assertEquals(evalExpr(`#{}`), 0);
    assertEquals(evalExpr(`#{1, 2, 3}`), 3);

    // Unary operators
    assertEquals(await evalExpr(`-asyncTest(3)`, env), -3);

    // Function calls
    assertEquals(singleResult(evalExpr(`test(3)`, env)), 3);
    assertEquals(singleResult(await evalExpr(`asyncTest(3) + 1`, env)), 4);
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
    assertEquals(env3.get("tbl").toArray(), [3, 2, 3]);
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
});
