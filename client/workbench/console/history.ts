export type HistoryStore = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
};

function defaultStore(): HistoryStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Accessing localStorage throws in some sandboxed contexts
    return null;
  }
}

// The `silverbullet.` prefix makes logout cleanup remove it
export function historyKey(baseURI: string): string {
  return `silverbullet.workbench.history:${baseURI}`;
}

// Client encryption promises nothing readable at rest, so history stays in memory
export function historyStore(
  encrypted: boolean,
  store: HistoryStore | null = defaultStore(),
): HistoryStore | null {
  return encrypted ? null : store;
}

export class InputHistory {
  private items: string[] = [];
  private cursor = -1;
  private draft = "";

  constructor(
    private key: string,
    private store: HistoryStore | null = defaultStore(),
    private cap = 100,
  ) {
    try {
      const raw = store?.getItem(key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed.filter((s): s is string => typeof s === "string");
        }
      }
    } catch {
      this.items = [];
    }
  }

  push(code: string) {
    this.cursor = -1;
    if (!code.trim() || this.items.at(-1) === code) return;
    this.items.push(code);
    if (this.items.length > this.cap) {
      this.items.splice(0, this.items.length - this.cap);
    }
    try {
      this.store?.setItem(this.key, JSON.stringify(this.items));
    } catch {
      // Storage can be unavailable (private mode); history then lasts for this session only
    }
  }

  prev(current: string): string | null {
    if (this.cursor === -1) {
      if (!this.items.length) return null;
      this.draft = current;
      this.cursor = this.items.length - 1;
      return this.items[this.cursor];
    }
    if (this.cursor === 0) return null;
    return this.items[--this.cursor];
  }

  next(): string | null {
    if (this.cursor === -1) return null;
    if (this.cursor === this.items.length - 1) {
      this.cursor = -1;
      return this.draft;
    }
    return this.items[++this.cursor];
  }
}
