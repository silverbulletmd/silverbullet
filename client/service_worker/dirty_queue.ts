import { hashSHA256 } from "@silverbulletmd/silverbullet/lib/crypto";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import type { SpacePrimitives } from "../spaces/space_primitives.ts";
import type { SyncSignal } from "../spaces/sync.ts";

export type SyncOrigin =
  | { type: "local" }
  // A remote change event, carrying the revision it reports when the remote
  // sends one.
  | { type: "remote"; lastModified: number; hash?: string }
  | { type: "probe" }
  // Merged/unknown provenance: never skipped. Keeps the revision the newest
  // merged-in remote event reported, because it is the only thing that can
  // catch a same-millisecond remote change.
  | { type: "any"; remoteHash?: string };

export type Taken =
  | { kind: "path"; path: string; origin: SyncOrigin }
  | { kind: "fullScan" }
  | { kind: "timeout" };

function reportedRevision(origin: SyncOrigin): string | undefined {
  switch (origin.type) {
    case "remote":
      return origin.hash;
    case "any":
      return origin.remoteHash;
    default:
      return undefined;
  }
}

export function mergeOrigins(a: SyncOrigin, b: SyncOrigin): SyncOrigin {
  // The newer entry decides what the merged one is, but never drops a
  // revision it doesn't carry itself: that revision is the only thing that can
  // catch a remote change made in the same millisecond as the last one this
  // replica recorded, and a hashless event is no evidence against it.
  const hash = reportedRevision(b) ?? reportedRevision(a);
  if (a.type === b.type) {
    switch (b.type) {
      case "remote":
        return { ...b, hash };
      case "any":
        return { type: "any", remoteHash: hash };
      default:
        return b;
    }
  }
  return { type: "any", remoteHash: hash };
}

/**
 * The signal a dirty-path entry hands the engine: what it claims happened, for
 * the engine to verify against content when its own classification comes out
 * "nothing changed".
 */
export function signalFor(origin: SyncOrigin): SyncSignal {
  const hash = reportedRevision(origin);
  // Something is known to have happened; only its revision may be missing.
  return hash ? { type: "remoteRevision", hash } : { type: "changed" };
}

/**
 * Whether a local write needs to be looked at at all, or is an echo of a write
 * the engine itself just made.
 *
 * A millisecond timestamp is not proof of an echo: two writes to one path in
 * the same millisecond are indistinguishable by it. So a matching timestamp
 * only raises the question, and the local content settles it — a copy that
 * still hashes to the revision recorded for the remote is one nothing needs to
 * happen for. Deciding it here rather than in the engine keeps an echo at one
 * local read instead of a round trip.
 */
export async function localWriteIsEcho(
  local: SpacePrimitives,
  path: string,
  localMtime: number | undefined,
  snapEntry: [number, number] | undefined,
  recordedRemoteHash: string | undefined,
): Promise<boolean> {
  if (
    localMtime === undefined ||
    snapEntry === undefined ||
    recordedRemoteHash === undefined ||
    localMtime !== snapEntry[0]
  ) {
    return false;
  }
  try {
    const { data } = await local.readFile(path);
    return (await hashSHA256(data)) === recordedRemoteHash;
  } catch (e: any) {
    if (e.message !== notFoundError.message) {
      throw e;
    }
    return false;
  }
}

/**
 * Decide whether a dirty-path entry is redundant (already covered by the
 * engine's own work, or by realtime coverage) and can be dropped without
 * touching the remote.
 *
 * Same reasoning as `localWriteIsEcho` on the remote side: a matching
 * timestamp settles nothing on its own, so an event reporting a revision other
 * than the recorded one is kept even when its timestamp repeats.
 */
export function shouldSkip(
  origin: SyncOrigin,
  snapEntry: [number, number] | undefined,
  recordedRemoteHash: string | undefined,
  realtimeHealthy: boolean,
): boolean {
  switch (origin.type) {
    // Decided by content in `localWriteIsEcho`, not here.
    case "local":
      return false;
    case "remote":
      if (snapEntry === undefined || snapEntry[1] !== origin.lastModified) {
        return false;
      }
      // Nothing to contradict the timestamp with.
      return (
        origin.hash === undefined ||
        recordedRemoteHash === undefined ||
        origin.hash === recordedRemoteHash
      );
    case "probe":
      return realtimeHealthy;
    case "any":
      return false;
  }
}

/**
 * Single-consumer dirty-path queue: the intake for every sync trigger.
 * `pending` is the membership authority; `order` only provides FIFO.
 */
export class DirtyQueue {
  private order: string[] = [];
  private pending = new Map<string, SyncOrigin>();
  private fullScan = false;
  private waiter?: () => void;

  mark(path: string, origin: SyncOrigin) {
    const existing = this.pending.get(path);
    if (existing === undefined) {
      this.order.push(path);
      this.pending.set(path, origin);
    } else {
      this.pending.set(path, mergeOrigins(existing, origin));
    }
    this.wake();
  }

  markFullScan() {
    this.fullScan = true;
    this.wake();
  }

  async take(timeoutMs: number): Promise<Taken> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (this.fullScan) {
        this.fullScan = false;
        return { kind: "fullScan" };
      }
      while (this.order.length > 0) {
        const path = this.order.shift()!;
        const origin = this.pending.get(path);
        if (origin !== undefined) {
          this.pending.delete(path);
          return { kind: "path", path, origin };
        }
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { kind: "timeout" };
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
        setTimeout(resolve, remaining);
      });
      this.waiter = undefined;
    }
  }

  private wake() {
    this.waiter?.();
  }
}
