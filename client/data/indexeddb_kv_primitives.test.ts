import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { allTests } from "./kv_primitives.test.ts";

Deno.test("Test IDB key primitives", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();
  await allTests(db);
  db.close();
});
