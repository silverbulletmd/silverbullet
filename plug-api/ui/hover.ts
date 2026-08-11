import { useEffect, useState } from "preact/hooks";

/**
 * Which row the pointer is over, deliberately kept out of the render tree.
 *
 * Mounting a row's actions on demand means hover changes what is rendered --
 * but holding that in a parent's state would re-render every row it draws on
 * every row-to-row pointer transition, and an expanded list can be thousands
 * of rows. Rows subscribe individually instead, so a transition re-renders the
 * two rows whose answer actually changed.
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
    if (this.key === key) return;
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

/** Whether the pointer is over this row. */
export function useHovered(tracker: HoverTracker, key: unknown): boolean {
  const [hovered, setHovered] = useState(() => tracker.get() === key);
  useEffect(() => {
    setHovered(tracker.get() === key);
    return tracker.subscribe((current) => setHovered(current === key));
  }, [tracker, key]);
  return hovered;
}
