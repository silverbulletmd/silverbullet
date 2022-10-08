import { assertEquals } from "../../test_dep.ts";
import { SQLite } from "../../dep_server.ts";
import { createSandbox } from "../environments/deno_sandbox.ts";
import { System } from "../system.ts";
import { ensureTable, storeSyscalls } from "./store.deno.ts";

Deno.test("Test store", async () => {
  const db = new SQLite(":memory:");
  await ensureTable(db, "test_table");
  let system = new System("server");
  let syscalls = storeSyscalls(db, "test_table");
  system.registerSyscalls([], syscalls);
  let plug = await system.load(
    {
      name: "test",
      functions: {
        test1: {
          code: `(() => {
          return {
            default: async () => {
              await self.syscall("store.set", "name", "Pete");
              return await self.syscall("store.get", "name");
            }
          };
        })()`,
        },
      },
    },
    createSandbox,
  );
  assertEquals(await plug.invoke("test1", []), "Pete");
  await system.unloadAll();

  let dummyCtx: any = {};

  await syscalls["store.deleteAll"](dummyCtx);
  await syscalls["store.batchSet"](dummyCtx, [
    {
      key: "pete",
      value: {
        age: 20,
        firstName: "Pete",
        lastName: "Roberts",
      },
    },
    {
      key: "petejr",
      value: {
        age: 8,
        firstName: "Pete Jr",
        lastName: "Roberts",
      },
    },
    {
      key: "petesr",
      value: {
        age: 78,
        firstName: "Pete Sr",
        lastName: "Roberts",
      },
    },
  ]);

  let allRoberts = await syscalls["store.query"](dummyCtx, {
    filter: [{ op: "=", prop: "lastName", value: "Roberts" }],
    orderBy: "age",
    orderDesc: true,
  });

  assertEquals(allRoberts.length, 3);
  assertEquals(allRoberts[0].key, "petesr");

  allRoberts = await syscalls["store.query"](dummyCtx, {
    filter: [{ op: "=", prop: "lastName", value: "Roberts" }],
    orderBy: "age",
    limit: 1,
  });

  assertEquals(allRoberts.length, 1);
  assertEquals(allRoberts[0].key, "petejr");

  allRoberts = await syscalls["store.query"](dummyCtx, {
    filter: [
      { op: ">", prop: "age", value: 10 },
      { op: "<", prop: "age", value: 30 },
    ],
    orderBy: "age",
  });

  assertEquals(allRoberts.length, 1);
  assertEquals(allRoberts[0].key, "pete");

  // Delete the middle one

  await syscalls["store.deleteQuery"](dummyCtx, {
    filter: [
      { op: ">", prop: "age", value: 10 },
      { op: "<", prop: "age", value: 30 },
    ],
  });

  allRoberts = await syscalls["store.query"](dummyCtx, {});
  assertEquals(allRoberts.length, 2);

  db.close();
});
