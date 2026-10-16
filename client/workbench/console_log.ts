import { setRuntimeLogSink } from "../lib/runtime_log.ts";
import type { ServiceWorkerSourceMessage } from "../types/ui.ts";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";
export type LogSource = "lua" | "js" | "plug" | "sw";
export type LogOrigin = { ref: string; from?: number };

/** What gets logged: console input and its outcome, or a message from a source. */
export type LogRecord =
  | { kind: "input"; ref: string; code: string }
  | { kind: "result"; values: unknown[] }
  | { kind: "stopped" }
  | {
      kind: "message";
      level: LogLevel;
      source: LogSource;
      args: unknown[];
      origin?: LogOrigin;
      /** Narrows the source, e.g. the plug's name. */
      scope?: string;
    };

export type LogEntry = LogRecord & { id: number; time: number };

/** Console input and its outcome are Lua; messages say where they came from. */
export function entrySource(e: LogEntry): LogSource {
  return e.kind === "message" ? e.source : "lua";
}

export function isErrorEntry(e: LogEntry): boolean {
  return e.kind === "message" && e.level === "error";
}

const LEVELS: LogLevel[] = ["log", "info", "warn", "error", "debug"];

/**
 * Browsers report a "ResizeObserver loop" error when a resize observer's
 * callback changes layout again within one frame; the notifications are only
 * deferred to the next frame, so nothing went wrong. Panels that measure
 * themselves (segmented controls, the log's scroll-to-end) set it off as tabs
 * show and hide, and it would read as a real error in the log.
 */
function isBenignResizeObserverLoop(ev: ErrorEvent): boolean {
  return ev.error == null && /^ResizeObserver loop/.test(ev.message ?? "");
}
const DEDUPE_WINDOW = 20;

export class ConsoleLog {
  readonly entries: LogEntry[] = [];
  original: Pick<Console, LogLevel> = console;
  private nextId = 1;
  private subscribers = new Set<(entries: LogEntry[]) => void>();
  // Subscribers render and may log; recording that would loop
  private notifying = false;

  constructor(private cap = 1000) {}

  append(record: LogRecord): LogEntry {
    const entry: LogEntry = { ...record, id: this.nextId++, time: Date.now() };
    if (this.notifying) return entry;
    this.entries.push(entry);
    if (this.entries.length > this.cap) {
      this.entries.splice(0, this.entries.length - this.cap);
    }
    this.notify();
    return entry;
  }

  /** Shorthand for a message record. */
  message(
    level: LogLevel,
    source: LogSource,
    args: unknown[],
    more: { origin?: LogOrigin; scope?: string } = {},
  ): LogEntry {
    return this.append({ kind: "message", level, source, args, ...more });
  }

  clear() {
    this.entries.length = 0;
    this.notify();
  }

  subscribe(fn: (entries: LogEntry[]) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  install(target: {
    console: Console;
    addEventListener: Window["addEventListener"];
    /** Where service worker log lines arrive (`navigator.serviceWorker`). */
    serviceWorker?: Pick<ServiceWorkerContainer, "addEventListener">;
  }) {
    const c = target.console;
    const original = {} as Pick<Console, LogLevel>;
    for (const level of LEVELS) {
      const fn = c[level].bind(c);
      original[level] = fn;
      // Assigning a method on Console needs a cast; the signatures are compatible at runtime
      (c as unknown as Record<LogLevel, (...args: unknown[]) => void>)[level] =
        (...args: unknown[]) => {
          fn(...args);
          this.message(level, "js", args);
        };
    }
    this.original = original;
    target.addEventListener("error", (ev: ErrorEvent) => {
      if (isBenignResizeObserverLoop(ev)) return;
      this.message("error", "js", [ev.error ?? ev.message]);
    });
    target.addEventListener(
      "unhandledrejection",
      (ev: PromiseRejectionEvent) => {
        // client.reportError (debug.ts) may already have logged this reason via console.error
        if (this.recentlyLogged(ev.reason)) return;
        this.message("error", "js", [ev.reason]);
      },
    );
    setRuntimeLogSink((r) => {
      // Lua print writes nowhere else; worker lines are in the browser console already
      if (r.source === "lua") original.log("[Lua]", r.text);
      this.message(r.level, r.source, [r.text], {
        origin: r.origin,
        scope: r.scope,
      });
    });
    target.serviceWorker?.addEventListener(
      "message",
      (ev: MessageEvent<ServiceWorkerSourceMessage>) => {
        if (ev.data?.type !== "log") return;
        this.message(ev.data.entry.level, "sw", [ev.data.entry.message]);
      },
    );
  }

  private recentlyLogged(value: unknown): boolean {
    return this.entries
      .slice(-DEDUPE_WINDOW)
      .some(
        (e) => e.kind === "message" && e.args.some((a) => Object.is(a, value)),
      );
  }

  private notify() {
    this.notifying = true;
    try {
      for (const fn of this.subscribers) {
        try {
          fn(this.entries);
        } catch (err) {
          // Unwrapped console, so the failure is not recorded back into the log
          this.original.error("[ConsoleLog] subscriber failed", err);
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

export const consoleLog = new ConsoleLog();
