import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "../data/indexeddb_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";
import { testSpacePrimitives } from "./space_primitives.test.ts";

test("DataStoreSpacePrimitives", async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();

  const space = new DataStoreSpacePrimitives(db);
  await testSpacePrimitives(space);
  db.close();
});
