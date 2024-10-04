import { parse } from "$common/space_lua/parse.ts";
import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";
import { LuaEnv, type LuaRuntimeError } from "$common/space_lua/runtime.ts";
import { evalStatement } from "$common/space_lua/eval.ts";
import { assert } from "@std/assert/assert";

Deno.test("Lua language tests", async () => {
    // Read the Lua file
    const luaFile = await Deno.readTextFile(
        new URL("./language_test.lua", import.meta.url).pathname,
    );
    const chunk = parse(luaFile, {});
    const env = new LuaEnv(luaBuildStandardEnv());

    try {
        await evalStatement(chunk, env);
    } catch (e: any) {
        console.error(`Error evaluating script:`, toPrettyString(e, luaFile));
        assert(false);
    }
});

function toPrettyString(err: LuaRuntimeError, code: string): string {
    if (!err.context.from || !err.context.to) {
        return err.toString();
    }
    const from = err.context.from;
    // Find the line and column
    let line = 1;
    let column = 0;
    for (let i = 0; i < from; i++) {
        if (code[i] === "\n") {
            line++;
            column = 0;
        } else {
            column++;
        }
    }
    return `LuaRuntimeError: ${err.message} at ${line}:${column}:\n   ${
        code.substring(from, err.context.to)
    }`;
}
