import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { allTests } from "./kv_primitives.test.ts";

test("Test IDB key primitives", async () => {
  const db = new IndexedDBKvPrimitives("test");
  await db.init();
  await allTests(db);
  db.close();
});
