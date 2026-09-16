import { afterEach, expect, test, vi } from "vitest";
import {
  base64Encode,
  deriveEncryptionKey,
  encryptionKeyVerifier,
  publishEncryptionKey,
} from "./encryption.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a central unlock page publishes to its explicit destination registration without waiting for its own scope", async () => {
  const worker = {
    postMessage: vi.fn((_message, ports) =>
      ports[0].postMessage({ type: "encryption-key-set" }),
    ),
  };
  const registration = {
    active: worker,
  } as unknown as ServiceWorkerRegistration;
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: new Promise(() => {}),
      getRegistrations: async () => [],
    },
  });
  expect(
    await publishEncryptionKey("fixture-key", false, 50, registration),
  ).toBe(true);
  expect(worker.postMessage).toHaveBeenCalledOnce();
});

test("worker publication requires its explicit acknowledgement", async () => {
  const registration = {
    active: {
      postMessage: (_message: unknown, ports: MessagePort[]) =>
        ports[0].postMessage({ type: "unrelated" }),
    },
  } as unknown as ServiceWorkerRegistration;
  vi.stubGlobal("navigator", {
    serviceWorker: { ready: Promise.resolve(registration) },
  });
  expect(await publishEncryptionKey("fixture-key", false, 10)).toBe(false);
});

test("the persisted verifier binds the derived key to the account and never stores the key", async () => {
  const salt = new Uint8Array(16);
  const key = await deriveEncryptionKey("fixture-user:invented-password", salt);
  const verifier = await encryptionKeyVerifier(key, "fixture-user");
  expect(verifier).toMatch(/^[a-f0-9]{64}$/);
  expect(verifier).not.toContain(key);
  expect(await encryptionKeyVerifier(key, "another-user")).not.toBe(verifier);
  const differentKey = base64Encode(new Uint8Array(32));
  expect(await encryptionKeyVerifier(differentKey, "fixture-user")).not.toBe(
    verifier,
  );
});

test("cache inspection uses Core's trailing-slash-free database identity and leaves mismatched encrypted caches intact", async () => {
  const fake = await import("fake-indexeddb");
  for (const [name, value] of Object.entries(fake)) {
    if (name.startsWith("IDB")) vi.stubGlobal(name, value);
  }
  const { IDBFactory } = fake;
  const { openDB } = await import("idb");
  const { deriveDbName, importKey } = await import(
    "@silverbulletmd/silverbullet/lib/crypto"
  );
  const { inspectEncryptionCache } = await import("./encryption.ts");
  vi.stubGlobal("indexedDB", new IDBFactory());
  const key = base64Encode(new Uint8Array(32));
  const name = await deriveDbName(
    "files",
    "/fixture-space",
    "https://notes.test/space",
    await importKey(key),
  );
  const database = await openDB(name, 1, {
    upgrade: (database) => {
      database.createObjectStore("data");
    },
  });
  await database.put("data", "preserved encrypted content", "fixture");
  database.close();
  expect(
    await inspectEncryptionCache(
      "https://notes.test/space/",
      "/fixture-space",
      key,
    ),
  ).toMatchObject({ matching: true, plainHasData: false, otherFiles: false });
  expect(
    await inspectEncryptionCache(
      "https://notes.test/space/",
      "/fixture-space",
      base64Encode(new Uint8Array(32).fill(1)),
    ),
  ).toMatchObject({ matching: false, otherFiles: true });
  const reopened = await openDB(name);
  expect(await reopened.get("data", "fixture")).toBe(
    "preserved encrypted content",
  );
  reopened.close();
});
