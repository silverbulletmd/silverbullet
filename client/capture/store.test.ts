import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import {
  captureDatabaseName,
  openCaptureStore,
  pendingCaptureCount,
} from "./store.ts";

function scope(): string {
  return `https://example.test/${crypto.randomUUID()}/service_worker.js`;
}

test("pending captures survive reopening and preserve file bytes", async () => {
  const scriptUrl = scope();
  const store = await openCaptureStore(scriptUrl);
  await store.configure("owner-a", true);
  const first = await store.stage(
    { title: "Example", text: "shared text", url: "https://example.test" },
    [
      new File([Uint8Array.from([0, 255])], "same.bin", {
        type: "application/octet-stream",
      }),
      new File([Uint8Array.from([1, 2, 3])], "same.bin", {
        type: "application/octet-stream",
      }),
    ],
  );
  const second = await store.stage({ title: "Second", text: "", url: "" }, []);
  const reopened = await openCaptureStore(scriptUrl);
  const queue = await reopened.list("owner-a");
  expect(queue.map((capture) => capture.id)).toEqual([first, second]);
  expect(queue[0].files.map((file) => file.name)).toEqual([
    "same.bin",
    "same.bin",
  ]);
  expect(queue[0].files[0].handle).not.toBe(queue[0].files[1].handle);
  const bytes = await reopened.readFile(
    first,
    queue[0].files[0].handle,
    "owner-a",
  );
  expect([...new Uint8Array(await bytes.arrayBuffer())]).toEqual([0, 255]);
});

test("a different owner cannot read or remove staged captures", async () => {
  const store = await openCaptureStore(scope());
  await store.configure("owner-a", true);
  const id = await store.stage({ title: "Private", text: "", url: "" }, []);
  await store.configure("owner-b", true);
  expect(await store.get(id, "owner-b")).toBeUndefined();
  expect(await store.list("owner-b")).toEqual([]);
  await expect(store.remove(id, "owner-b")).rejects.toThrow();
  expect((await store.get(id, "owner-a"))?.title).toBe("Private");
});

test("removing a capture deletes its files and clearing removes intake config", async () => {
  const store = await openCaptureStore(scope());
  await store.configure("owner-a", true);
  const id = await store.stage({ title: "", text: "", url: "" }, [
    new File(["data"], "note.txt"),
  ]);
  const handle = (await store.get(id, "owner-a"))!.files[0].handle;
  await store.remove(id, "owner-a");
  expect(await store.get(id, "owner-a")).toBeUndefined();
  await expect(store.readFile(id, handle, "owner-a")).rejects.toThrow();
  await store.clear();
  await expect(
    store.stage({ title: "", text: "", url: "" }, []),
  ).rejects.toThrow();
});

test("pending count spans installed space scopes", async () => {
  const firstUrl = scope();
  const secondUrl = scope();
  const first = await openCaptureStore(firstUrl);
  const second = await openCaptureStore(secondUrl);
  await first.configure("owner-a", true);
  await second.configure("owner-b", true);
  await first.stage({ title: "One", text: "", url: "" }, []);
  await first.stage({ title: "Two", text: "", url: "" }, []);
  await second.stage({ title: "Three", text: "", url: "" }, []);
  expect(await pendingCaptureCount([firstUrl, secondUrl])).toBe(3);
});

test("pending count includes captures quarantined for another owner", async () => {
  const scriptUrl = scope();
  const store = await openCaptureStore(scriptUrl);
  await store.configure("owner-a", true);
  await store.stage({ title: "Earlier share", text: "", url: "" }, []);
  await store.configure("owner-b", true);
  expect(await store.list("owner-b")).toEqual([]);
  expect(await pendingCaptureCount([scriptUrl])).toBe(1);
});

test("destroy removes the capture database after sign-out", async () => {
  const scriptUrl = scope();
  const store = await openCaptureStore(scriptUrl);
  await store.configure("owner-a", true);
  await store.stage({ title: "Private", text: "", url: "" }, []);
  const anotherTab = await openCaptureStore(scriptUrl);
  await store.destroy();
  expect(
    (await indexedDB.databases()).some(
      (db) => db.name === captureDatabaseName(scriptUrl),
    ),
  ).toBe(false);
  await anotherTab.destroy();
});
