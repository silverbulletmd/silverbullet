import { DenoKVStore } from "../../plugos/lib/kv_store.deno_kv.ts";
import { assertEquals } from "../../test_deps.ts";
import { pageIndexSyscalls } from "./index.ts";

Deno.test("Test KV index", async () => {
  const ctx: any = {};
  const kv = new DenoKVStore();
  await kv.init("test.db");
  const calls = pageIndexSyscalls(kv);
  await calls["index.set"](ctx, "page", "test", "value");
  assertEquals(await calls["index.get"](ctx, "page", "test"), "value");
  await calls["index.delete"](ctx, "page", "test");
  assertEquals(await calls["index.get"](ctx, "page", "test"), null);
  await calls["index.batchSet"](ctx, "page", [{
    key: "attr:test",
    value: "value",
  }, {
    key: "attr:test2",
    value: "value2",
  }, { key: "random", value: "value3" }]);
  await calls["index.batchSet"](ctx, "page2", [{
    key: "attr:test",
    value: "value",
  }, {
    key: "attr:test2",
    value: "value2",
  }, { key: "random", value: "value3" }]);
  let results = await calls["index.queryPrefix"](ctx, "attr:");
  assertEquals(results.length, 4);
  await calls["index.clearPageIndexForPage"](ctx, "page");
  results = await calls["index.queryPrefix"](ctx, "attr:");
  assertEquals(results.length, 2);
  await calls["index.clearPageIndex"](ctx);
  results = await calls["index.queryPrefix"](ctx, "");
  assertEquals(results.length, 0);
  await kv.delete();
});
