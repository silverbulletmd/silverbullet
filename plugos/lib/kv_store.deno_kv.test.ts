import { assertEquals } from "../../test_deps.ts";
import { DenoKVStore } from "./kv_store.deno_kv.ts";

Deno.test("Test KV index", async () => {
  const kv = new DenoKVStore();
  await kv.init("test.db");

  await kv.set("name", "Peter");
  assertEquals(await kv.get("name"), "Peter");
  await kv.del("name");
  assertEquals(await kv.has("name"), false);

  await kv.batchSet([
    { key: "page:hello", value: "Hello" },
    { key: "page:hello2", value: "Hello 2" },
    { key: "page:hello3", value: "Hello 3" },
    { key: "something", value: "Something" },
  ]);

  const results = await kv.queryPrefix("page:");
  assertEquals(results.length, 3);

  assertEquals(await kv.batchGet(["page:hello", "page:hello3"]), [
    "Hello",
    "Hello 3",
  ]);

  await kv.delete();
});
