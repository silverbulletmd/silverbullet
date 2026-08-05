import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeEvents, type RealtimeHooks } from "./realtime_events.ts";

function makeHooks() {
  return {
    probeFile: vi.fn((_name: string) => Promise.resolve()),
    syncFile: vi.fn(() => Promise.resolve()),
    syncSpace: vi.fn(() => Promise.resolve()),
    refreshFileList: vi.fn(() => Promise.resolve()),
    serviceWorkerActive: vi.fn(() => false),
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
    expect(hooks.syncFile).toHaveBeenCalledWith("page.md");
    expect(hooks.probeFile).toHaveBeenCalledWith("page.md");
    expect(hooks.syncFile.mock.invocationCallOrder[0]).toBeLessThan(
      hooks.probeFile.mock.invocationCallOrder[0],
    );
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

  constructor(public url: string) {}

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

  it("does not retry a never-connected source the browser reports as fatally closed (e.g. 404)", async () => {
    const rt = new RealtimeEvents(hooks);
    rt.start("http://localhost/.events");
    expect(instances).toHaveLength(1);

    // A fatal HTTP failure (404, wrong content-type) leaves readyState
    // CLOSED by the time onerror fires.
    instances[0].readyState = FakeEventSource.CLOSED;
    instances[0].onerror?.();
    await vi.runAllTimersAsync();

    expect(instances).toHaveLength(1);
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
});
