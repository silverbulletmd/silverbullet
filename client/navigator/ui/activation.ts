import { datastore, editor } from "@silverbulletmd/silverbullet/syscalls";
import { withExpanded } from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import { expansionKey } from "./expansion.ts";
import {
  type ActiveView,
  ctxKey,
  type EventRefs,
  type PanelSetters,
} from "./panel.ts";
import { defaultSegmentIndex, segmentIndexFor } from "./segments.ts";
import type { NavActivation } from "./slots.ts";

export type ActivationDeps = {
  slot: string;
  engine: NavigatorEngine;
  refs: EventRefs;
  /** Subscribes this panel to a view's own `refreshOn` events. */
  listenForRefresh: (names: string[]) => void;
  set: PanelSetters;
  publish: () => void;
  syncReadOnly: () => Promise<void>;
  applyReveal: (name: string, active?: ActiveView) => void;
  focusInput: (select: boolean) => void;
  // Called when a paint effect won't fire to signal readiness itself — a reopen of the already-displayed view, which shows already-settled content.
  signalReady: (token: number) => void;
};

export function createActivate(deps: ActivationDeps) {
  const {
    slot,
    engine,
    refs,
    listenForRefresh,
    set,
    publish,
    syncReadOnly,
    applyReveal,
    focusInput,
    signalReady,
  } = deps;
  const {
    displayed,
    handledToken,
    segmentForced,
    revealedFor,
    revealedPage,
    view: viewRef,
    phrase: phraseRef,
    interaction,
    returnTo,
    segmentDirty,
    dropdownDirty,
    dropdownForced,
    expandedDirty,
    lastQueried,
  } = refs;
  const {
    setView,
    setBootError,
    setPhrase,
    setSegmentIndex,
    setDropdownValue,
    setSelectedIndex,
    setSelectedPath,
    setExpanded,
  } = set;

  function refreshOnce() {
    void engine
      .refresh()
      .then(publish)
      .catch((e) => console.error("navigator: reopen refresh failed", e));
  }

  return async ({
    view: name,
    token,
    passive,
    phrase: carried,
    from,
    segment: wantedSegment,
    dropdown: wantedDropdown,
    focus,
  }: NavActivation) => {
    void syncReadOnly();
    if (typeof token !== "number") {
      console.warn("navigator: activation without a token, ignoring", name);
      return;
    }
    handledToken.current = token;
    returnTo.current = from;
    // This await between claiming the token and claiming displayed is the one place a newer open could overtake us — re-check handledToken after it or our tail could clobber that newer activation.
    if (displayed.current === name) {
      const redefined = await engine.dropIfRedefined(name);
      if (handledToken.current !== token) return;
      if (redefined) displayed.current = undefined;
    }
    if (displayed.current !== name) {
      // A pick that loses the slot to a new activation is never unmounted (the panel stays up, showing the newcomer) — this is the only place that supersede is caught.
      if (displayed.current) engine.dropIfEphemeral(displayed.current);
      // Nothing displayed yet means this panel has just mounted -- see the
      // cached-rows refresh below.
      const remounted = displayed.current === undefined;
      displayed.current = name;
      // Read before the await: activate() below is what fills the cache, so isLoaded must be captured before calling it.
      const cached = engine.isLoaded(name);
      try {
        const state = await engine.activate(name);
        // A newer activation started while we were awaiting: it owns the view
        if (displayed.current !== name) return;
        listenForRefresh(state.meta.refreshOn ?? []);
        setBootError(undefined);
        setView({ name, ...state });
        setExpanded(new Set());
        expandedDirty.current = false;
        // Marks segmentDirty so the remembered-segment read below drops its answer rather than racing this.
        const requested =
          wantedSegment === undefined
            ? -1
            : segmentIndexFor(state.meta.segments, wantedSegment);
        setSegmentIndex(
          requested >= 0 ? requested : defaultSegmentIndex(state.meta.segments),
        );
        segmentDirty.current = requested >= 0;
        segmentForced.current = requested >= 0;
        // The load above already answered this ctx, so the source-mode effect must not immediately re-ask for it.
        lastQueried.current = ctxKey(state.ctx);
        if (state.meta.segments && !state.meta.ephemeral) {
          // Fire-and-forget with the same staleness guard as the expansion load below — a segment picked while this is in flight wins.
          void datastore.get(["navigator", name, "segment"]).then((saved) => {
            if (displayed.current !== name || segmentDirty.current) return;
            const index = segmentIndexFor(state.meta.segments, saved);
            if (index >= 0) setSegmentIndex(index);
          });
        }
        setDropdownValue(undefined);
        dropdownDirty.current = false;
        // A carried dropdown value is applied in the shared tail below;
        // dropdownDirty is what keeps this remembered-value read from
        // landing on top of it.
        if (
          wantedDropdown === undefined &&
          state.meta.dropdown &&
          !state.meta.ephemeral
        ) {
          // Same guard again -- and a remembered value the freshly loaded
          // options no longer carry stays on the built-in "All".
          void datastore.get(["navigator", name, "dropdown"]).then((saved) => {
            if (displayed.current !== name || dropdownDirty.current) return;
            if (saved === undefined || saved === null) return;
            if (state.dropdownOptions?.some((o) => o.value === saved)) {
              setDropdownValue(saved);
            }
          });
        }
        revealedPage.current = undefined;
        const key =
          state.meta.mode === "tree"
            ? expansionKey(name, state.meta)
            : undefined;
        if (key) {
          // Fire-and-forget: gating the reset on this round trip would open a window where a fast filter keystroke lands before it and gets wiped.
          void datastore.get(key).then((saved) => {
            // Guards against a newer activation or a manual toggle that happened while this load was in flight — landing this stale snapshot would silently reopen a folder the user just closed.
            if (displayed.current !== name || expandedDirty.current) return;
            // Merged, not replaced: this also races applyReveal's own ancestor-expansion with no fixed order between the two, and a union converges the same way regardless of which arrives first.
            const paths = Array.isArray(saved) ? (saved as string[]) : [];
            setExpanded((prev) =>
              withExpanded(prev, paths, state.meta.expandAll === true),
            );
          });
        }
        // A remount showing cached rows: this panel wasn't there to hear
        // whatever changed while it was closed, so the source runs once, in
        // place, under what's already on screen. A panel that stayed up did
        // hear it, so a hop into a view it has cached re-runs the source only
        // if the view asked for that.
        if (cached && !passive && (remounted || state.meta.refreshOnOpen)) {
          refreshOnce();
        }
      } catch (e: any) {
        if (displayed.current !== name) return;
        displayed.current = undefined;
        setBootError(e?.message ?? String(e));
      }
    } else if (!passive) {
      // No pending render for NavRoot's paint-timed effect to catch here (view/bootError won't change), so signal directly rather than relying on the 800ms fallback.
      signalReady(token);
      if (engine.activeState()?.meta.refreshOnOpen) refreshOnce();
    }
    const state = engine.activeState();
    const active: ActiveView | undefined =
      viewRef.current?.name === name
        ? viewRef.current
        : state?.meta.name === name
          ? { name, ...state }
          : undefined;
    const isModal = slot === "modal";
    // segmentDirty here is what keeps the remembered-segment read (already dispatched) from landing on top of this once it settles.
    if (wantedSegment !== undefined) {
      const index = segmentIndexFor(active?.meta.segments, wantedSegment);
      if (index >= 0) {
        segmentDirty.current = true;
        segmentForced.current = true;
        setSegmentIndex(index);
      }
    } else if (
      segmentForced.current &&
      active?.meta.segments &&
      !active.meta.ephemeral
    ) {
      segmentForced.current = false;
      segmentDirty.current = false;
      const fallback = defaultSegmentIndex(active.meta.segments);
      setSegmentIndex(fallback);
      void datastore.get(["navigator", name, "segment"]).then((saved) => {
        if (displayed.current !== name || segmentDirty.current) return;
        const index = segmentIndexFor(active.meta.segments, saved);
        if (index >= 0) setSegmentIndex(index);
      });
    }
    // A carried dropdown value overrides the remembered one for this one
    // activation only -- never persisted, so the next open that doesn't
    // carry one goes back to the remembered (hand-picked) selection or All
    // (the `dropdownForced` reset below). Applied whether or not the value
    // is among the loaded options yet: an absent value filters as "All"
    // until a refresh brings its option in.
    if (wantedDropdown !== undefined && active?.meta.dropdown) {
      dropdownDirty.current = true;
      dropdownForced.current = true;
      setDropdownValue(wantedDropdown);
    } else if (
      dropdownForced.current &&
      active?.meta.dropdown &&
      !active.meta.ephemeral
    ) {
      dropdownForced.current = false;
      dropdownDirty.current = false;
      setDropdownValue(undefined);
      void datastore.get(["navigator", name, "dropdown"]).then((saved) => {
        if (displayed.current !== name || dropdownDirty.current) return;
        if (saved === undefined || saved === null) return;
        if (active.dropdownOptions?.some((o) => o.value === saved)) {
          setDropdownValue(saved);
        }
      });
    }
    interaction.current = "typing";
    if (passive) return;
    if (carried !== undefined) {
      setPhrase(carried);
      setSelectedIndex(0);
      setSelectedPath(undefined);
    } else if (isModal) {
      setPhrase("");
      setSelectedIndex(0);
      // A reveal may already have landed for this view -- resetting the selection would clobber it.
      if (revealedFor.current !== name) setSelectedPath(undefined);
    }
    // `focus = false` skips only the focus grab: everything else about a
    // user-asked open (refresh, phrase/selection reset) happened above.
    if (focus !== false) {
      focusInput(
        carried === undefined && (isModal || phraseRef.current.trim() !== ""),
      );
    }
    if (
      !isModal &&
      carried === undefined &&
      !phraseRef.current.trim() &&
      active?.meta.followEditor
    ) {
      const current = await editor.getCurrentPage();
      // A newer activation started while we awaited: it owns the view.
      if (displayed.current !== name) return;
      applyReveal(current, active);
    }
  };
}
