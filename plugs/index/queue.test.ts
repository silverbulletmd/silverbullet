import { expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { MQMessage } from "@silverbulletmd/silverbullet/type/datastore";
import { processIndexQueue } from "./queue.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function msg(path: string): MQMessage {
  return { id: path, queue: "indexQueue", body: path };
}

test("a batch dispatches page:index for every queued page", async () => {
  const { spacePrimitives, eventHook } = createMockSystem();
  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));
  await spacePrimitives.writeFile("B.md", enc.encode("# B"));

  const indexed: string[] = [];
  eventHook.addLocalListener("page:index", (event: { name: string }) => {
    indexed.push(event.name);
  });

  await processIndexQueue([msg("A.md"), msg("B.md")]);

  expect(indexed.sort()).toEqual(["A", "B"]);
});

test("a failing file doesn't fail the batch and is re-queued with an attempt count", async () => {
  const { spacePrimitives, eventHook, mq } = createMockSystem();
  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));
  await spacePrimitives.writeFile("B.md", enc.encode("# B"));

  const origReadFile = spacePrimitives.readFile.bind(spacePrimitives);
  spacePrimitives.readFile = async (name: string) => {
    if (name === "A.md") {
      throw new Error("Request timed out after 30000ms");
    }
    return origReadFile(name);
  };

  const indexed: string[] = [];
  eventHook.addLocalListener("page:index", (event: { name: string }) => {
    indexed.push(event.name);
  });

  // Must resolve (a rejection would leave the whole batch un-acked).
  await processIndexQueue([msg("A.md"), msg("B.md")]);

  expect(indexed).toEqual(["B"]);
  const requeued = await mq.poll("indexQueue", 10);
  expect(requeued.map((m) => m.body)).toEqual([{ path: "A.md", attempts: 1 }]);
});

test("a file that keeps failing is dropped after three attempts", async () => {
  const { spacePrimitives, mq } = createMockSystem();
  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));
  spacePrimitives.readFile = async () => {
    throw new Error("Request timed out after 30000ms");
  };

  await processIndexQueue([
    { id: "A.md", queue: "indexQueue", body: { path: "A.md", attempts: 2 } },
  ]);

  const requeued = await mq.poll("indexQueue", 10);
  expect(requeued).toEqual([]);
});

test("files within a batch are indexed concurrently, not serially", async () => {
  const { spacePrimitives, eventHook } = createMockSystem();
  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));
  await spacePrimitives.writeFile("B.md", enc.encode("# B"));

  // A's read blocks until B's read has started. A serial implementation
  // never starts B while A is in flight, so A's read times out and throws.
  let bStarted: () => void;
  const bStartedPromise = new Promise<void>((r) => {
    bStarted = r;
  });
  const origReadFile = spacePrimitives.readFile.bind(spacePrimitives);
  spacePrimitives.readFile = async (name: string) => {
    if (name === "B.md") {
      bStarted();
    }
    if (name === "A.md") {
      const winner = await Promise.race([
        bStartedPromise.then(() => "concurrent"),
        sleep(200).then(() => "serial"),
      ]);
      if (winner === "serial") {
        throw new Error("A completed before B started: batch ran serially");
      }
    }
    return origReadFile(name);
  };

  const indexed: string[] = [];
  eventHook.addLocalListener("page:index", (event: { name: string }) => {
    indexed.push(event.name);
  });

  await processIndexQueue([msg("A.md"), msg("B.md")]);

  expect(indexed.sort()).toEqual(["A", "B"]);
});

test("files the initial sync hasn't delivered are deferred, not indexed", async () => {
  const { spacePrimitives, eventHook, mq, clientMock } = createMockSystem();
  clientMock.fullIndexCompleted = false;
  clientMock.fullSyncCompleted = false;
  clientMock.syncedPaths = new Set(["A.md"]);

  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));
  await spacePrimitives.writeFile("B.md", enc.encode("# B"));

  const indexed: string[] = [];
  eventHook.addLocalListener("page:index", (event: { name: string }) => {
    indexed.push(event.name);
  });

  await processIndexQueue([msg("A.md"), msg("B.md")]);

  expect(indexed).toEqual(["A"]);
  const requeued = await mq.poll("indexQueue", 10);
  expect(requeued.map((m) => m.body)).toEqual(["B.md"]);
});

test("nothing is deferred once the initial sync has completed", async () => {
  const { spacePrimitives, eventHook, mq, clientMock } = createMockSystem();
  clientMock.fullIndexCompleted = false;
  clientMock.fullSyncCompleted = true;
  clientMock.syncedPaths = new Set();

  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));

  const indexed: string[] = [];
  eventHook.addLocalListener("page:index", (event: { name: string }) => {
    indexed.push(event.name);
  });

  await processIndexQueue([msg("A.md")]);

  expect(indexed).toEqual(["A"]);
  expect(await mq.poll("indexQueue", 10)).toEqual([]);
});

test("nothing is deferred when the server is close enough that re-fetching is cheap", async () => {
  const { spacePrimitives, eventHook, mq, clientMock } = createMockSystem();
  clientMock.fullIndexCompleted = false;
  clientMock.fullSyncCompleted = false;
  clientMock.syncedPaths = new Set();
  clientMock.serverPingMs = 3;

  const enc = new TextEncoder();
  await spacePrimitives.writeFile("A.md", enc.encode("# A"));

  const indexed: string[] = [];
  eventHook.addLocalListener("page:index", (event: { name: string }) => {
    indexed.push(event.name);
  });

  await processIndexQueue([msg("A.md")]);

  expect(indexed).toEqual(["A"]);
  expect(await mq.poll("indexQueue", 10)).toEqual([]);
});
