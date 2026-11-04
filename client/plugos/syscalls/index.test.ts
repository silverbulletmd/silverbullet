import { expect, test } from "vitest";
import { indexSyscalls } from "./index.ts";

test("awaitPendingChanges syncs, lists files when idle, drains the index queue, then drops memoized scans", async () => {
  const calls: string[] = [];
  const client = {
    clientSystem: {
      localSyscall: (name: string) => {
        calls.push(name);
        return Promise.resolve(0);
      },
    },
    eventedSpacePrimitives: {
      fetchFileListWhenIdle: () => {
        calls.push("fetchFileListWhenIdle");
        return Promise.resolve([]);
      },
    },
    mq: {
      awaitEmptyQueue: (queue: string) => {
        calls.push(`awaitEmptyQueue:${queue}`);
        return Promise.resolve();
      },
    },
  } as any;
  const objectIndex = {
    forgetScans: () => calls.push("forgetScans"),
  } as any;
  await (indexSyscalls(objectIndex, client) as any)[
    "index.awaitPendingChanges"
  ].callback({});
  expect(calls).toEqual([
    "sync.performSpaceSync",
    "fetchFileListWhenIdle",
    "awaitEmptyQueue:indexQueue",
    "forgetScans",
  ]);
});
