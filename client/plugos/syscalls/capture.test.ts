import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import type { Client } from "../../client.ts";
import { CaptureInvocationContext } from "../../capture/invocation.ts";
import { openCaptureStore } from "../../capture/store.ts";
import { captureSyscalls } from "./capture.ts";

test("capture syscalls read exact bytes and save only the active file", async () => {
  const store = await openCaptureStore(
    `https://example.test/${crypto.randomUUID()}/service_worker.js`,
  );
  await store.configure("owner-a", true);
  const id = await store.stage({ title: "", text: "", url: "" }, [
    new File([Uint8Array.from([0, 255])], "bytes.bin"),
  ]);
  const capture = (await store.get(id, "owner-a"))!;
  const context = new CaptureInvocationContext(store, "owner-a");
  const files = new Map<string, Uint8Array>();
  const client = {
    config: { get: () => 10 },
    space: {
      async getDocumentMeta(path: string) {
        if (!files.has(path)) throw notFoundError;
        return {};
      },
      async readDocument(path: string) {
        const data = files.get(path);
        if (!data) throw notFoundError;
        return { data };
      },
      async writeDocument(path: string, bytes: Uint8Array) {
        files.set(path, bytes);
        return {};
      },
    },
  } as unknown as Client;
  const calls = captureSyscalls(() => context, client);
  const read = calls["capture.readFile"] as any;
  const save = calls["capture.saveFile"] as any;
  await context.run(capture, async () => {
    expect([...(await read.callback({}, capture.files[0].handle))]).toEqual([
      0, 255,
    ]);
    await save.callback({}, capture.files[0].handle, "Inbox/files/bytes.bin");
    await expect(
      save.callback({}, capture.files[0].handle, "Inbox/files/bytes.bin"),
    ).resolves.toBe(false);
    files.set("Inbox/files/bytes.bin", Uint8Array.from([9, 9]));
    await expect(
      save.callback({}, capture.files[0].handle, "Inbox/files/bytes.bin"),
    ).rejects.toThrow("conflict");
  });
  expect([...files.get("Inbox/files/bytes.bin")!]).toEqual([9, 9]);
  await expect(read.callback({}, capture.files[0].handle)).rejects.toThrow();
});
