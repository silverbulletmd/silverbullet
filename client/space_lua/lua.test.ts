import { expect, test } from "vitest";
import { parse } from "./parse.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./runtime.ts";
import { evalStatement } from "./eval.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("[Lua] Core language", async () => {
  await runLuaTest("./language_core_test.lua");
});

test("[Lua] Core language (labels and goto)", async () => {
  await runLuaTest("./goto_test.lua");
});

test("[Lua] Core language (length)", async () => {
  await runLuaTest("./len_test.lua");
});

test("[Lua] Core language (truthiness)", async () => {
  await runLuaTest("./truthiness_test.lua");
});

test("[Lua] Core language (arithmetic)", async () => {
  await runLuaTest("./arithmetic_test.lua");
});

test("[Lua] Core language (metamethods)", async () => {
  await runLuaTest("./metamethods_test.lua");
});

test("[Lua] Load tests", async () => {
  await runLuaTest("./stdlib/load_test.lua");
});

test("[Lua] Core language (length)", async () => {
  await runLuaTest("./len_test.lua");
});

test("[Lua] Format tests", async () => {
  await runLuaTest("./stdlib/format_test.lua");
});

test("[Lua] String to number tests", async () => {
  await runLuaTest("./tonumber_test.lua");
});

test("[Lua] String tests", async () => {
  await runLuaTest("./stdlib/string_test.lua");
  // await runLuaTest("./stdlib/string_test2.lua");
});

test("[Lua] Space Lua tests", async () => {
  await runLuaTest("./stdlib/space_lua_test.lua");
});

test("[Lua] OS tests", async () => {
  await runLuaTest("./stdlib/os_test.lua");
});

test("[Lua] Math tests", async () => {
  await runLuaTest("./stdlib/math_test.lua");
});

test("[Lua] JS tests", async () => {
  await runLuaTest("./stdlib/js_test.lua");
});

test("[Lua] Global functions tests", async () => {
  await runLuaTest("./stdlib/global_test.lua");
});

test("[Lua] Encoding functions tests", async () => {
  await runLuaTest("./stdlib/encoding_test.lua");
});

test("[Lua] Crypto functions tests", async () => {
  await runLuaTest("./stdlib/crypto_test.lua");
});

test("[Lua] Lume functions tests", async () => {
  await runLuaTest("./lume_test.lua");
});

async function runLuaTest(luaPath: string) {
  const luaFile = await readFile(
    fileURLToPath(new URL(luaPath, import.meta.url)),
    "utf-8"
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
    expect(false).toBeTruthy();
  }
}
