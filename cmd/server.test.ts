import { assertEquals } from "@std/assert";
import { LuaStackFrame, LuaTable } from "../common/space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../common/space_lua/stdlib.ts";

// Helper function to set up a Lua environment with standard library functions
function setupLuaEnv() {
  const env = luaBuildStandardEnv();
  const sf = new LuaStackFrame(env, null);
  sf.threadLocal.set("_GLOBAL", env);
  return { env, sf };
}

Deno.test("SB_INDEX_PAGE template interpolation", async (t) => {
  await t.step("simple string - no interpolation", async () => {
    const { env, sf } = setupLuaEnv();
    const result = await env.get("spacelua").get("interpolate").call(
      sf,
      "Journal",
      new LuaTable(),
    );
    assertEquals(result, "Journal", "Simple string is returned as-is");
  });

  await t.step("default behavior - no interpolation", async () => {
    const { env, sf } = setupLuaEnv();
    const result = await env.get("spacelua").get("interpolate").call(
      sf,
      "index",
      new LuaTable(),
    );
    assertEquals(result, "index", "Default index page is 'index'");
  });

  await t.step("string function interpolation", async () => {
    const { env, sf } = setupLuaEnv();
    const result = await env.get("spacelua").get("interpolate").call(
      sf,
      "Journal/${string.upper('test')}",
      new LuaTable(),
    );
    assertEquals(
      result,
      "Journal/TEST",
      "String function is correctly evaluated",
    );
  });

  await t.step("error handling - invalid Lua expression", async () => {
    const { env, sf } = setupLuaEnv();
    try {
      await env.get("spacelua").get("interpolate").call(
        sf,
        "Journal/${invalid + expression}",
        new LuaTable(),
      );
      throw new Error("Expected invalid expression to throw an error");
    } catch (e: any) {
      assertEquals(typeof e.message, "string", "Error message is a string");
      assertEquals(e.message !== "", true, "Error message is not empty");
    }
  });

  await t.step("SB_INDEX_PAGE with os.date", async () => {
    const { env, sf } = setupLuaEnv();
    const result = await env.get("spacelua").get("interpolate").call(
      sf,
      "Journal/${os.date('%Y-%m-%d')}",
      new LuaTable(),
    );
    assertEquals(typeof result, "string", "Result is a string");
    assertEquals(result.startsWith("Journal/"), true, "Result starts with Journal/");
    assertEquals(result.length > "Journal/".length, true, "Result contains date");
  });

  await t.step("SB_INDEX_PAGE with multiple expressions", async () => {
    const { env, sf } = setupLuaEnv();
    const result = await env.get("spacelua").get("interpolate").call(
      sf,
      "Journal/${os.date('%Y')}/${os.date('%m')}/${os.date('%d')}",
      new LuaTable(),
    );
    assertEquals(typeof result, "string", "Result is a string");
    assertEquals(result.startsWith("Journal/"), true, "Result starts with Journal/");
    assertEquals(result.split("/").length >= 4, true, "Result contains multiple date parts");
  });
});
