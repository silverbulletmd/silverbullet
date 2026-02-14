import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import type { KvPrimitives } from "./kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { parseExpressionString } from "../space_lua/parse.ts";

async function runDataStoreTest(db: KvPrimitives) {
  const datastore = new DataStore(db);
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
  expect(results).toEqual([{ name: "Peter" }]);
}

test("Test Memory KV DataStore", async () => {
  const db = new MemoryKvPrimitives(); // In-memory only, no persistence
  await runDataStoreTest(db);
  await db.close();
});

test("Test IndexDB DataStore", async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();
  await runDataStoreTest(db);
  db.close();
});
