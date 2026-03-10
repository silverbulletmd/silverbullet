import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import { LimitedMap } from "@silverbulletmd/silverbullet/lib/limited_map";
import type { DataStore } from "./data/datastore.ts";

export type WidgetCacheItem = {
  html: string;
  block?: boolean;
  copyContent?: string;
};

export class WidgetCache {
  private widgetCache = new LimitedMap<WidgetCacheItem>(100);
  private widgetHeightCache = new LimitedMap<number>(1000);

  private debouncedWidgetCacheFlush = throttle(() => {
    this.ds
      .set(["cache", "widgets"], this.widgetCache.toJSON())
      .catch(console.error);
  }, 2000);

  private debouncedWidgetHeightCacheFlush = throttle(() => {
    this.ds
      .set(["cache", "widgetHeight"], this.widgetHeightCache.toJSON())
      .catch(console.error);
  }, 2000);

  constructor(private ds: DataStore) {}

  async load() {
    const [widgetHeightCache, widgetCache] = await this.ds.batchGet([
      ["cache", "widgetHeight"],
      ["cache", "widgets"],
    ]);
    this.widgetHeightCache = new LimitedMap(1000, widgetHeightCache || {});
    this.widgetCache = new LimitedMap(100, widgetCache || {});
  }

  setCachedWidgetHeight(bodyText: string, height: number) {
    this.widgetHeightCache.set(bodyText, height);
    this.debouncedWidgetHeightCacheFlush();
  }

  getCachedWidgetHeight(bodyText: string): number {
    return this.widgetHeightCache.get(bodyText) ?? -1;
  }

  setWidgetCache(key: string, cacheItem: WidgetCacheItem) {
    this.widgetCache.set(key, cacheItem);
    this.debouncedWidgetCacheFlush();
  }

  getWidgetCache(key: string): WidgetCacheItem | undefined {
    return this.widgetCache.get(key);
  }
}
