import type { RefObject } from "preact";
import type { Dispatch, MutableRef, StateUpdater } from "preact/hooks";
import type { SourceCtx } from "../types.ts";
import type { ViewState } from "./engine.ts";

export type ActiveView = ViewState & { name: string };

/** Identity of a source invocation, so the same one is never repeated. */
export function ctxKey(ctx?: SourceCtx): string {
  return `${ctx?.segment ?? ""}\u0000${ctx?.phrase ?? ""}`;
}

/**
 * Panel state that nothing renders from, and that the event handlers (see
 * `usePanelEvents`) and the panel's own interactions both reach for. Refs
 * rather than state because a re-render per keystroke is exactly what this
 * panel is built to avoid.
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
  /** Same, for the persisted dropdown value. */
  dropdownDirty: MutableRef<boolean>;
  /** Same, for the persisted expansion set. */
  expandedDirty: MutableRef<boolean>;
  /**
   * Source mode: the ctx the rows on screen came from, so the debounced effect
   * doesn't re-run the source for a phrase/segment it already answered.
   */
  lastQueried: MutableRef<string | undefined>;
  /** The view whose rows are on screen (or on their way there). */
  displayed: MutableRef<string | undefined>;
  /** Token of the last activation applied -- see `createActivate`. */
  handledToken: MutableRef<number | undefined>;
  /**
   * The activation token last signalled ready for (see `signalReady`) --
   * shared between `createActivate`'s immediate signal (a reopen of the
   * already-displayed view, which shows already-settled content) and
   * `NavRoot`'s paint-timed one (a fresh load, gated on the render that
   * actually lands the new content), so whichever fires first for a given
   * token is the one that counts.
   */
  readySignaledToken: MutableRef<number | undefined>;
};

/**
 * The refs only the event handlers touch, on top of the ones the whole panel
 * shares. Created by `usePanelEvents`, which owns every one of them.
 */
export type EventRefs = SharedRefs & {
  /**
   * Set when an `open` named a segment (the meta/document picker commands).
   * That choice belongs to the one open that asked for it, so the next open
   * that doesn't has to put the view back on the segment it remembers.
   */
  segmentForced: MutableRef<boolean>;
  /**
   * Same, for a `dropdown` value carried by an open. That value belongs to
   * the one activation that carried it (never persisted), so the next open
   * without one puts the view back on the remembered selection (or All).
   */
  dropdownForced: MutableRef<boolean>;
  /** View name `applyReveal` last ran for -- see `usePanelEvents`. */
  revealedFor: MutableRef<string | undefined>;
  /** Page `applyReveal` last ran for. */
  revealedPage: MutableRef<string | undefined>;
};

/** The state setters the handlers outside the component write through. */
export type PanelSetters = {
  setView: Dispatch<StateUpdater<ActiveView | undefined>>;
  setBootError: Dispatch<StateUpdater<string | undefined>>;
  setPhrase: Dispatch<StateUpdater<string>>;
  setSegmentIndex: Dispatch<StateUpdater<number>>;
  /** The selected dropdown option's value; undefined is the built-in "All". */
  setDropdownValue: Dispatch<StateUpdater<unknown>>;
  setSelectedIndex: Dispatch<StateUpdater<number>>;
  setSelectedPath: Dispatch<StateUpdater<string | undefined>>;
  setExpanded: Dispatch<StateUpdater<Set<string>>>;
};
