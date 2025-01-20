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

Deno.test("[Lua] Core language", async () => {
  await runLuaTest("./language_core_test.lua");
});

Deno.test("[Lua] Table tests", async () => {
  await runLuaTest("./stdlib/table_test.lua");
});

Deno.test("[Lua] String tests", async () => {
  await runLuaTest("./stdlib/string_test.lua");
});

Deno.test("[Lua] Space Lua tests", async () => {
  await runLuaTest("./stdlib/space_lua_test.lua");
});

Deno.test("[Lua] OS tests", async () => {
  await runLuaTest("./stdlib/os_test.lua");
});

Deno.test("[Lua] Math tests", async () => {
  await runLuaTest("./stdlib/math_test.lua");
});

Deno.test("[Lua] JS tests", async () => {
  await runLuaTest("./stdlib/js_test.lua");
});

async function runLuaTest(luaPath: string) {
  const luaFile = await Deno.readTextFile(
    fileURLToPath(new URL(luaPath, import.meta.url)),
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
}
