import type { RefObject } from "preact";
import type { Dispatch, MutableRef, StateUpdater } from "preact/hooks";
import { NavigatorEngine, type ViewState } from "./engine.ts";
import type { SourceCtx } from "./types.ts";

declare const sbEvent: {
  on(name: string, cb: (...args: any[]) => void): void;
};

/** The payload one `navigator:activate` carries. */
export type ActivationData = {
  slot: string;
  view: string;
  token?: number;
  passive?: boolean;
  /** The phrase to arrive with (minus the prefix, for a prefix hop). */
  phrase?: string;
  /** Prefix routing: the view Backspace-on-empty steps back to. */
  from?: string;
  /** Segment label to activate, overriding the remembered one. */
  segment?: string;
};

export type NavHooks = {
  activate?: (data: ActivationData) => void;
  shown?: () => void;
  /**
   * @returns the view (and its activation token) this iframe believed was
   * displayed at the moment of the hide -- forwarded to the worker so a
   * close that arrives late can be told apart from the slot's current
   * occupant. See `use_panel_events.ts`'s `onHidden`.
   */
  hidden?: () => { view?: string; token?: number } | undefined;
  refresh?: () => void;
  pageLoaded?: (pageRef: unknown) => void;
  /** `editor:pageReloaded` -- how a forced read-only toggle reaches us. */
  pageReloaded?: () => void;
  /** The host crossed its mobile breakpoint -- see `sbMobile`. */
  mobile?: (mobile: boolean) => void;
};

// The host re-posts the panel HTML (and re-evals this bundle) whenever the
// panel config changes, which wipes the body and gives us a fresh module
// scope. Anything an already-registered `sbEvent` listener closes over has to
// survive that, so the singletons hang off globalThis rather than the module.
const globals = globalThis as unknown as {
  __navigatorHooks?: NavHooks;
  __navigatorEngine?: NavigatorEngine;
  __navigatorRefreshEvents?: Set<string>;
};

/**
 * Handler slots the panel-level `sbEvent` subscriptions (registered in
 * index.tsx while the bundle is still being eval'd) forward into. Subscribing
 * from inside the component would race the first forwarded event, and
 * `sbEvent` has no unsubscribe.
 */
export const navHooks: NavHooks = (globals.__navigatorHooks ??= {});

export const engine = (globals.__navigatorEngine ??= new NavigatorEngine());
const refreshEvents = (globals.__navigatorRefreshEvents ??= new Set<string>());

export function listenForRefresh(names: string[]) {
  for (const name of names) {
    if (refreshEvents.has(name)) continue;
    refreshEvents.add(name);
    sbEvent.on(name, () => navHooks.refresh?.());
  }
}

export type ActiveView = ViewState & { name: string };

/** Identity of a source invocation, so the same one is never repeated. */
export function ctxKey(ctx?: SourceCtx): string {
  return `${ctx?.segment ?? ""}\u0000${ctx?.phrase ?? ""}`;
}

/**
 * Panel state that nothing renders from, and that the host-event handlers
 * (see `usePanelEvents`) and the panel's own interactions both reach for.
 * Refs rather than state because a re-render per keystroke is exactly what
 * this panel is built to avoid.
 *
 * Every member has to be identity-stable for the life of the panel: the
 * per-slot effect in `usePanelEvents` captures this bundle once, so a field
 * that is rebuilt per render would freeze at its first value there.
 */
export type SharedRefs = {
  /** Kept current every render, for handlers registered once per slot. */
  view: MutableRef<ActiveView | undefined>;
  /** Same, for the phrase. */
  phrase: MutableRef<string>;
  input: RefObject<HTMLInputElement>;
  /** See `updateInteraction` in keyboard.ts. */
  interaction: MutableRef<"typing" | "navigating">;
  /**
   * Prefix routing: the view this slot was showing before a `prefixViews` hop,
   * i.e. the one Backspace on an empty phrase steps back to. Set from the
   * activation payload, so any ordinary open clears it.
   */
  returnTo: MutableRef<string | undefined>;
  /**
   * Set by a user toggle that lands while a persisted-segment load is still in
   * flight, so that load's `.then` drops its (now stale) snapshot instead of
   * clobbering the interim edit. Reset per activation.
   */
  segmentDirty: MutableRef<boolean>;
  /** Same, for the persisted expansion set. */
  expandedDirty: MutableRef<boolean>;
  /**
   * Source mode: the ctx the rows on screen came from, so the debounced effect
   * doesn't re-run the source for a phrase/segment it already answered.
   */
  lastQueried: MutableRef<string | undefined>;
};

/**
 * The refs only the host-event handlers touch, on top of the ones the whole
 * panel shares. Created by `usePanelEvents`, which owns every one of them.
 */
export type EventRefs = SharedRefs & {
  /** The view whose rows are on screen (or on their way there). */
  displayed: MutableRef<string | undefined>;
  /** Token of the last activation applied -- see `createActivate`. */
  handledToken: MutableRef<number | undefined>;
  /**
   * Set when an `open` named a segment (the meta/document picker commands).
   * That choice belongs to the one open that asked for it, so the next open
   * that doesn't has to put the view back on the segment it remembers.
   */
  segmentForced: MutableRef<boolean>;
  /**
   * Set when a debounced refresh fires while the panel is hidden, instead of
   * querying: the query re-runs once, on the next `panel:shown`, rather than
   * per forwarded event. Without this a hidden preloaded panel would re-run
   * its source once per refreshOn event during a startup indexing storm.
   */
  stale: MutableRef<boolean>;
  /**
   * True while the panel is hidden (sidebar docks only -- see panel:hidden).
   * Gates follow-editor (a hidden panel must not touch tree state) and
   * refresh (see `stale` above).
   */
  hidden: MutableRef<boolean>;
  /** Page name follow-editor wants to reveal once the panel is shown again. */
  pendingReveal: MutableRef<string | undefined>;
  /** View name `applyReveal` last ran for -- see `usePanelEvents`. */
  revealedFor: MutableRef<string | undefined>;
  /** Page `applyReveal` last ran for. */
  revealedPage: MutableRef<string | undefined>;
  /**
   * The activation token last signalled ready for (see `signalReady`) --
   * shared between `createActivate`'s own immediate signals (a reopen or a
   * dropped/stale activation, both of which show already-settled content)
   * and `NavRoot`'s paint-timed one (a fresh load, gated on the render that
   * actually lands the new content), so whichever fires first for a given
   * token is the one that counts.
   */
  readySignaledToken: MutableRef<number | undefined>;
};

/** The state setters the handlers outside the component write through. */
export type PanelSetters = {
  setView: Dispatch<StateUpdater<ActiveView | undefined>>;
  setBootError: Dispatch<StateUpdater<string | undefined>>;
  setPhrase: Dispatch<StateUpdater<string>>;
  setSegmentIndex: Dispatch<StateUpdater<number>>;
  setSelectedIndex: Dispatch<StateUpdater<number>>;
  setSelectedPath: Dispatch<StateUpdater<string | undefined>>;
  setExpanded: Dispatch<StateUpdater<Set<string>>>;
};
