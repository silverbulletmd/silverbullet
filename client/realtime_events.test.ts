import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeEvents,
  type RealtimeFsEventOrigin,
  type RealtimeHooks,
} from "./realtime_events.ts";

function makeHooks() {
  return {
    noteOrigin: vi.fn(
      (_name: string, _origin: RealtimeFsEventOrigin) => undefined,
    ),
    probeFile: vi.fn((_name: string) => Promise.resolve()),
    syncFile: vi.fn((_name: string, _lastModified: number) =>
      Promise.resolve(),
    ),
    syncSpace: vi.fn(() => Promise.resolve()),
    refreshFileList: vi.fn(() => Promise.resolve()),
    serviceWorkerActive: vi.fn(() => false),
    notifyStatus: vi.fn(),
  } satisfies RealtimeHooks;
}

describe("RealtimeEvents routing", () => {
  let hooks: ReturnType<typeof makeHooks>;
  let rt: RealtimeEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    hooks = makeHooks();
    rt = new RealtimeEvents(hooks);
  });

  it("probes the file on a change event (no SW)", async () => {
    rt.handleEvent({ name: "page.md", action: "change", lastModified: 1 });
    await vi.runAllTimersAsync();
    expect(hooks.probeFile).toHaveBeenCalledWith("page.md");
    expect(hooks.syncFile).not.toHaveBeenCalled();
  });

  it("syncs then probes when a service worker is active", async () => {
    hooks.serviceWorkerActive.mockReturnValue(true);
    rt.handleEvent({ name: "page.md", action: "change", lastModified: 1 });
    await vi.runAllTimersAsync();
    expect(hooks.syncFile).toHaveBeenCalledWith("page.md", 1, undefined);
    expect(hooks.probeFile).toHaveBeenCalledWith("page.md");
    expect(hooks.syncFile.mock.invocationCallOrder[0]).toBeLessThan(
      hooks.probeFile.mock.invocationCallOrder[0],
    );
  });

  it("passes the event lastModified and revision to syncFile", async () => {
    hooks.serviceWorkerActive.mockReturnValue(true);
    rt.handleEvent({
      name: "a.md",
      action: "change",
      lastModified: 42,
      revision: {
        algorithm: "sha256",
        hash: "abc123",
        size: 3,
        lastModified: 42,
      },
    });
    await vi.advanceTimersByTimeAsync(300);
    // The revision rides along: it is what tells a same-millisecond remote
    // change apart from an echo of this client's own push.
    expect(hooks.syncFile).toHaveBeenCalledWith("a.md", 42, "abc123");
  });

  it("ignores a revision in an algorithm it cannot compare against", async () => {
    hooks.serviceWorkerActive.mockReturnValue(true);
    rt.handleEvent({
      name: "a.md",
      action: "change",
      lastModified: 42,
      revision: {
        algorithm: "blake3",
        hash: "abc123",
        size: 3,
        lastModified: 42,
      },
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(hooks.syncFile).toHaveBeenCalledWith("a.md", 42, undefined);
  });

  it("refreshes the file list on delete events", async () => {
    rt.handleEvent({ name: "gone.md", action: "delete", lastModified: 0 });
    await vi.runAllTimersAsync();
    expect(hooks.refreshFileList).toHaveBeenCalled();
    expect(hooks.probeFile).not.toHaveBeenCalled();
  });

  it("collapses a burst into a space sync (SW mode)", async () => {
    hooks.serviceWorkerActive.mockReturnValue(true);
    for (let i = 0; i < 6; i++) {
      rt.handleEvent({ name: `f${i}.md`, action: "change", lastModified: 1 });
    }
    await vi.runAllTimersAsync();
    expect(hooks.syncSpace).toHaveBeenCalledTimes(1);
    expect(hooks.syncFile).not.toHaveBeenCalled();
    expect(hooks.probeFile).not.toHaveBeenCalled();
  });

  it("collapses a burst into one list refresh without SW (no per-file probes)", async () => {
    for (let i = 0; i < 6; i++) {
      rt.handleEvent({ name: `f${i}.md`, action: "change", lastModified: 1 });
    }
    await vi.runAllTimersAsync();
    expect(hooks.refreshFileList).toHaveBeenCalledTimes(1);
    expect(hooks.probeFile).not.toHaveBeenCalled();
    expect(hooks.syncSpace).not.toHaveBeenCalled();
  });

  it("notes origins even when a burst collapses into a space sync", async () => {
    hooks.serviceWorkerActive.mockReturnValue(true);
    const origin: RealtimeFsEventOrigin = {
      kind: "user",
      displayName: "alice",
    };
    for (let i = 0; i < 6; i++) {
      rt.handleEvent({
        name: `f${i}.md`,
        action: "change",
        lastModified: 1,
        origin,
      });
    }
    await vi.runAllTimersAsync();
    expect(hooks.syncSpace).toHaveBeenCalledTimes(1);
    expect(hooks.noteOrigin).toHaveBeenCalledTimes(6);
    expect(hooks.noteOrigin).toHaveBeenCalledWith("f3.md", origin);
  });

  it("treats a resync event as a full refresh", async () => {
    hooks.serviceWorkerActive.mockReturnValue(true);
    rt.handleEvent({ name: "", action: "resync", lastModified: 0 });
    await vi.runAllTimersAsync();
    expect(hooks.syncSpace).toHaveBeenCalledTimes(1);
    expect(hooks.refreshFileList).toHaveBeenCalledTimes(1);
    expect(hooks.probeFile).not.toHaveBeenCalled();
  });

  it("does not drop remaining files in a batch when one file's probe rejects", async () => {
    hooks.probeFile.mockImplementation((name: string) =>
      name === "bad.md" ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    rt.handleEvent({ name: "bad.md", action: "change", lastModified: 1 });
    rt.handleEvent({ name: "good.md", action: "change", lastModified: 1 });
    await vi.runAllTimersAsync();
    expect(hooks.probeFile).toHaveBeenCalledWith("bad.md");
    expect(hooks.probeFile).toHaveBeenCalledWith("good.md");
  });
});

describe("RealtimeEvents.flush re-entrancy", () => {
  let hooks: ReturnType<typeof makeHooks>;
  let rt: RealtimeEvents;

  beforeEach(() => {
    vi.useFakeTimers();
    hooks = makeHooks();
    rt = new RealtimeEvents(hooks);
  });

  it("does not run overlapping refreshes when a new burst arrives mid-flush", async () => {
    let resolveFirst!: () => void;
    const firstCall = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let refreshCalls = 0;
    hooks.refreshFileList.mockImplementation(() => {
      refreshCalls++;
      return refreshCalls === 1 ? firstCall : Promise.resolve();
    });

    // First burst triggers a flush that hangs mid-flight.
    rt.handleEvent({ name: "", action: "resync", lastModified: 0 });
    await vi.advanceTimersByTimeAsync(250);
    expect(refreshCalls).toBe(1);

    // Second burst arrives while the first flush is still awaiting.
    rt.handleEvent({ name: "", action: "resync", lastModified: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    // Must not have started a second, overlapping refresh yet.
    expect(refreshCalls).toBe(1);

    // Let the first flush settle; the second (queued) burst should now flush.
    resolveFirst();
    await vi.runAllTimersAsync();
    expect(refreshCalls).toBe(2);
  });
});

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState: number = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, () => void>();

  constructor(public url: string) {}

  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, fn);
  }

  emit(type: string) {
    this.listeners.get(type)?.();
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

describe("RealtimeEvents connection lifecycle", () => {
  let hooks: ReturnType<typeof makeHooks>;
  let instances: FakeEventSource[];
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    vi.useFakeTimers();
    hooks = makeHooks();
    instances = [];
    originalEventSource = globalThis.EventSource;
    (globalThis as any).EventSource = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        instances.push(this);
      }
    };
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it("retries a never-connected fatally-closed source on a slow cadence", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    expect(instances).toHaveLength(1);

    // A fatal HTTP failure (404, wrong content-type) leaves readyState
    // CLOSED by the time onerror fires.
    instances[0].readyState = FakeEventSource.CLOSED;
    instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(instances).toHaveLength(2);
  });

  it("retries a never-connected source that failed transiently (readyState still CONNECTING)", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    expect(instances).toHaveLength(1);

    // A transient failure (connection refused, DNS hiccup, server not warm
    // yet) leaves readyState at CONNECTING when onerror fires.
    instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(1000);

    expect(instances).toHaveLength(2);
  });

  it("reconnects immediately on the online event, resetting backoff", async () => {
    const listeners = new Map<string, () => void>();
    const origAdd = (globalThis as any).addEventListener;
    const origRemove = (globalThis as any).removeEventListener;
    (globalThis as any).addEventListener = (name: string, fn: () => void) => {
      listeners.set(name, fn);
    };
    (globalThis as any).removeEventListener = (name: string) => {
      listeners.delete(name);
    };
    try {
      const rt = new RealtimeEvents(hooks);
      rt.start("http://localhost/.events");
      instances[0].onerror?.();
      expect(instances).toHaveLength(1);

      listeners.get("online")?.();
      expect(instances).toHaveLength(2);

      rt.stop();
      expect(listeners.has("online")).toBe(false);
    } finally {
      (globalThis as any).addEventListener = origAdd;
      (globalThis as any).removeEventListener = origRemove;
    }
  });

  it("reports status on open and reports down on error", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onopen?.();
    expect(hooks.notifyStatus).toHaveBeenLastCalledWith(true);
    instances[0].onerror?.();
    expect(hooks.notifyStatus).toHaveBeenLastCalledWith(false);
    rt.stop();
  });

  it("stops reporting health when the stream goes quiet", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onopen?.();
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(1);

    // A half-open connection: still "open", delivering nothing. Health must
    // not be re-asserted, so the receiving end's TTL can decay it.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(1);
    rt.stop();
  });

  it("heartbeats on message receipt", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onopen?.();
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    instances[0].onmessage?.({
      data: JSON.stringify({ name: "a.md", action: "change", lastModified: 1 }),
    });
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(2);
    expect(hooks.notifyStatus).toHaveBeenLastCalledWith(true);
    await vi.runAllTimersAsync();
    rt.stop();
  });

  it("heartbeats on ping events, which carry no file payload", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onopen?.();

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      instances[0].emit("ping");
    }
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(4);
    expect(hooks.notifyStatus).toHaveBeenLastCalledWith(true);
    expect(hooks.probeFile).not.toHaveBeenCalled();
    expect(hooks.refreshFileList).not.toHaveBeenCalled();
    rt.stop();
  });

  it("throttles heartbeats on a chatty stream", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onopen?.();
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      instances[0].emit("ping");
    }
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(1);

    // Still inside the throttle window.
    await vi.advanceTimersByTimeAsync(4_000);
    instances[0].emit("ping");
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(1);

    // Past it: the window must reopen well before the server's next 30s ping,
    // so no ping is ever throttled away twice in a row.
    await vi.advanceTimersByTimeAsync(2_000);
    instances[0].emit("ping");
    expect(hooks.notifyStatus).toHaveBeenCalledTimes(2);
    rt.stop();
  });

  it("parses a legacy SSE message with no revision/origin fields", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onmessage?.({
      data: JSON.stringify({ name: "a.md", action: "change", lastModified: 1 }),
    });
    await vi.runAllTimersAsync();
    expect(hooks.probeFile).toHaveBeenCalledWith("a.md");
  });

  it("tolerates an enriched SSE message carrying revision/origin, and notes the origin before probing", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    instances[0].onmessage?.({
      data: JSON.stringify({
        name: "a.md",
        action: "change",
        lastModified: 1,
        revision: {
          algorithm: "sha256",
          hash: "abc",
          size: 3,
          lastModified: 1,
        },
        origin: {
          kind: "user",
          displayName: "zef",
          clientId: "client-1",
          source: "editor",
        },
      }),
    });
    await vi.runAllTimersAsync();
    expect(hooks.noteOrigin).toHaveBeenCalledWith("a.md", {
      kind: "user",
      displayName: "zef",
      clientId: "client-1",
      source: "editor",
    });
    expect(hooks.probeFile).toHaveBeenCalledWith("a.md");
    // The origin must be recorded BEFORE the probe: the file:changed dispatch
    // it labels can be triggered by any concurrent metadata fetch, including
    // ones that complete while the probe is still in flight.
    expect(hooks.noteOrigin.mock.invocationCallOrder[0]).toBeLessThan(
      hooks.probeFile.mock.invocationCallOrder[0],
    );
  });

  it("online event while healthily connected does not spawn a duplicate connection", async () => {
    const listeners = new Map<string, () => void>();
    const origAdd = (globalThis as any).addEventListener;
    const origRemove = (globalThis as any).removeEventListener;
    (globalThis as any).addEventListener = (name: string, fn: () => void) => {
      listeners.set(name, fn);
    };
    (globalThis as any).removeEventListener = (name: string) => {
      listeners.delete(name);
    };
    try {
      const rt = new RealtimeEvents(hooks);
      rt.start("http://localhost/.events");
      instances[0].onopen?.();
      listeners.get("online")?.();
      expect(instances).toHaveLength(1);
      rt.stop();
    } finally {
      (globalThis as any).addEventListener = origAdd;
      (globalThis as any).removeEventListener = origRemove;
    }
  });
});
