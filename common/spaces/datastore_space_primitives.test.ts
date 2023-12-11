import "https://esm.sh/fake-indexeddb@4.0.2/auto";
import { DataStore } from "../../plugos/lib/datastore.ts";
import { IndexedDBKvPrimitives } from "../../plugos/lib/indexeddb_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";
import { testSpacePrimitives } from "./space_primitives.test.ts";

Deno.test("DataStoreSpacePrimitives", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();

  const space = new DataStoreSpacePrimitives(new DataStore(db));
  await testSpacePrimitives(space);
  db.close();
});
