import { useEffect, useState } from "preact/hooks";

let holds = 0;

/**
 * Freezes every tracker on the row it is over until the returned release
 * runs. A row's open menu sits outside its list (see `RowMenu`), so the
 * pointer on its way there crosses other rows, or leaves the list, and the
 * row (and the menu with it) must not be unmounted for that.
 */
export function holdHover(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

/**
 * Tracks hover outside parent state. Individual subscriptions re-render only
 * the two affected rows instead of the entire expanded list.
 */
export class HoverTracker {
  private key: unknown = undefined;
  private subscribers = new Set<(key: unknown) => void>();
  /** Where the pointer was last seen -- see `resolveHover`. */
  private x = -1;
  private y = -1;

  get(): unknown {
    return this.key;
  }

  set(key: unknown): void {
    if (this.key === key || holds > 0) return;
    this.key = key;
    for (const notify of this.subscribers) notify(key);
  }

  /**
   * A pointer event over the row container: remembers where, and over what.
   * Any `MouseEvent` will do -- a drop is the other event that moves the
   * pointer somewhere the tracker has to hear about (see `onDrop`), and its
   * coordinates are the last ones a drag leaves behind.
   */
  track(event: MouseEvent, rowAt: (node: Element | null) => unknown): void {
    this.x = event.clientX;
    this.y = event.clientY;
    this.set(rowAt(event.target as Element | null));
  }

  elementUnderPointer(): Element | null {
    if (this.x < 0 && this.y < 0) return null;
    return document.elementFromPoint(this.x, this.y);
  }

  subscribe(notify: (key: unknown) => void): () => void {
    this.subscribers.add(notify);
    return () => {
      this.subscribers.delete(notify);
    };
  }
}

/**
 * Re-answers "what is the pointer over" without the pointer having moved --
 * after a refresh replaced the rows, or after the keyboard scrolled different
 * ones underneath it. Identity, never position: the row that was under the
 * pointer may be gone, and the one now in its slot was never pointed at.
 */
export function resolveHover(
  tracker: HoverTracker,
  rowAt: (node: Element | null) => unknown,
): void {
  tracker.set(rowAt(tracker.elementUnderPointer()));
}

export function useHovered(tracker: HoverTracker, key: unknown): boolean {
  const [hovered, setHovered] = useState(() => tracker.get() === key);
  useEffect(() => {
    setHovered(tracker.get() === key);
    return tracker.subscribe((current) => setHovered(current === key));
  }, [tracker, key]);
  return hovered;
}
