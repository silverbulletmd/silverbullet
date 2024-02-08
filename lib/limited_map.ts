type LimitedMapRecord<V> = {
  value: V;
  la: number;
  expTimer?: number;
};

export class LimitedMap<V> {
  private map: Map<string, LimitedMapRecord<V>>;

  constructor(
    private maxSize: number,
    initialJson: Record<string, LimitedMapRecord<V>> = {},
  ) {
    this.map = new Map(Object.entries(initialJson));
  }

  /**
   * @param key
   * @param value
   * @param ttl time to live (in ms)
   */
  set(key: string, value: V, ttl?: number) {
    const entry: LimitedMapRecord<V> = { value, la: Date.now() };
    if (ttl) {
      const existingEntry = this.map.get(key);
      if (existingEntry?.expTimer) {
        clearTimeout(existingEntry.expTimer);
      }
      entry.expTimer = setTimeout(() => {
        this.map.delete(key);
      }, ttl);
    }
    if (this.map.size >= this.maxSize) {
      // Remove the oldest key before adding a new one
      const oldestKey = this.getOldestKey();
      this.map.delete(oldestKey!);
    }
    this.map.set(key, entry);
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (entry) {
      // Update the last accessed timestamp
      entry.la = Date.now();
      return entry.value;
    }
    return undefined;
  }

  remove(key: string) {
    this.map.delete(key);
  }

  toJSON() {
    return Object.fromEntries(this.map.entries());
  }

  private getOldestKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTimestamp: number | undefined;

    for (const [key, entry] of this.map.entries()) {
      if (!oldestTimestamp || entry.la < oldestTimestamp) {
        oldestKey = key;
        oldestTimestamp = entry.la;
      }
    }

    return oldestKey;
  }
}
