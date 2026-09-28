import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { CaptureInvocationContext } from "./invocation.ts";
import { openCaptureStore } from "./store.ts";

test("only the running capture can read its file handles", async () => {
  const store = await openCaptureStore(
    `https://example.test/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", true);
  const first = await store.stage({ title: "First", text: "", url: "" }, [
    new File([Uint8Array.from([0, 255])], "first.bin"),
  ]);
  const second = await store.stage({ title: "Second", text: "", url: "" }, [
    new File([Uint8Array.from([1, 2])], "second.bin"),
  ]);
  const firstDraft = (await store.get(first, "owner-a"))!;
  const secondDraft = (await store.get(second, "owner-a"))!;
  const context = new CaptureInvocationContext(store, "owner-a");
  await expect(context.readFile(firstDraft.files[0].handle)).rejects.toThrow();
  await context.run(firstDraft, async () => {
    const blob = await context.readFile(firstDraft.files[0].handle);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 255]);
    await expect(
      context.readFile(secondDraft.files[0].handle),
    ).rejects.toThrow();
  });
  await expect(context.readFile(firstDraft.files[0].handle)).rejects.toThrow();
});

test("a failed action revokes handles and leaves the pending capture", async () => {
  const store = await openCaptureStore(
    `https://example.test/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", true);
  const id = await store.stage({ title: "", text: "", url: "" }, [
    new File(["x"], "x.txt"),
  ]);
  const capture = (await store.get(id, "owner-a"))!;
  const context = new CaptureInvocationContext(store, "owner-a");
  await expect(
    context.run(capture, async () => {
      throw new Error("action failed");
    }),
  ).rejects.toThrow("action failed");
  await expect(context.readFile(capture.files[0].handle)).rejects.toThrow();
  expect(await store.get(id, "owner-a")).toBeDefined();
});
