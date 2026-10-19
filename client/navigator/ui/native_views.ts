import type { FunctionComponent } from "preact";
import type { Client } from "../../client.ts";
import { useEffect, useState } from "preact/hooks";
import { panelView } from "../registry.ts";
import { PanelViewBody } from "./components/panel_view_body.tsx";

/**
 * Registers the element a native body wants focused when its panel takes
 * focus. Returns the unregister, which leaves a target registered since in place.
 */
export type FocusTarget = (el: HTMLElement) => () => void;

export type NativeViewProps = {
  client: Client;
  /** The view's name */
  view: string;
  slot: string;
  /** The page or document open in the editor */
  page: string;
  /** The active segment, for views that use segments as tabs. */
  segmentIndex: number;
  focusTarget: FocusTarget;
};

/**
 * Views whose body is a client component rather than rows or content: the
 * ones registered here, and every panel view a plug declares (the registry
 * keeps those). A view with a body is native.
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
  return bodies.get(name) ?? (panelView(name) ? PanelViewBody : undefined);
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

// Per view: badges a native body shows on its tabs, keyed by segment label
const badges = new Map<string, Record<string, string>>();
const badgeListeners = new Set<() => void>();

export function setNativeBadge(
  view: string,
  segment: string,
  badge: string | undefined,
): void {
  const current = badges.get(view) ?? {};
  if (current[segment] === badge) return;
  const { [segment]: _, ...rest } = current;
  badges.set(view, badge === undefined ? rest : { ...rest, [segment]: badge });
  for (const listener of badgeListeners) listener();
}

export function useNativeBadges(view: string): Record<string, string> {
  const [value, setValue] = useState(() => badges.get(view) ?? NO_BADGES);
  useEffect(() => {
    const listener = () => setValue(badges.get(view) ?? NO_BADGES);
    badgeListeners.add(listener);
    listener();
    return () => {
      badgeListeners.delete(listener);
    };
  }, [view]);
  return value;
}

const NO_BADGES: Record<string, string> = {};
