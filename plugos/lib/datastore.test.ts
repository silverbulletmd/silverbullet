import "https://esm.sh/fake-indexeddb@4.0.2/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { DenoKvPrimitives } from "./deno_kv_primitives.ts";
import { KvPrimitives } from "./kv_primitives.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

async function test(db: KvPrimitives) {
  const dataStore = new DataStore(db, {
    count: (arr: any[]) => arr.length,
  });
  await dataStore.set(["user", "peter"], { name: "Peter" });
  await dataStore.set(["user", "hank"], { name: "Hank" });
  let results = await dataStore.query({
    prefix: ["user"],
    filter: ["=", ["attr", "name"], ["string", "Peter"]],
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
    filter: ["=", ["attr", ""], ["string", "Zef"]],
  });
  assertEquals(results, [{ key: ["kv", "name"], value: "Zef" }]);
  results = await dataStore.query({
    prefix: ["kv"],
    filter: ["and", ["=", ["attr", "parents"], ["string", "John"]], [
      "=",
      ["attr", "address.city"],
      ["string", "San Francisco"],
    ]],
    select: [
      { name: "parents" },
      {
        name: "name",
        expr: ["binop", "+", ["attr", "name"], ["string", "!"]],
      },
      {
        name: "parentCount",
        expr: ["call", "count", [["attr", "parents"]]],
      },
    ],
  });
  assertEquals(results[0], {
    key: ["kv", "complicated"],
    value: { name: "Frank!", parentCount: 2, parents: ["John", "Jane"] },
  });
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
