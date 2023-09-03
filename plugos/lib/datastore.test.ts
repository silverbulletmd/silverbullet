import "https://esm.sh/fake-indexeddb@4.0.2/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { DenoKvPrimitives } from "./deno_kv_primitives.ts";
import { KvPrimitives } from "./kv_primitives.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

async function test(db: KvPrimitives) {
  const dataStore = new DataStore(db);
  await dataStore.set(["user", "peter"], { name: "Peter" });
  await dataStore.set(["user", "hank"], { name: "Hank" });
  let results = await dataStore.query({
    prefix: ["user"],
    filter: ["=", "name", "Peter"],
  });
  assertEquals(results, [{ key: ["user", "peter"], value: { name: "Peter" } }]);
  await dataStore.batchSet([
    { key: ["kv", "name"], value: "Zef" },
    { key: ["kv", "data"], value: new Uint8Array([1, 2, 3]) },
    {
      key: ["kv", "complicated"],
      value: {
        name: "Frank",
        parents: ["John", "Jane"],
        address: {
          street: "123 Main St",
          city: "San Francisco",
        },
      },
    },
  ]);
  assertEquals(await dataStore.get(["kv", "name"]), "Zef");
  assertEquals(await dataStore.get(["kv", "data"]), new Uint8Array([1, 2, 3]));
  results = await dataStore.query({
    prefix: ["kv"],
    filter: ["=", "", "Zef"],
  });
  assertEquals(results, [{ key: ["kv", "name"], value: "Zef" }]);
  results = await dataStore.query({
    prefix: ["kv"],
    filter: ["and", ["=", "parents", "John"], [
      "=",
      "address.city",
      "San Francisco",
    ]],
  });
  assertEquals(results[0].key, ["kv", "complicated"]);
}

Deno.test("Test Deno KV DataStore", async () => {
  const tmpFile = await Deno.makeTempFile();
  const db = new DenoKvPrimitives(tmpFile);
  await db.init();
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
