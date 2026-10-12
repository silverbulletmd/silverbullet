import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import { LimitedMap } from "@silverbulletmd/silverbullet/lib/limited_map";
import type { DataStore } from "./data/datastore.ts";
import type { EventInterest } from "./event_interest.ts";
import { expandRefreshTriggers } from "./navigator/refresh_triggers.ts";
import type { Tracker } from "./space_lua/dependencies.ts";

export type WidgetMeta = {
  height: number;
  block: boolean;
};

type Prewarm = {
  result: Promise<any>;
  // Interest sequence when the computation started (see live_binding.ts)
  computedAt: number;
  // What the computation read: refresh on them
  triggers: Set<string>;
  release: Array<() => void>;
  // Sweep generation that last asked for it
  touched: number;
};

const MAX_PREWARMS = 1000;

export class WidgetCache {
  private widgetMetaCache = new LimitedMap<WidgetMeta>(1000);
  // Start widget callbacks before mounting so fast scrolling can reuse
  // in-flight or completed results. This cache lasts only for the session.
  // In least recently used order.
  private prewarms = new Map<string, Prewarm>();
  // Sweep generation, see `sweepPrewarm`
  private generation = 0;

  private debouncedWidgetMetaCacheFlush = throttle(() => {
    this.ds
      .set(["cache", "widgetMeta"], this.widgetMetaCache.toJSON())
      .catch(console.error);
  }, 2000);

  constructor(
    private ds: DataStore,
    private interest: EventInterest,
  ) {}

  get prewarmSize(): number {
    return this.prewarms.size;
  }

  async load() {
    const widgetMetaCache = await this.ds.get(["cache", "widgetMeta"]);
    this.widgetMetaCache = new LimitedMap(1000, widgetMetaCache || {});
  }

  setCachedWidgetMeta(key: string, meta: WidgetMeta) {
    const existing = this.widgetMetaCache.get(key);
    if (
      existing &&
      existing.height === meta.height &&
      existing.block === meta.block
    ) {
      return;
    }
    this.widgetMetaCache.set(key, meta);
    this.debouncedWidgetMetaCacheFlush();
  }

  getCachedWidgetMeta(key: string): WidgetMeta | undefined {
    return this.widgetMetaCache.get(key);
  }

  // CodeMirror's WidgetType.estimatedHeight expects a plain number.
  getCachedWidgetHeight(key: string): number {
    return this.widgetMetaCache.get(key)?.height ?? -1;
  }

  removeCachedWidgetMeta(key: string) {
    if (!this.widgetMetaCache.get(key)) return;
    this.widgetMetaCache.remove(key);
    this.debouncedWidgetMetaCacheFlush();
  }

  // Pre-execute (or return the in-flight/completed result of) a widget
  // callback. Subsequent calls with the same key return the same promise,
  // so calling this from a widget's constructor is safe even when the
  // CodeMirror decoration field re-builds widgets on every state update.
  prewarmResult<T>(
    key: string,
    fn: (track: Tracker) => Promise<T>,
  ): Promise<T> {
    let entry = this.prewarms.get(key);
    this.prewarms.delete(key);
    if (!entry) {
      const created: Prewarm = {
        result: Promise.resolve(),
        computedAt: this.interest.seq(),
        triggers: new Set(),
        release: [],
        touched: this.generation,
      };
      // Stored before computing: the tracker only holds for a live entry
      this.prewarms.set(key, created);
      // Held as soon as read, so an event between the read and the commit
      // still counts as missed
      created.result = fn((trigger) => {
        if (this.prewarms.get(key) !== created) return;
        if (created.triggers.has(trigger)) return;
        created.triggers.add(trigger);
        created.release.push(
          this.interest.listen(expandRefreshTriggers([trigger])),
        );
      });
      entry = created;
    }
    entry.touched = this.generation;
    this.prewarms.delete(key);
    this.prewarms.set(key, entry);
    if (this.prewarms.size > MAX_PREWARMS) {
      this.drop(this.prewarms.keys().next().value!);
    }
    return entry.result as Promise<T>;
  }

  computedAt(key: string): number | undefined {
    return this.prewarms.get(key)?.computedAt;
  }

  /** The events a cached result found it depends on while computing. */
  triggers(key: string): string[] {
    return [...(this.prewarms.get(key)?.triggers ?? [])];
  }

  invalidatePrewarm(key: string) {
    this.drop(key);
  }

  clearPrewarm() {
    for (const key of [...this.prewarms.keys()]) this.drop(key);
  }

  /** Drops results no widget asked for since the previous sweep (after edits). */
  sweepPrewarm() {
    for (const [key, entry] of [...this.prewarms]) {
      if (entry.touched < this.generation) this.drop(key);
    }
    this.generation++;
  }

  private drop(key: string) {
    const entry = this.prewarms.get(key);
    if (!entry) return;
    this.prewarms.delete(key);
    for (const release of entry.release.splice(0)) release();
  }
}
