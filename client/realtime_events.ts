/**
 * Subscribes to the server's /.events SSE stream (file-system change events)
 * and uses it as a poll accelerator: events trigger the existing single-file
 * sync (service-worker mode) and the existing getFileMeta snapshot probe,
 * which fires file:changed and everything downstream. When the endpoint is
 * unavailable, nothing happens -- the client's polling remains the backstop.
 */

export type RealtimeFsEvent = {
  name: string;
  action: "change" | "delete" | "resync";
  lastModified: number;
};

export type RealtimeHooks = {
  /** getFileMeta through EventedSpacePrimitives (fires file:changed) */
  probeFile: (name: string) => Promise<unknown>;
  /** sync.performFileSync syscall */
  syncFile: (name: string) => Promise<unknown>;
  /** sync.performSpaceSync syscall */
  syncSpace: () => Promise<unknown>;
  /** fetchFileListWhenIdle (dispatches deletion/list events) */
  refreshFileList: () => Promise<unknown>;
  serviceWorkerActive: () => boolean;
};

// Transport-level batching: this window exists to minimize crossings of the
// window<->service-worker sync boundary (N postMessages collapse into one
// performSpaceSync), NOT to classify activity for the user.
const BATCH_WINDOW_MS = 250;
const BATCH_THRESHOLD = 4;
const MAX_RETRY_MS = 30_000;

export class RealtimeEvents {
  private source?: EventSource;
  private retryDelay = 1000;
  private everConnected = false;
  private stopped = false;
  private pending = new Map<string, RealtimeFsEvent>();
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(private hooks: RealtimeHooks) {}

  start(url: string) {
    this.stopped = false;
    this.connect(url);
  }

  stop() {
    this.stopped = true;
    this.source?.close();
    this.source = undefined;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private connect(url: string) {
    if (this.stopped) return;
    const source = new EventSource(url);
    this.source = source;
    source.onopen = () => {
      this.retryDelay = 1000;
      if (this.everConnected) {
        // Reconnected after a gap: catch up on anything we missed
        void this.hooks.refreshFileList().catch(console.error);
      }
      this.everConnected = true;
    };
    source.onmessage = (msg) => {
      try {
        this.handleEvent(JSON.parse(msg.data));
      } catch (e) {
        console.warn("[realtime] Could not parse event", msg.data, e);
      }
    };
    source.onerror = () => {
      // A fatal error (404, wrong content-type) sets readyState to CLOSED
      // before onerror fires; a transient one (connection refused, DNS
      // hiccup, server not warmed up yet) leaves it at CONNECTING. Only the
      // former, on a connection that never succeeded, means "unsupported" --
      // must be read before close() below, which forces CLOSED either way.
      const unsupported =
        !this.everConnected && source.readyState === EventSource.CLOSED;
      source.close();
      if (this.stopped) return;
      if (unsupported) {
        console.info("[realtime] /.events unavailable, relying on polling");
        return;
      }
      setTimeout(() => this.connect(url), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
    };
  }

  /** Exposed for tests; queues an event into the coalescing window. */
  handleEvent(ev: RealtimeFsEvent) {
    this.pending.set(ev.name, ev);
    // this.flushTimer stays truthy for the whole lifetime of a flush (see
    // runFlush), not just while the timer is pending, so events arriving
    // mid-flush join the next batch instead of kicking off an overlapping
    // one.
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.runFlush(), BATCH_WINDOW_MS);
    }
  }

  private async runFlush() {
    await this.flush();
    this.flushTimer = undefined;
    if (this.pending.size > 0 && !this.stopped) {
      this.flushTimer = setTimeout(() => void this.runFlush(), BATCH_WINDOW_MS);
    }
  }

  private async flush() {
    const batch = [...this.pending.values()];
    this.pending.clear();
    const resync = batch.some((e) => e.action === "resync");
    const deletes = batch.filter((e) => e.action === "delete");
    const changes = batch.filter((e) => e.action === "change");
    try {
      if (resync || changes.length >= BATCH_THRESHOLD) {
        // Flood/resync: one space sync (SW mode) + one list fetch, whose
        // snapshot comparison regenerates the right per-file events locally
        // (this covers any deletes in the batch too)
        if (this.hooks.serviceWorkerActive()) {
          await this.hooks.syncSpace();
        }
        await this.hooks.refreshFileList();
        return;
      }
      for (const ev of changes) {
        try {
          if (this.hooks.serviceWorkerActive()) {
            await this.hooks.syncFile(ev.name);
          }
          await this.hooks.probeFile(ev.name);
        } catch (e) {
          console.warn("[realtime] Error processing event", ev.name, e);
        }
      }
      if (deletes.length > 0) {
        await this.hooks.refreshFileList();
      }
    } catch (e) {
      console.warn("[realtime] Error processing events", e);
    }
  }
}
