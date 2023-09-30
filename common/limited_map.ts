type LimitedMapRecord<V> = Record<string, { value: V; la: number }>;

export class LimitedMap<V> {
  constructor(private maxSize: number, private map: LimitedMapRecord<V> = {}) {
  }

  set(key: string, value: V) {
    if (Object.keys(this.map).length >= this.maxSize) {
      // Remove the oldest key before adding a new one
      const oldestKey = this.getOldestKey();
      delete this.map[oldestKey!];
    }
    this.map[key] = { value, la: Date.now() };
  }

  get(key: string): V | undefined {
    const entry = this.map[key];
    if (entry) {
      // Update the last accessed timestamp
      entry.la = Date.now();
      return entry.value;
    }
    return undefined;
  }

  remove(key: string) {
    delete this.map[key];
  }

  toJSON() {
    return this.map;
  }

  private getOldestKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTimestamp: number | undefined;

    for (const key in this.map) {
      if (Object.prototype.hasOwnProperty.call(this.map, key)) {
        const entry = this.map[key];
        if (!oldestTimestamp || entry.la < oldestTimestamp) {
          oldestKey = key;
          oldestTimestamp = entry.la;
        }
      }
    }

    return oldestKey;
  }
}
