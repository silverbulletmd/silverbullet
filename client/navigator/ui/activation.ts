import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { datastore } from "@silverbulletmd/silverbullet/syscalls";
import { defaultSegmentIndex, segmentIndexFor } from "./segments.ts";
import {
  type ActivationData,
  type ActiveView,
  ctxKey,
  engine,
  type EventRefs,
  listenForRefresh,
  type PanelSetters,
} from "./panel.ts";
import { expansionKey } from "./expansion.ts";
import { withExpanded } from "../../../plug-api/ui/tree_model.ts";

export type ActivationDeps = {
  slot: string;
  refs: EventRefs;
  set: PanelSetters;
  publish: () => void;
  syncReadOnly: () => Promise<void>;
  applyReveal: (name: string, active?: ActiveView) => void;
  focusInput: (select: boolean) => void;
  // Called when a paint effect won't fire to signal readiness itself — a reopen of the already-displayed view, or a dropped/superseded activation — since both show already-settled content.
  signalReady: (token: number) => void;
};

export function createActivate(deps: ActivationDeps) {
  const {
    slot,
    refs,
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
    stale: staleRef,
    hidden: hiddenRef,
    pendingReveal,
    revealedFor,
    revealedPage,
    view: viewRef,
    phrase: phraseRef,
    interaction,
    returnTo,
    segmentDirty,
    expandedDirty,
    lastQueried,
  } = refs;
  const {
    setView,
    setBootError,
    setPhrase,
    setSegmentIndex,
    setSelectedIndex,
    setSelectedPath,
    setExpanded,
  } = set;

  function refreshOnOpen(wanted: boolean | undefined) {
    if (!wanted) return;
    void engine
      .refresh()
      .then(publish)
      .catch((e) => console.error("navigator: reopen refresh failed", e));
  }

  return async ({
    slot: target,
    view: name,
    token,
    passive,
    phrase: carried,
    from,
    segment: wantedSegment,
  }: ActivationData) => {
    if (target !== slot) return;
    void syncReadOnly();
    // Tokens are monotonic but invocations aren't serialized, so this is a freshness check (<=), not equality — an older activation landing after a newer one must still be dropped.
    if (typeof token !== "number") {
      console.warn("navigator: activation without a token, ignoring", name);
      return;
    }
    if (handledToken.current !== undefined && token <= handledToken.current) {
      // editor.showPanel already gated the panel on this token before this event arrived, so it must be lifted directly here — nothing else will produce a fresh render to do it.
      signalReady(token);
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
      // No panel:hidden fires when a pick loses the slot to a new activation (the iframe stays visible) — this is the only place that supersede is caught.
      if (displayed.current) engine.dropIfEphemeral(displayed.current);
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
        revealedPage.current = undefined;
        staleRef.current = false;
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
        if (cached && !passive) refreshOnOpen(state.meta.refreshOnOpen);
      } catch (e: any) {
        if (displayed.current !== name) return;
        displayed.current = undefined;
        setBootError(e?.message ?? String(e));
      }
    } else if (!passive) {
      // No pending render for NavRoot's paint-timed effect to catch here (view/bootError won't change), so signal directly rather than relying on the 800ms fallback.
      signalReady(token);
      refreshOnOpen(engine.activeState()?.meta.refreshOnOpen);
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
    hiddenRef.current = false;
    interaction.current = "typing";
    if (passive) return;
    if (carried !== undefined) {
      setPhrase(carried);
      setSelectedIndex(0);
      setSelectedPath(undefined);
    } else if (isModal) {
      setPhrase("");
      setSelectedIndex(0);
      // A reveal may already be queued or have just landed (shown won the race) — only reset the selection when neither is true, or this would clobber it.
      if (pendingReveal.current === undefined && revealedFor.current !== name) {
        setSelectedPath(undefined);
      }
    }
    focusInput(
      carried === undefined && (isModal || phraseRef.current.trim() !== ""),
    );
    if (
      !isModal &&
      carried === undefined &&
      !phraseRef.current.trim() &&
      active?.meta.followEditor
    ) {
      const current: string = await syscall("editor.getCurrentPage");
      // A newer activation started while we awaited: it owns the view.
      if (displayed.current !== name) return;
      applyReveal(current, active);
    }
  };
}
