import "https://esm.sh/fake-indexeddb@4.0.2/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { DenoKvPrimitives } from "./deno_kv_primitives.ts";
import { KvPrimitives } from "./kv_primitives.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";
import { PrefixedKvPrimitives } from "./prefixed_kv_primitives.ts";

async function test(db: KvPrimitives) {
  const datastore = new DataStore(new PrefixedKvPrimitives(db, ["ds"]), {
    count: (arr: any[]) => arr.length,
  });
  await datastore.set(["user", "peter"], { name: "Peter" });
  await datastore.set(["user", "hank"], { name: "Hank" });
  let results = await datastore.query({
    prefix: ["user"],
    filter: ["=", ["attr", "name"], ["string", "Peter"]],
  });
  assertEquals(results, [{ key: ["user", "peter"], value: { name: "Peter" } }]);

  assertEquals(
    [{ key: ["user", "hank"], value: { name: "Hank" } }, {
      key: ["user", "peter"],
      value: { name: "Peter" },
    }],
    await datastore.query({
      prefix: ["user"],
      orderBy: [{ expr: ["attr", "name"], desc: false }],
    }),
  );
  assertEquals(
    [{ key: ["user", "peter"], value: { name: "Peter" } }, {
      key: ["user", "hank"],
      value: { name: "Hank" },
    }],
    await datastore.query({
      prefix: ["user"],
      orderBy: [{ expr: ["attr", "name"], desc: true }],
    }),
  );

  await datastore.batchSet<any>([
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
  assertEquals(await datastore.get(["kv", "name"]), "Zef");
  assertEquals(await datastore.get(["kv", "data"]), new Uint8Array([1, 2, 3]));
  results = await datastore.query({
    prefix: ["kv"],
    filter: ["=~", ["attr", ""], ["regexp", "Z.f", "i"]],
  });
  assertEquals(results, [{ key: ["kv", "name"], value: "Zef" }]);
  results = await datastore.query({
    prefix: ["kv"],
    filter: ["and", ["=", ["attr", "parents"], ["string", "John"]], [
      "=",
      ["attr", ["attr", "address"], "city"],
      ["string", "San Francisco"],
    ]],
    select: [
      { name: "parents" },
      {
        name: "name",
        expr: ["+", ["attr", "name"], ["string", "!"]],
      },
      {
        name: "parentCount",
        expr: ["call", "count", [["attr", "parents"]]],
      },
    ],
  });
  assertEquals(results.length, 1);
  assertEquals(results[0], {
    key: ["kv", "complicated"],
    value: { name: "Frank!", parentCount: 2, parents: ["John", "Jane"] },
  });
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
