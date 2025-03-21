export class Config {
  constructor(private values: Record<string, any> = {}) {}

  get<T>(key: string, defaultValue: T): T {
    return this.values[key] ?? defaultValue;
  }

  set<T>(key: string, value: T) {
    this.values[key] = value;
  }

  has(key: string): boolean {
    return key in this.values;
  }
}
