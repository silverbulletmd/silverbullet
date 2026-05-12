import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import { LimitedMap } from "@silverbulletmd/silverbullet/lib/limited_map";
import type { DataStore } from "./data/datastore.ts";

export type WidgetMeta = {
  height: number;
  block: boolean;
};

export class WidgetCache {
  private widgetMetaCache = new LimitedMap<WidgetMeta>(1000);
  // Session-only cache of in-flight or completed widget callback results.
  // Used to kick off widget queries before CodeMirror actually mounts the
  // widget (e.g. when scrolling fast past widgets that haven't entered the
  // viewport yet), so renderContent can synchronously await a result that's
  // already been computed.
  private pendingResults = new LimitedMap<Promise<any>>(1000);

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
      existing && existing.height === meta.height && existing.block === meta.block
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
  prewarmResult<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.pendingResults.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn();
      this.pendingResults.set(key, p);
    }
    return p;
  }

  invalidatePrewarm(key: string) {
    this.pendingResults.remove(key);
  }

  clearPrewarm() {
    this.pendingResults = new LimitedMap(1000);
  }
}
