import { assertEquals } from "../../test_deps.ts";
import { DenoKVStore } from "./kv_store.deno_kv.ts";

Deno.test("Test KV index", async () => {
  const denoKv = await Deno.openKv("test.db");
  const kv = new DenoKVStore(denoKv);

  await kv.set("name", "Peter");
  assertEquals(await kv.get("name"), "Peter");
  await kv.del("name");
  assertEquals(await kv.has("name"), false);

  await kv.batchSet([
    { key: "page:hello", value: "Hello" },
    { key: "page:hello2", value: "Hello 2" },
    { key: "page:hello3", value: "Hello 3" },
    { key: "something", value: "Something" },
    { key: "something1", value: "Something" },
    { key: "something2", value: "Something" },
    { key: "something3", value: "Something" },
    { key: "something4", value: "Something" },
    { key: "something5", value: "Something" },
    { key: "something6", value: "Something" },
    { key: "something7", value: "Something" },
    { key: "something8", value: "Something" },
    { key: "something9", value: "Something" },
    { key: "something10", value: "Something" },
    { key: "something11", value: "Something" },
    { key: "something12", value: "Something" },
    { key: "something13", value: "Something" },
    { key: "something14", value: "Something" },
    { key: "something15", value: "Something" },
    { key: "something16", value: "Something" },
    { key: "something17", value: "Something" },
    { key: "something18", value: "Something" },
    { key: "something19", value: "Something" },
  ]);

  const results = await kv.queryPrefix("page:");
  assertEquals(results.length, 3);

  assertEquals(await kv.batchGet(["page:hello", "page:hello3"]), [
    "Hello",
    "Hello 3",
  ]);

  await kv.deletePrefix("page:");

  assertEquals(await kv.queryPrefix("page:"), []);
  assertEquals((await kv.queryPrefix("")).length, 20);

  await kv.deletePrefix("");
  assertEquals(await kv.queryPrefix(""), []);

  denoKv.close();
  await Deno.remove("test.db");
});
