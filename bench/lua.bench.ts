import { parse } from "../client/space_lua/parse.ts";
import { luaBuildStandardEnv } from "../client/space_lua/stdlib.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
} from "../client/space_lua/runtime.ts";
import { evalStatement } from "../client/space_lua/eval.ts";
import { assert } from "@std/assert/assert";
import { fileURLToPath } from "node:url";

Deno.bench("[Lua] Core language", async () => {
  await runLuaTest("../client/space_lua/language_core_test.lua");
});

Deno.bench("[Lua] Core language (length)", async () => {
  await runLuaTest("../client/space_lua/len_test.lua");
});

Deno.bench("[Lua] Core language (truthiness)", async () => {
  await runLuaTest("../client/space_lua/truthiness_test.lua");
});

Deno.bench("[Lua] Core language (arithmetic)", async () => {
  await runLuaTest("../client/space_lua/arithmetic_test.lua");
});

Deno.bench("[Lua] Load tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/load_test.lua");
});

Deno.bench("[Lua] Table tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/table_test.lua");
});

Deno.bench("[Lua] String to number tests", async () => {
  await runLuaTest("../client/space_lua/tonumber_test.lua");
});

Deno.bench("[Lua] String tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/string_test.lua");
  // await runLuaTest("../client/space_lua/stdlib/string_test2.lua");
});

Deno.bench("[Lua] Space Lua tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/space_lua_test.lua");
});

Deno.bench("[Lua] OS tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/os_test.lua");
});

Deno.bench("[Lua] Math tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/math_test.lua");
});

Deno.bench("[Lua] JS tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/js_test.lua");
});

Deno.bench("[Lua] Global functions tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/global_test.lua");
});

Deno.bench("[Lua] Encoding functions tests", async () => {
  await runLuaTest("../client/space_lua/stdlib/encoding_test.lua");
});

Deno.bench("[Lua] Lume functions tests", async () => {
  await runLuaTest("../client/space_lua/lume_test.lua");
});

async function runLuaTest(luaPath: string) {
  const luaFile = await Deno.readTextFile(
    fileURLToPath(new URL(luaPath, import.meta.url)),
  );
  const chunk = parse(luaFile, {});
  const env = new LuaEnv(luaBuildStandardEnv());
  const sf = LuaStackFrame.createWithGlobalEnv(env, chunk.ctx);

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
