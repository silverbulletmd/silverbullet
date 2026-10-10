import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import { LimitedMap } from "@silverbulletmd/silverbullet/lib/limited_map";
import type { DataStore } from "./data/datastore.ts";

export type WidgetMeta = {
  height: number;
  block: boolean;
};

export class WidgetCache {
  private widgetMetaCache = new LimitedMap<WidgetMeta>(1000);
  // Start widget callbacks before mounting so fast scrolling can reuse
  // in-flight or completed results. This cache lasts only for the session.
  private pendingResults = new LimitedMap<{
    result: Promise<any>;
    // Event counts when the result was computed (see live_binding.ts)
    computedAt?: Map<string, number>;
  }>(1000);

  private debouncedWidgetMetaCacheFlush = throttle(() => {
    this.ds
      .set(["cache", "widgetMeta"], this.widgetMetaCache.toJSON())
      .catch(console.error);
  }, 2000);

  constructor(private ds: DataStore) {}

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
    fn: () => Promise<T>,
    stamp?: () => Map<string, number>,
  ): Promise<T> {
    let entry = this.pendingResults.get(key);
    if (!entry) {
      const computedAt = stamp?.();
      entry = { result: fn(), computedAt };
      this.pendingResults.set(key, entry);
    }
    return entry.result as Promise<T>;
  }

  computedAt(key: string): Map<string, number> | undefined {
    return this.pendingResults.get(key)?.computedAt;
  }

  invalidatePrewarm(key: string) {
    this.pendingResults.remove(key);
  }

  clearPrewarm() {
    this.pendingResults = new LimitedMap(1000);
  }
}
