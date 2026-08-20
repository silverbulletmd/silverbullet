import { hashSHA256 } from "@silverbulletmd/silverbullet/lib/crypto";
import { describe, expect, test, vi } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "../spaces/datastore_space_primitives.ts";
import type { HttpSpacePrimitives } from "../spaces/http_space_primitives.ts";
import { SyncEngine } from "./sync_engine.ts";

const encode = (s: string) => new TextEncoder().encode(s);

function setup() {
  const kv = new MemoryKvPrimitives();
  const local = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const remote = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  // The engine only uses the SpacePrimitives surface of its remote
  const engine = new SyncEngine(
    kv,
    local,
    remote as unknown as HttpSpacePrimitives,
  );
  return { engine, local, remote };
}

function waitForEvent(
  engine: SyncEngine,
  pred: (path: string, ops: number) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for fileSyncComplete")),
      timeoutMs,
    );
    engine.on({
      fileSyncComplete: (path, ops) => {
        if (pred(path, ops)) {
          clearTimeout(timer);
          resolve();
        }
      },
    });
  });
}

describe("SyncEngine dirty queue", () => {
  test("requestFileSync syncs a locally written file", async () => {
    const { engine, local, remote } = setup();
    await local.writeFile("note.md", encode("hello"));
    await engine.start();
    const done = waitForEvent(engine, (p, ops) => p === "note.md" && ops >= 0);
    engine.requestFileSync("note.md", { type: "local" });
    await done;
    const { data } = await remote.readFile("note.md");
    expect(new TextDecoder().decode(data)).toBe("hello");
    engine.stop();
  });

  test("local echo is suppressed but still resolves waiters", async () => {
    const { engine, local } = setup();
    await engine.start();
    const meta = await local.writeFile("note.md", encode("hello"));
    // Fake a snapshot that already recorded this exact local write
    engine.snapshot.files.set("note.md", [meta.lastModified, 12345]);
    engine.snapshot.remoteHashes.set(
      "note.md",
      await hashSHA256(encode("hello")),
    );
    const done = waitForEvent(engine, (p, ops) => p === "note.md" && ops === 0);
    engine.requestFileSync("note.md", { type: "local" });
    await done; // suppressed -> fileSyncComplete(path, 0)
    engine.stop();
  });

  // The same setup with different bytes behind the same timestamp: an echo is
  // decided by content, so this one is real work (finding #4).
  test("a same-millisecond local write is not mistaken for an echo", async () => {
    const { engine, local, remote } = setup();
    await engine.start();
    const meta = await local.writeFile("note.md", encode("edited"));
    engine.snapshot.files.set("note.md", [meta.lastModified, 12345]);
    engine.snapshot.remoteHashes.set(
      "note.md",
      await hashSHA256(encode("synced")),
    );
    await remote.writeFile("note.md", encode("synced"), {
      ...meta,
      name: "note.md",
      lastModified: 12345,
    });

    const done = waitForEvent(engine, (p, ops) => p === "note.md" && ops > 0);
    engine.requestFileSync("note.md", { type: "local" });
    await done;
    expect(
      new TextDecoder().decode((await remote.readFile("note.md")).data),
    ).toBe("edited");
    engine.stop();
  });

  test("remote echo is suppressed without any remote access", async () => {
    const { engine } = setup();
    await engine.start();
    engine.snapshot.files.set("note.md", [100, 200]);
    const done = waitForEvent(engine, (p, ops) => p === "note.md" && ops === 0);
    engine.requestFileSync("note.md", { type: "remote", lastModified: 200 });
    await done;
    engine.stop();
  });

  test("realtime health TTL", () => {
    const { engine } = setup();
    expect(engine.isRealtimeHealthy()).toBe(false);
    engine.notifyRealtimeStatus(true);
    expect(engine.isRealtimeHealthy()).toBe(true);
    engine.notifyRealtimeStatus(false);
    expect(engine.isRealtimeHealthy()).toBe(false);
  });

  test("realtime health decays when the heartbeat stops", () => {
    vi.useFakeTimers();
    try {
      const { engine } = setup();
      engine.notifyRealtimeStatus(true);

      // Refreshed well inside the TTL: a live stream keeps reporting.
      vi.advanceTimersByTime(30_000);
      expect(engine.isRealtimeHealthy()).toBe(true);
      engine.notifyRealtimeStatus(true);

      // Then the reports stop -- a half-open connection delivers nothing, so
      // nothing refreshes this and it must expire on its own.
      vi.advanceTimersByTime(44_000);
      expect(engine.isRealtimeHealthy()).toBe(true);
      vi.advanceTimersByTime(2_000);
      expect(engine.isRealtimeHealthy()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("requestSpaceSync triggers a full cycle", async () => {
    const { engine, local, remote } = setup();
    await engine.start();
    await local.writeFile("a.md", encode("a"));
    const done = new Promise<void>((resolve) => {
      engine.on({
        spaceSyncComplete: (ops) => {
          if (ops > 0) resolve();
        },
      });
    });
    engine.requestSpaceSync();
    await done;
    const { data } = await remote.readFile("a.md");
    expect(new TextDecoder().decode(data)).toBe("a");
    engine.stop();
  });
});
