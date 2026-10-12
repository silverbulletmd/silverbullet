import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import { isLocalURL } from "@silverbulletmd/silverbullet/lib/resolve";

/** Told each event a render evaluation's reads depend on. */
export type Tracker = (event: string) => void;

export function tagChangedEvent(tag: string): string {
  return `index:tag:${tag}`;
}

export function fileChangedEvent(path: string): string {
  return `file:changed:${path}`;
}

/** The file event a transclusion of `url` depends on; none for external URLs. */
export function transclusionEvent(url: string): string | undefined {
  if (!isLocalURL(url)) return undefined;
  const path = parseToRef(url)?.path;
  return path ? fileChangedEvent(path) : undefined;
}

/**
 * A tracker that stops reporting once its evaluation settles: closures the
 * render handed out (event handlers, callbacks) run later on the same thread
 * state and must not add triggers or keep the evaluation's sets alive.
 */
export function openTracker(track: Tracker | undefined): {
  track: Tracker | undefined;
  close: () => void;
} {
  if (!track) return { track: undefined, close: () => {} };
  let target: Tracker | undefined = track;
  return {
    track: (event) => target?.(event),
    close: () => {
      target = undefined;
    },
  };
}
