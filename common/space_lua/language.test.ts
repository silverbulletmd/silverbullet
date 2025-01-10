import { parse } from "$common/space_lua/parse.ts";
import { luaBuildStandardEnv } from "$common/space_lua/stdlib.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { evalStatement } from "$common/space_lua/eval.ts";
import { assert } from "@std/assert/assert";
import { fileURLToPath } from "node:url";

Deno.test("Lua language tests", async () => {
  // Read the Lua file
  const luaFile = await Deno.readTextFile(
    fileURLToPath(new URL("./language_test.lua", import.meta.url)),
  );
  const chunk = parse(luaFile, {});
  const env = new LuaEnv(luaBuildStandardEnv());
  const sf = new LuaStackFrame(new LuaEnv(), chunk.ctx);
  sf.threadLocal.setLocal("_GLOBAL", env);

  try {
    await evalStatement(chunk, env, sf);
  } catch (e: any) {
    if (e instanceof LuaRuntimeError) {
      console.error(`Error evaluating script:`, e.toPrettyString(luaFile));
    } else {
      console.error(`Error evaluating script:`, e);
    }
    assert(false);
  }
});
