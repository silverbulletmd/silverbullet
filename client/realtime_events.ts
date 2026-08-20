/**
 * Subscribes to the server's /.events SSE stream (file-system change events)
 * and uses it as a poll accelerator: events trigger the existing single-file
 * sync (service-worker mode) and the existing getFileMeta snapshot probe,
 * which fires file:changed and everything downstream. When the endpoint is
 * unavailable, the subscriber keeps probing in the background every 60s and
 * reconnects immediately on the browser's 'online' event, with the client's
 * polling as the backstop in the meantime.
 */

export type RealtimeFsEventRevision = {
  algorithm: string;
  hash: string;
  size: number;
  lastModified: number;
};

export type RealtimeFsEventOrigin = {
  kind: "user" | "external";
  displayName?: string;
  clientId?: string;
  source?: string;
};

export type RealtimeFsEvent = {
  name: string;
  action: "change" | "delete" | "resync";
  lastModified: number;
  /**
   * The revision the server now holds. Passed on to the sync engine, which
   * needs it to tell a change made in the same millisecond as the last one it
   * recorded from an echo of its own push.
   */
  revision?: RealtimeFsEventRevision;
  origin?: RealtimeFsEventOrigin;
};

export type RealtimeHooks = {
  /**
   * Records a change event's attribution before any sync/probe work starts.
   * Called eagerly because the file:changed dispatch this origin will label
   * can be triggered by ANY concurrent metadata fetch, not just probeFile's.
   */
  noteOrigin: (name: string, origin: RealtimeFsEventOrigin) => void;
  /** getFileMeta through EventedSpacePrimitives (fires file:changed) */
  probeFile: (name: string) => Promise<unknown>;
  /** sync.performFileSync syscall */
  syncFile: (
    name: string,
    lastModified: number,
    revisionHash?: string,
  ) => Promise<unknown>;
  /** sync.performSpaceSync syscall */
  syncSpace: () => Promise<unknown>;
  /** fetchFileListWhenIdle (dispatches deletion/list events) */
  refreshFileList: () => Promise<unknown>;
  serviceWorkerActive: () => boolean;
  /** Reports event-stream health to the service worker; sent as a heartbeat (not a one-shot flag) because a closed tab sends no disconnect, so the receiving end must decay it via TTL rather than rely on a sticky flag. Only ever refreshed by traffic actually received: a half-open connection stays "open" indefinitely while delivering nothing, and health claimed from connection state alone would keep the polling backstop suppressed. */
  notifyStatus: (connected: boolean) => void;
};

// Transport-level batching: this window exists to minimize crossings of the
// window<->service-worker sync boundary (N postMessages collapse into one
// performSpaceSync), NOT to classify activity for the user.
const BATCH_WINDOW_MS = 250;
const BATCH_THRESHOLD = 4;
const MAX_RETRY_MS = 30_000;
const UNSUPPORTED_RETRY_MS = 60_000;
const HEARTBEAT_THROTTLE_MS = 5_000;

export class RealtimeEvents {
  private source?: EventSource;
  private retryDelay = 1000;
  private everConnected = false;
  private stopped = false;
  private pending = new Map<string, RealtimeFsEvent>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  private url?: string;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private loggedUnsupported = false;
  private lastHeartbeatAt = 0;

  constructor(private hooks: RealtimeHooks) {}

  start(url: string) {
    this.stopped = false;
    this.url = url;
    (globalThis as any).addEventListener?.("online", this.onOnline);
    this.connect(url);
  }

  stop() {
    this.stopped = true;
    (globalThis as any).removeEventListener?.("online", this.onOnline);
    this.source?.close();
    this.source = undefined;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.reportDown();
  }

  /** Reports health, at most once per throttle window. */
  private onReceipt = () => {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < HEARTBEAT_THROTTLE_MS) return;
    this.lastHeartbeatAt = now;
    this.hooks.notifyStatus(true);
  };

  private reportDown() {
    this.lastHeartbeatAt = 0;
    this.hooks.notifyStatus(false);
  }

  private onOnline = () => {
    // Only act when a reconnect is pending: a healthy connection needs no
    // help, and this must never spawn a second EventSource next to one.
    if (this.stopped || !this.url || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryDelay = 1000;
    this.connect(this.url);
  };

  private scheduleReconnect(delay: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect(this.url!);
    }, delay);
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
      this.onReceipt();
    };
    source.onmessage = (msg) => {
      this.onReceipt();
      try {
        this.handleEvent(JSON.parse(msg.data));
      } catch (e) {
        console.warn("[realtime] Could not parse event", msg.data, e);
      }
    };
    // The server's keep-alive: a named event because EventSource never
    // surfaces SSE comments, so on a quiet stream this is the only proof of
    // liveness the browser gets. Carries no payload.
    source.addEventListener("ping", this.onReceipt);
    source.onerror = () => {
      // A fatal error (404, wrong content-type) sets readyState to CLOSED
      // before onerror fires; a transient one (connection refused, DNS
      // hiccup, server not warmed up yet) leaves it at CONNECTING. A hard
      // offline failure can land in either bucket depending on the engine,
      // so "unsupported" only slows the retry down -- it never ends it.
      const unsupported =
        !this.everConnected && source.readyState === EventSource.CLOSED;
      source.close();
      this.reportDown();
      if (this.stopped) return;
      if (unsupported) {
        if (!this.loggedUnsupported) {
          console.info(
            "[realtime] /.events unavailable, polling remains primary; will keep probing",
          );
          this.loggedUnsupported = true;
        }
        this.scheduleReconnect(UNSUPPORTED_RETRY_MS);
        return;
      }
      this.scheduleReconnect(this.retryDelay);
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
    for (const ev of changes) {
      if (ev.origin) {
        this.hooks.noteOrigin(ev.name, ev.origin);
      }
    }
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
            await this.hooks.syncFile(
              ev.name,
              ev.lastModified,
              // Only sha256, which is what the sync engine can compare local
              // content against; anything else is no evidence at all.
              ev.revision?.algorithm === "sha256"
                ? ev.revision.hash
                : undefined,
            );
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
