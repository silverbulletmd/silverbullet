import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import type { KvPrimitives } from "./kv_primitives.ts";
import { assertEquals } from "@std/assert";
import { PrefixedKvPrimitives } from "./prefixed_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { parseExpressionString } from "../space_lua/parse.ts";

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

Deno.test("Test Memory KV DataStore", async () => {
  const db = new MemoryKvPrimitives(); // In-memory only, no persistence
  await test(db);
  await db.close();
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
