import { assertEquals } from "@std/assert/equals";
import { LuaEnv, LuaNativeJSFunction, singleResult } from "./runtime.ts";
import { parse } from "./parse.ts";
import type { LuaFunctionCallStatement } from "./ast.ts";
import { evalExpression } from "./eval.ts";

function evalExpr(s: string, e = new LuaEnv()): any {
    return evalExpression(
        (parse(`e(${s})`).statements[0] as LuaFunctionCallStatement).call
            .args[0],
        e,
    );
}

Deno.test("Evaluator test", async () => {
    const env = new LuaEnv();
    env.set("test", new LuaNativeJSFunction((n) => n));
    env.set("asyncTest", new LuaNativeJSFunction((n) => Promise.resolve(n)));

    // Basic arithmetic
    assertEquals(evalExpr(`1 + 2 + 3 - 3`), 3);
    assertEquals(evalExpr(`4 // 3`), 1);
    assertEquals(evalExpr(`4 % 3`), 1);

    // Tables
    const tbl = evalExpr(`{3, 1, 2}`);
    assertEquals(tbl.entries.get(1), 3);
    assertEquals(tbl.entries.get(2), 1);
    assertEquals(tbl.entries.get(3), 2);
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

    assertEquals(singleResult(evalExpr(`test(3)`, env)), 3);
    assertEquals(singleResult(await evalExpr(`asyncTest(3) + 1`, env)), 4);
});
