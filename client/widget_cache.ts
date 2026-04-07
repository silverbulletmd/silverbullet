import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import { LimitedMap } from "@silverbulletmd/silverbullet/lib/limited_map";
import type { DataStore } from "./data/datastore.ts";

export type WidgetMeta = {
  height: number;
  block: boolean;
};

export class WidgetCache {
  private widgetMetaCache = new LimitedMap<WidgetMeta>(1000);

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
}
