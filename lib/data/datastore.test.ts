import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "../data/indexeddb_kv_primitives.ts";
import { DenoKvPrimitives } from "../data/deno_kv_primitives.ts";
import type { KvPrimitives } from "../data/kv_primitives.ts";
import { assertEquals } from "@std/assert";
import { PrefixedKvPrimitives } from "../data/prefixed_kv_primitives.ts";
import { DataStore } from "$lib/data/datastore.ts";
import { LuaEnv, LuaStackFrame } from "$common/space_lua/runtime.ts";
import { parseExpressionString } from "$common/space_lua/parse.ts";

async function test(db: KvPrimitives) {
  const datastore = new DataStore(new PrefixedKvPrimitives(db, ["ds"]));
  await datastore.set(["user", "peter"], { name: "Peter" });
  await datastore.set(["user", "hank"], { name: "Hank" });
  const env = new LuaEnv();
  const sf = LuaStackFrame.lostFrame;

  // Basic test, fancier tests are done in common/space_lua/query_collection.test.ts
  const results = await datastore.luaQuery(
    ["user"],
    {
      objectVariable: "user",
      where: parseExpressionString("user.name == 'Peter'"),
    },
    env,
    sf,
  );
  assertEquals(results, [{ name: "Peter" }]);
}

Deno.test("Test Deno KV DataStore", async () => {
  const tmpFile = await Deno.makeTempFile();
  const db = new DenoKvPrimitives(await Deno.openKv(tmpFile));
  await test(db);
  db.close();
  await Deno.remove(tmpFile);
});

Deno.test("Test IndexDB DataStore", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();
  await test(db);
  db.close();
});
