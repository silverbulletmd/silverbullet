import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "../data/indexeddb_kv_primitives.ts";
import { DataStore } from "../data/datastore.ts";
import { DenoKvPrimitives } from "../data/deno_kv_primitives.ts";
import { KvPrimitives } from "../data/kv_primitives.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { PrefixedKvPrimitives } from "../data/prefixed_kv_primitives.ts";
import { Query } from "../../plug-api/types.ts";

async function test(db: KvPrimitives) {
  const datastore = new DataStore(new PrefixedKvPrimitives(db, ["ds"]), {
    count: (arr: any[]) => arr.length,
    $query: (_query: Query) => {
      return Promise.resolve([]);
    },
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

  assertEquals(
    await datastore.query({
      prefix: ["kv"],
      limit: ["number", 1],
      select: [
        {
          name: "random",
          expr: ["query", { querySource: "bla" }],
        },
      ],
    }),
    [{ key: ["kv", "complicated"], value: { random: [] } }],
  );
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
