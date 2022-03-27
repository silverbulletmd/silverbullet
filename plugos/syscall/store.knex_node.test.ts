import { createSandbox } from "../environment/node_sandbox";
import { expect, test } from "@jest/globals";
import { System } from "../system";
import {
  ensureTable,
  storeReadSyscalls,
  storeWriteSyscalls,
} from "./store.knex_node";
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
  system.registerSyscalls(
    "store",
    [],
    storeWriteSyscalls(db, "test_table"),
    storeReadSyscalls(db, "test_table")
  );
  let plug = await system.load(
    "test",
    {
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
  await fs.unlink("test.db");
});
