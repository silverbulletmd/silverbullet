export const QUARANTINE_KEY = "spaceLuaQuarantine";

export type QuarantineStore = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
};

function defaultStore(): QuarantineStore {
  return localStorage;
}

/**
 * Space Manager can host multiple spaces on the same origin, sharing
 * localStorage. Namespace by document.baseURI the same way boot.ts's
 * cachedFetch does (and client.ts's deriveDbName), so one space's
 * quarantine entries never collide with or get pruned by another's.
 */
export function quarantineStorageKey(): string {
  const namespace = typeof document !== "undefined" ? document.baseURI : "";
  return `silverbullet.${namespace}.${QUARANTINE_KEY}`;
}

export function hashScript(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function read(store: QuarantineStore): Record<string, string> {
  let raw: string | null;
  try {
    raw = store.getItem(quarantineStorageKey());
  } catch {
    return {};
  }
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function write(store: QuarantineStore, v: Record<string, string>): void {
  try {
    store.setItem(quarantineStorageKey(), JSON.stringify(v));
  } catch {
    // Quarantine is a convenience: a store that refuses to persist must never
    // prevent scripts from loading.
  }
}

export function isQuarantined(
  ref: string,
  source: string,
  store: QuarantineStore = defaultStore(),
): boolean {
  const entries = read(store);
  const stored = entries[ref];
  if (stored === undefined) {
    return false;
  }
  if (stored === hashScript(source)) {
    return true;
  }
  delete entries[ref];
  write(store, entries);
  return false;
}

export function quarantine(
  ref: string,
  source: string,
  store: QuarantineStore = defaultStore(),
): void {
  const entries = read(store);
  entries[ref] = hashScript(source);
  write(store, entries);
}

export function unquarantine(
  ref: string,
  store: QuarantineStore = defaultStore(),
): void {
  const entries = read(store);
  delete entries[ref];
  write(store, entries);
}

export function listQuarantined(
  store: QuarantineStore = defaultStore(),
): string[] {
  return Object.keys(read(store));
}

/**
 * Drops quarantine entries whose ref no longer appears among the live
 * scripts. A ref changes whenever the script it belongs to moves (e.g. an
 * edit shifts its page@charOffset), so the hash-mismatch self-heal in
 * isQuarantined never revisits the old ref to prune it. Call this with the
 * full live ref list before quarantine state is read for display.
 */
export function reconcileQuarantine(
  liveRefs: string[],
  store: QuarantineStore = defaultStore(),
): void {
  const entries = read(store);
  const live = new Set(liveRefs);
  let changed = false;
  for (const ref of Object.keys(entries)) {
    if (!live.has(ref)) {
      delete entries[ref];
      changed = true;
    }
  }
  if (changed) {
    write(store, entries);
  }
}
