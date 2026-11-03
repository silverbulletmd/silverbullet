import { expect, test, vi } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { LuaEnv } from "../../client/space_lua/runtime.ts";
import { processIndexQueue } from "./queue.ts";

test.each(["idle timer", "queue drain"])(
  "a slow page reindex does not announce partial results on %s",
  async (trigger) => {
    vi.useFakeTimers();
    let releaseRead = () => {};
    let indexing: Promise<void> | undefined;
    try {
      const { spacePrimitives, objectIndex, eventHook, mq } =
        createMockSystem();
      await spacePrimitives.writeFile(
        "Trail.md",
        new TextEncoder().encode("Updated plan."),
      );
      const page = { ref: "Trail", tag: "page", name: "Trail" };
      await objectIndex.indexObjects("Trail", [page as any]);
      await eventHook.dispatchEvent("mq:emptyQueue:indexQueue");

      const snapshots: string[][] = [];
      eventHook.addLocalListener("index:tag:page", async () => {
        const pages = await objectIndex.queryLuaObjects(
          new LuaEnv(),
          "page",
          {},
        );
        snapshots.push(pages.map((p: any) => p.name));
      });
      eventHook.addLocalListener("page:index", () =>
        objectIndex.indexObjects("Trail", [page as any]),
      );

      let readStarted = () => {};
      const started = new Promise<void>((resolve) => {
        readStarted = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const readFile = spacePrimitives.readFile.bind(spacePrimitives);
      spacePrimitives.readFile = async (name: string) => {
        if (name === "Trail.md") {
          readStarted();
          await blocked;
        }
        return readFile(name);
      };
      await mq.batchSend("indexQueue", ["Trail.md"]);
      indexing = processIndexQueue(await mq.poll("indexQueue", 1));
      await started;
      if (trigger === "idle timer") {
        await vi.advanceTimersByTimeAsync(1000);
      } else {
        await eventHook.dispatchEvent("mq:emptyQueue:indexQueue");
      }
      expect(snapshots).toEqual([]);

      releaseRead();
      await indexing;
      await eventHook.dispatchEvent("mq:emptyQueue:indexQueue");
      expect(snapshots).toEqual([["Trail"]]);
    } finally {
      releaseRead();
      await indexing;
      vi.useRealTimers();
    }
  },
);

test("pending tag notifications resume if processing is flushed without a drain event", async () => {
  vi.useFakeTimers();
  try {
    const { objectIndex, eventHook, mq } = createMockSystem();
    await objectIndex.indexObjects("Trail", [
      { ref: "Trail", tag: "page", name: "Trail" } as any,
    ]);
    await eventHook.dispatchEvent("mq:emptyQueue:indexQueue");
    const fired: string[] = [];
    eventHook.addLocalListener("index:tag:page", () => fired.push("page"));

    await mq.batchSend("indexQueue", ["Trail.md"]);
    await mq.poll("indexQueue", 1);
    await objectIndex.clearFileIndex("Trail.md");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired).toEqual([]);

    await mq.flushQueue("indexQueue");
    await vi.advanceTimersByTimeAsync(500);
    expect(fired).toEqual(["page"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired).toEqual(["page"]);
  } finally {
    vi.useRealTimers();
  }
});
