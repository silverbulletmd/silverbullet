import { createSandbox } from "../environments/node_sandbox";
import { expect, test } from "@jest/globals";
import { System } from "../system";
import { storeSyscalls } from "./store.dexie_browser";

// For testing in node.js
require("fake-indexeddb/auto");

test("Test store", async () => {
  let system = new System("server");
  system.registerSyscalls("store", [], storeSyscalls("test", "test"));
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
        test2: {
          code: `(() => {
          return {
            default: async () => {
              await self.syscall("store.set", "page1:bl:page2:10", {title: "Something", meta: 20});
              await self.syscall("store.batchSet", [
                 {key: "page2:bl:page3", value: {title: "Something2", meta: 10}},
                 {key: "page2:bl:page4", value: {title: "Something3", meta: 10}},
              ]);
              return await self.syscall("store.queryPrefix", "page2:");
            }
          };
        })()`,
        },
      },
    },
    createSandbox
  );
  expect(await plug.invoke("test1", [])).toBe("Pete");
  let queryResults = await plug.invoke("test2", []);
  expect(queryResults.length).toBe(2);
  expect(queryResults[0].value.meta).toBe(10);
  await system.unloadAll();
});
