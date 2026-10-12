import type { EventHook } from "./plugos/hooks/event.ts";

type Held = {
  callbacks: Set<(name: string) => void>;
  holders: number;
  lastFired: number;
  listener: () => void;
};

/**
 * The event names something currently depends on. A name has one hook
 * listener while held and none after its last release, so per-page, per-tag
 * and per-file names never accumulate.
 */
export class EventInterest {
  private held = new Map<string, Held>();
  private sequence = 0;

  constructor(private readonly hook: EventHook) {}

  get size(): number {
    return this.held.size;
  }

  seq(): number {
    return this.sequence;
  }

  /** Holds `names` (calling `onFire` on each) until the returned release. */
  listen(names: Iterable<string>, onFire?: (name: string) => void): () => void {
    const taken = [...new Set(names)];
    for (const name of taken) {
      let h = this.held.get(name);
      if (!h) {
        const entry: Held = {
          callbacks: new Set(),
          holders: 0,
          lastFired: -1,
          listener: () => {
            entry.lastFired = ++this.sequence;
            for (const cb of [...entry.callbacks]) {
              if (entry.callbacks.has(cb)) cb(name);
            }
          },
        };
        h = entry;
        this.held.set(name, h);
        this.hook.addLocalListener(name, h.listener);
      }
      h.holders++;
      if (onFire) h.callbacks.add(onFire);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const name of taken) {
        const h = this.held.get(name);
        if (!h) continue;
        if (onFire) h.callbacks.delete(onFire);
        if (--h.holders > 0) continue;
        this.hook.removeLocalListener(name, h.listener);
        this.held.delete(name);
      }
    };
  }

  /** Whether any held name in `names` fired after `seq` was taken. */
  firedSince(seq: number, names: Iterable<string>): boolean {
    for (const name of names) {
      if ((this.held.get(name)?.lastFired ?? -1) > seq) return true;
    }
    return false;
  }
}
