import { describe, expect, test } from "vitest";
import { DirtyQueue, type SyncOrigin, shouldSkip } from "./dirty_queue.ts";

describe("DirtyQueue", () => {
  test("take times out when empty", async () => {
    const q = new DirtyQueue();
    expect(await q.take(10)).toEqual({ kind: "timeout" });
  });

  test("mark then take returns paths FIFO", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "local" });
    q.mark("b.md", { type: "probe" });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "a.md",
      origin: { type: "local" },
    });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "b.md",
      origin: { type: "probe" },
    });
    expect(await q.take(0)).toEqual({ kind: "timeout" });
  });

  test("duplicate same-origin mark dedupes keeping newest", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "remote", lastModified: 1 });
    q.mark("a.md", { type: "remote", lastModified: 2 });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "a.md",
      origin: { type: "remote", lastModified: 2 },
    });
    expect(await q.take(0)).toEqual({ kind: "timeout" });
  });

  test("differing origins widen to any", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "local" });
    q.mark("a.md", { type: "remote", lastModified: 5 });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "a.md",
      origin: { type: "any", remoteHash: undefined },
    });
  });

  // A later hashless event must not erase the revision an earlier one
  // reported — that would silently disarm same-millisecond detection.
  test("merging keeps a revision the newer entry lacks", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "remote", lastModified: 5, hash: "abc123" });
    q.mark("a.md", { type: "remote", lastModified: 9 });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "a.md",
      origin: { type: "remote", lastModified: 9, hash: "abc123" },
    });

    // Same for two merged entries: a resync racing an SSE-derived merge.
    q.mark("b.md", { type: "any", remoteHash: "def456" });
    q.mark("b.md", { type: "any" });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "b.md",
      origin: { type: "any", remoteHash: "def456" },
    });
  });

  // Widening must not throw the revision away: it is the only thing that can
  // catch a remote change made in the same millisecond as the last one this
  // replica recorded.
  test("widening to any keeps the reported revision", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "local" });
    q.mark("a.md", { type: "remote", lastModified: 5, hash: "abc123" });
    expect(await q.take(0)).toEqual({
      kind: "path",
      path: "a.md",
      origin: { type: "any", remoteHash: "abc123" },
    });
  });

  test("full scan takes priority and clears, pending preserved", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "local" });
    q.markFullScan();
    expect(await q.take(0)).toEqual({ kind: "fullScan" });
    expect(await q.take(0)).toMatchObject({ kind: "path", path: "a.md" });
  });

  test("mark wakes a blocked take", async () => {
    const q = new DirtyQueue();
    const pending = q.take(5000);
    q.mark("a.md", { type: "local" });
    expect(await pending).toMatchObject({ kind: "path", path: "a.md" });
  });

  test("re-mark during in-flight requeues", async () => {
    const q = new DirtyQueue();
    q.mark("a.md", { type: "local" });
    await q.take(0);
    q.mark("a.md", { type: "local" });
    expect(await q.take(0)).toMatchObject({ kind: "path", path: "a.md" });
  });

  test("timeout then mark then take returns the path", async () => {
    const q = new DirtyQueue();
    expect(await q.take(10)).toEqual({ kind: "timeout" });
    q.mark("a.md", { type: "local" });
    expect(await q.take(0)).toMatchObject({ kind: "path", path: "a.md" });
  });
});

describe("shouldSkip", () => {
  // A local write is never dropped on timestamp evidence alone: a
  // same-millisecond save is indistinguishable from the engine's own recorded
  // revision by it, so content decides (see localWriteIsEcho).
  test("a local write is never skipped on timestamp evidence", () => {
    expect(shouldSkip({ type: "local" }, [100, 200], "hash", false)).toBe(
      false,
    );
    expect(shouldSkip({ type: "local" }, undefined, undefined, false)).toBe(
      false,
    );
  });

  test("remote echo", () => {
    const remote = (lastModified: number): SyncOrigin => ({
      type: "remote",
      lastModified,
    });
    // Same mtime, and nothing to contradict it with.
    expect(shouldSkip(remote(200), [100, 200], undefined, false)).toBe(true);
    expect(shouldSkip(remote(250), [100, 200], undefined, false)).toBe(false);
    expect(shouldSkip(remote(200), undefined, undefined, false)).toBe(false);
  });

  // The revision the event reports is what tells a same-millisecond remote
  // change apart from an echo of our own push.
  test("a remote event reporting another revision is not skipped", () => {
    const remote = (lastModified: number, hash: string): SyncOrigin => ({
      type: "remote",
      lastModified,
      hash,
    });
    expect(shouldSkip(remote(200, "aaa"), [100, 200], "aaa", false)).toBe(true);
    expect(shouldSkip(remote(200, "bbb"), [100, 200], "aaa", false)).toBe(
      false,
    );
    // Nothing recorded to compare against: the timestamp stands.
    expect(shouldSkip(remote(200, "bbb"), [100, 200], undefined, false)).toBe(
      true,
    );
  });

  test("probe skipped only while realtime healthy", () => {
    expect(shouldSkip({ type: "probe" }, [1, 1], undefined, true)).toBe(true);
    expect(shouldSkip({ type: "probe" }, [1, 1], undefined, false)).toBe(false);
  });

  test("any never skipped", () => {
    expect(shouldSkip({ type: "any" }, [100, 100], undefined, true)).toBe(
      false,
    );
  });
});
