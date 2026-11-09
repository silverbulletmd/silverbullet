import { deleteDB, type IDBPDatabase, openDB } from "idb";
import type { CaptureDraft, CaptureRecord } from "./types.ts";

export type CaptureConfiguration = { ownerId: string; eligible: boolean };

type StoredCapture = CaptureRecord & { order: number };
type StoredConfiguration = CaptureConfiguration & { nextOrder: number };

export type CaptureStore = {
  configure(ownerId: string, eligible: boolean): Promise<void>;
  getConfiguration(): Promise<CaptureConfiguration | undefined>;
  countAll(): Promise<number>;
  stage(
    fields: { title: string; text: string; url: string },
    files: File[],
  ): Promise<string>;
  get(id: string, ownerId: string): Promise<CaptureRecord | undefined>;
  list(ownerId: string): Promise<CaptureDraft[]>;
  readFile(id: string, handle: string, ownerId: string): Promise<Blob>;
  remove(id: string, ownerId: string): Promise<void>;
  clear(): Promise<void>;
  destroy(): Promise<void>;
};

export function captureDatabaseName(scriptUrl: string): string {
  return `sb_capture_${encodeURIComponent(scriptUrl)}`;
}

export async function pendingCaptureCount(
  scriptUrls: string[],
): Promise<number> {
  let count = 0;
  for (const url of scriptUrls) {
    const store = await openCaptureStore(url);
    count += await store.countAll();
  }
  return count;
}

export async function openCaptureStore(
  scriptUrl: string,
): Promise<CaptureStore> {
  // Another context (a client wipe, a logout) may delete this database while
  // the service worker holds it open. Release the connection so the delete can
  // proceed, and open a fresh one on next use.
  let connection: Promise<IDBPDatabase> | undefined;
  const database = (): Promise<IDBPDatabase> => {
    if (connection) return connection;
    const opened = openDB(captureDatabaseName(scriptUrl), 1, {
      upgrade(db) {
        db.createObjectStore("captures", { keyPath: "id" });
        db.createObjectStore("config");
      },
    }).then((db) => {
      const release = () => {
        db.close();
        if (connection === opened) connection = undefined;
      };
      db.addEventListener("versionchange", release);
      db.addEventListener("close", release);
      return db;
    });
    connection = opened;
    return opened;
  };
  await database();

  const configuration = async (): Promise<StoredConfiguration | undefined> =>
    (await database()).get("config", "current");

  const owned = async (
    id: string,
    ownerId: string,
  ): Promise<StoredCapture | undefined> => {
    const record = (await (await database()).get("captures", id)) as
      | StoredCapture
      | undefined;
    return record?.ownerId === ownerId ? record : undefined;
  };

  return {
    async configure(ownerId, eligible) {
      const previous = await configuration();
      await (await database()).put(
        "config",
        {
          ownerId,
          eligible,
          nextOrder: previous?.nextOrder ?? 0,
        } satisfies StoredConfiguration,
        "current",
      );
    },
    async getConfiguration() {
      const current = await configuration();
      return (
        current && { ownerId: current.ownerId, eligible: current.eligible }
      );
    },
    async countAll() {
      return (await database()).count("captures");
    },
    async stage(fields, files) {
      const blobs: Record<string, ArrayBuffer> = {};
      const metadata = await Promise.all(
        files.map(async (file) => {
          const handle = crypto.randomUUID();
          blobs[handle] = await file.arrayBuffer();
          return { handle, name: file.name, type: file.type, size: file.size };
        }),
      );
      const transaction = (await database()).transaction(
        ["captures", "config"],
        "readwrite",
      );
      const config = (await transaction.objectStore("config").get("current")) as
        | StoredConfiguration
        | undefined;
      if (!config?.eligible) {
        throw new Error("This space cannot receive shares");
      }
      const id = crypto.randomUUID();
      const record: StoredCapture = {
        id,
        ownerId: config.ownerId,
        receivedAt: Date.now(),
        ...fields,
        files: metadata,
        blobs,
        order: config.nextOrder,
      };
      await transaction.objectStore("captures").put(record);
      await transaction
        .objectStore("config")
        .put({ ...config, nextOrder: config.nextOrder + 1 }, "current");
      await transaction.done;
      return id;
    },
    async get(id, ownerId) {
      return owned(id, ownerId);
    },
    async list(ownerId) {
      const records = (await (
        await database()
      ).getAll("captures")) as StoredCapture[];
      return records
        .filter((record) => record.ownerId === ownerId)
        .sort((a, b) => a.order - b.order)
        .map(({ blobs: _blobs, order: _order, ...draft }) => draft);
    },
    async readFile(id, handle, ownerId) {
      const record = await owned(id, ownerId);
      const blob = record?.blobs[handle];
      if (!blob) throw new Error("Capture file is unavailable");
      if (blob instanceof Blob) return blob;
      const type = record.files.find((file) => file.handle === handle)?.type;
      return new Blob([blob], { type });
    },
    async remove(id, ownerId) {
      if (!(await owned(id, ownerId)))
        throw new Error("Capture is unavailable");
      await (await database()).delete("captures", id);
    },
    async clear() {
      const transaction = (await database()).transaction(
        ["captures", "config"],
        "readwrite",
      );
      await transaction.objectStore("captures").clear();
      await transaction.objectStore("config").clear();
      await transaction.done;
    },
    async destroy() {
      const open = connection;
      connection = undefined;
      (await open)?.close();
      await deleteDB(captureDatabaseName(scriptUrl));
    },
  };
}
