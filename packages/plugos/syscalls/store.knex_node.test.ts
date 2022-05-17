import { createSandbox } from "../environments/node_sandbox";
import { expect, test } from "@jest/globals";
import { System } from "../system";
import { ensureTable, storeSyscalls } from "./store.knex_node";
import knex from "knex";
import fs from "fs/promises";

test("Test store", async () => {
  const db = knex({
    client: "better-sqlite3",
    connection: {
      filename: "test.db",
    },
    useNullAsDefault: true,
  });
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
    createSandbox
  );
  expect(await plug.invoke("test1", [])).toBe("Pete");
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

  expect(allRoberts.length).toBe(3);
  expect(allRoberts[0].key).toBe("petesr");

  allRoberts = await syscalls["store.query"](dummyCtx, {
    filter: [{ op: "=", prop: "lastName", value: "Roberts" }],
    orderBy: "age",
    limit: 1,
  });

  expect(allRoberts.length).toBe(1);
  expect(allRoberts[0].key).toBe("petejr");

  allRoberts = await syscalls["store.query"](dummyCtx, {
    filter: [
      { op: ">", prop: "age", value: 10 },
      { op: "<", prop: "age", value: 30 },
    ],
    orderBy: "age",
  });

  expect(allRoberts.length).toBe(1);
  expect(allRoberts[0].key).toBe("pete");

  // Delete the middle one

  await syscalls["store.deleteQuery"](dummyCtx, {
    filter: [
      { op: ">", prop: "age", value: 10 },
      { op: "<", prop: "age", value: 30 },
    ],
  });

  allRoberts = await syscalls["store.query"](dummyCtx, {});
  expect(allRoberts.length).toBe(2);

  await db.destroy();

  await fs.unlink("test.db");
});
