import { parse } from "$common/space_lua/parse.ts";
import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";
import {
  LuaEnv,
  type LuaRuntimeError,
  LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { evalStatement } from "$common/space_lua/eval.ts";
import { assert } from "@std/assert/assert";
Deno.test("Lua language tests", async () => {
  // Read the Lua file
  const luaFile = await Deno.readTextFile(
    new URL("./language_test.lua", import.meta.url).pathname,
  );
  const chunk = parse(luaFile, {});
  const env = new LuaEnv(luaBuildStandardEnv());
  const sf = new LuaStackFrame(new LuaEnv(), chunk.ctx);

  try {
    await evalStatement(chunk, env, sf);
  } catch (e: any) {
    console.error(`Error evaluating script:`, toPrettyString(e, luaFile));
    assert(false);
  }
});

function toPrettyString(err: LuaRuntimeError, code: string): string {
  if (!err.sf || !err.sf.astCtx?.from || !err.sf.astCtx?.to) {
    return err.toString();
  }
  let traceStr = "";
  let current: LuaStackFrame | undefined = err.sf;
  while (current) {
    const ctx = current.astCtx;
    if (!ctx || !ctx.from || !ctx.to) {
      break;
    }
    // Find the line and column
    let line = 1;
    let column = 0;
    for (let i = 0; i < ctx.from; i++) {
      if (code[i] === "\n") {
        line++;
        column = 0;
      } else {
        column++;
      }
    }
    traceStr += `* ${ctx.ref || "(unknown source)"} @ ${line}:${column}:\n   ${
      code.substring(ctx.from, ctx.to)
    }\n`;
    current = current.parent;
  }

  return `LuaRuntimeError: ${err.message} ${traceStr}`;
}
