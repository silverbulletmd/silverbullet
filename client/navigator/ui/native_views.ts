import type { FunctionComponent } from "preact";
import type { Client } from "../../client.ts";

/**
 * Registers the element a native body wants focused when its panel takes
 * focus. Returns the unregister, which leaves a target registered since in place.
 */
export type FocusTarget = (el: HTMLElement) => () => void;

export type NativeViewProps = {
  client: Client;
  slot: string;
  /** The active segment, for views that use segments as tabs. */
  segmentIndex: number;
  focusTarget: FocusTarget;
};

/**
 * Views whose body is a client component rather than rows or content. The
 * registry is the source of truth: a view with a registered body is native.
 */
const bodies = new Map<string, FunctionComponent<NativeViewProps>>();

export function registerNativeView(
  name: string,
  body: FunctionComponent<NativeViewProps>,
): void {
  bodies.set(name, body);
}

export function nativeBody(
  name: string,
): FunctionComponent<NativeViewProps> | undefined {
  return bodies.get(name);
}

// Per slot: the element a mounted native body wants focused, and a focus
// request made before that body mounted (the element focused in the meantime)
const targets = new Map<string, HTMLElement>();
const pending = new Map<string, Element | null>();

export function setFocusTarget(slot: string, el: HTMLElement): () => void {
  targets.set(slot, el);
  // Take a pending request only if nothing else claimed focus since it was made
  if (pending.has(slot) && document.activeElement === pending.get(slot)) {
    el.focus();
  }
  pending.delete(slot);
  return () => {
    if (targets.get(slot) === el) targets.delete(slot);
  };
}

/** Focuses the slot's native body, or does so once it mounts. */
export function requestNativeFocus(slot: string): boolean {
  const el = targets.get(slot);
  if (el) {
    el.focus();
    return true;
  }
  pending.set(slot, document.activeElement);
  return false;
}
