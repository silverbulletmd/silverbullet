import { allTests } from "./kv_primitives.test.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";

Deno.test("Test Memory KV Primitives", async () => {
  const db = new MemoryKvPrimitives();
  await allTests(db);
  db.close();
});
