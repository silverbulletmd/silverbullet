import { assertEquals } from "https://deno.land/std@0.152.0/testing/asserts.ts";
import { AsyncSQLite } from "../../plugos/sqlite/async_sqlite.ts";
import { ensureTable, pageIndexSyscalls } from "./index.ts";

const fakeContext = {} as any;

Deno.test("Page index", async () => {
  const db = new AsyncSQLite(":memory:");
  await db.init();
  await ensureTable(db);
  const syscalls = pageIndexSyscalls(db);
  await syscalls["index.set"](fakeContext, "page1", "key1", "value1");
  assertEquals(
    "value1",
    await syscalls["index.get"](fakeContext, "page1", "key1"),
  );
  await syscalls["index.set"](fakeContext, "page1", "key1", "value2");
  assertEquals(
    "value2",
    await syscalls["index.get"](fakeContext, "page1", "key1"),
  );
  await syscalls["index.set"](fakeContext, "page1", "key2", "value1");
  assertEquals(
    [
      { key: "key1", page: "page1", value: "value2" },
      { key: "key2", page: "page1", value: "value1" },
    ],
    await syscalls["index.queryPrefix"](fakeContext, ""),
  );
  await syscalls["index.delete"](fakeContext, "page1", "key1");
  assertEquals(
    [
      { key: "key2", page: "page1", value: "value1" },
    ],
    await syscalls["index.queryPrefix"](fakeContext, ""),
  );
  await syscalls["index.batchSet"](fakeContext, "page1", [
    { key: "key1", value: "value1" },
    { key: "key2", value: "value2" },
    { key: "key3", value: "value3" },
  ]);
  assertEquals(
    [
      { key: "key1", page: "page1", value: "value1" },
      { key: "key2", page: "page1", value: "value2" },
      { key: "key3", page: "page1", value: "value3" },
    ],
    await syscalls["index.queryPrefix"](fakeContext, ""),
  );
  db.stop();
});
