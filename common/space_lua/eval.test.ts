import { assertEquals } from "@std/assert/equals";
import {
    evalExpression,
    LuaEnv,
    LuaNativeJSFunction,
    singleResult,
} from "./eval.ts";
import { type LuaFunctionCallStatement, parse } from "./parse.ts";

function evalExpr(s: string, e = new LuaEnv()): any {
    return evalExpression(
        (parse(`e(${s})`).statements[0] as LuaFunctionCallStatement).call
            .args[0],
        e,
    );
}

Deno.test("Evaluator test", async () => {
    const env = new LuaEnv();
    env.set("test", new LuaNativeJSFunction(() => 3));
    env.set("asyncTest", new LuaNativeJSFunction(() => Promise.resolve(3)));
    assertEquals(evalExpr(`1 + 2`), 3);

    assertEquals(singleResult(evalExpr(`test()`, env)), 3);
    assertEquals(singleResult(await evalExpr(`asyncTest() + 1`, env)), 4);
});
