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
  /** `select` -- see the tail below, which decides it per activation. */
  focusInput: (select: boolean) => void;
  /**
   * Paint-gated reveal handshake (`editor.panelReady`) for an activation that
   * reaches "the panel is up" *without* going through a state change a render
   * effect would catch -- a reopen of the view already displayed, or a
   * dropped/superseded activation. Both show content that's already settled
   * (this iframe's own DOM, not freshly loaded), so there's nothing to wait
   * for; signalling immediately is correct, not merely expedient. A fresh
   * load's own reveal still goes through the render-timed path (`NavRoot`'s
   * `useLayoutEffect`), which this shares a de-dupe token with.
   */
  signalReady: (token: number) => void;
};

/**
 * The `navigator:activate` handler: one `open()` landing in this slot, from
 * the plug's push or from the boot handshake's pull. Built once per slot by
 * `usePanelEvents`, and closing over nothing but refs and stable setters.
 */
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

  /**
   * A view being asked for whose rows are already held. For one whose rows are
   * a fact about *now* -- recency ordering, the palette's cursor context, the
   * outline of the page you are on -- what it holds is the answer to an older
   * question, so ask again. It applies whether or not this slot happens to be
   * the one that view was last shown in: a picker opened after a detour
   * through another view is no less a fresh ask than one opened twice in a
   * row. Not awaited -- the panel is up and focused either way, and the rows
   * arrive a round trip later.
   */
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
    // One `open()` reaches us twice -- once pushed, once pulled by the boot
    // handshake -- and their order isn't fixed. Replaying the tail below
    // would clear a phrase the user has already started typing into a panel
    // that is, as far as they can tell, fully open.
    //
    // Tokens are monotonic per `open()`, and plug invocations aren't
    // serialized, so this is a *freshness* test rather than an equality
    // one: two rapid opens can land out of order, and an older activation
    // arriving after a newer one has been applied must be dropped too.
    if (typeof token !== "number") {
      console.warn("navigator: activation without a token, ignoring", name);
      return;
    }
    if (handledToken.current !== undefined && token <= handledToken.current) {
      // Dropped, but `editor.showPanel` (navigator.ts's `show`) already ran
      // for this exact token and gated the panel on it before this event
      // even arrived -- nothing here will ever produce a fresh render to lift
      // that gate for it, so it has to be lifted directly, on whatever this
      // iframe is already showing (a stale-but-real reindex/reload case, see
      // `viewMeta`'s fallback comment; the old, pre-paint-gated behavior was
      // exactly this -- reveal immediately, stale content and all).
      signalReady(token);
      return;
    }
    handledToken.current = token;
    // Only a `prefixViews` hop carries a `from`, so an ordinary open (which
    // has none) is also what forgets the way back.
    returnTo.current = from;
    // A built-in this panel has already shown may have been replaced by the
    // space's own Lua since -- which, before the first index completes, is
    // what is *expected* to happen. Re-load it from scratch when it has.
    // Gated on a synchronous check so only a cached built-in pays the round
    // trip, and re-guarded after it: this is the one await between claiming
    // the token and claiming `displayed`, so without the re-check a newer
    // open could overtake us here and then be clobbered by our tail.
    if (engine.isBuiltin(name)) {
      const superseded = await engine.dropIfSuperseded(name);
      if (handledToken.current !== token) return;
      if (superseded) displayed.current = undefined;
    }
    if (displayed.current !== name) {
      // A pick losing the slot to whatever is activating now -- no `panel:
      // hidden` fires for this (the iframe stays visible, just showing
      // something else), so this is the only place a supersede is caught.
      if (displayed.current) engine.dropIfEphemeral(displayed.current);
      displayed.current = name;
      // Whether `activate` below will load rows or hand back the ones it
      // already holds -- which is what decides whether `refreshOnOpen` has
      // anything to do. Read before the await, since `activate` is what fills
      // the cache in.
      const cached = engine.isLoaded(name);
      try {
        const state = await engine.activate(name);
        // A newer activation started while we were awaiting: it owns the view
        if (displayed.current !== name) return;
        // `editor:pageLoaded` is deliberately not a refresh trigger: it
        // would re-run every view's source on every navigation. It's still
        // forwarded (see index.tsx) for the followEditor reveal path below.
        listenForRefresh(state.meta.refreshOn ?? []);
        setBootError(undefined);
        setView({ name, ...state });
        setExpanded(new Set());
        expandedDirty.current = false;
        // An `open` that named a segment decides the initial one outright,
        // ahead of both the view's default and the remembered one -- and
        // marks the state dirty so the remembered-segment read below drops
        // its answer rather than racing this.
        const requested =
          wantedSegment === undefined
            ? -1
            : segmentIndexFor(state.meta.segments, wantedSegment);
        setSegmentIndex(
          requested >= 0 ? requested : defaultSegmentIndex(state.meta.segments),
        );
        segmentDirty.current = requested >= 0;
        segmentForced.current = requested >= 0;
        // The load above already answered this ctx; the source-mode effect
        // must not immediately ask again for the same thing.
        lastQueried.current = ctxKey(state.ctx);
        if (state.meta.segments && !state.meta.ephemeral) {
          // Fire-and-forget with the same staleness guards as the expansion
          // load below: a segment picked while this was in flight wins.
          // Skipped for a `navigator.pick` view: nothing ever writes this key
          // for one (see `commands.ts`'s `pickSegment`), so the read would
          // only ever answer `undefined` -- a wasted round trip.
          void datastore.get(["navigator", name, "segment"]).then((saved) => {
            if (displayed.current !== name || segmentDirty.current) return;
            const index = segmentIndexFor(state.meta.segments, saved);
            if (index >= 0) setSegmentIndex(index);
          });
        }
        // A different dataset: whatever page was revealed in the previous
        // view says nothing about whether this one still needs revealing.
        revealedPage.current = undefined;
        // A stale flag belongs to whichever view set it, and this is a
        // different one: its rows were either just loaded, or are the ones it
        // was left with (plus a `refreshOnOpen` below, where it asks for one).
        staleRef.current = false;
        const key =
          state.meta.mode === "tree"
            ? expansionKey(name, state.meta)
            : undefined;
        if (key) {
          // Fire-and-forget: gating the reset below on this round-trip would
          // open a window, after the tree is already visible, where a fast
          // filter keystroke lands before the reset fires and gets wiped.
          void datastore.get(key).then((saved) => {
            // A newer activation owns the view now, or the user already
            // manually toggled a folder while this load was in flight --
            // either way this snapshot must not land: the newer activation's
            // folders aren't this one's, and the toggle's own write already
            // went through the datastore, so re-merging an *older* read of
            // it back in would silently put a folder the user just closed
            // back open.
            if (displayed.current !== name || expandedDirty.current) return;
            // Merged in, not replaced wholesale: this fetch also races
            // `applyReveal`'s own ancestor-expansion, with no fixed order
            // between the two. A plain replace lands on whichever wins --
            // either dropping the reveal's ancestors (this snapshot arrives
            // second) or discarding the user's remembered folders outright
            // (it arrives first, and nothing here would know to add the
            // reveal's ancestors back). A union converges the same way
            // regardless of order, so it doesn't matter which arrives first.
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
      // A reopen of the view this iframe already displays: its rows are
      // already rendered (or, hidden, already correct underneath), so unlike
      // a fresh load there is no pending render for `NavRoot`'s paint-timed
      // effect to catch -- that effect's dependencies (`view`/`bootError`)
      // simply won't change. Signal directly instead of leaving this to the
      // 800ms fallback (`refreshOnOpen` below, when it applies, doesn't
      // resolve fast enough to count on either -- it's a real query round
      // trip, not a paint tick).
      signalReady(token);
      refreshOnOpen(engine.activeState()?.meta.refreshOnOpen);
    }
    // Reaching here traces back to an `open()`, whether it's a fresh view or
    // a repeat of the one already displayed -- so taking focus is warranted
    // for both docks, unless it's the boot restore below.
    const state = engine.activeState();
    const active: ActiveView | undefined =
      viewRef.current?.name === name
        ? viewRef.current
        : state?.meta.name === name
          ? { name, ...state }
          : undefined;
    const isModal = slot === "modal";
    // An `open` that names a segment overrides both the view's default and
    // the segment it remembers -- that is all "Navigate: Meta Picker" is.
    // Deliberately not written back: opening the meta picker once must not
    // turn the plain page picker into a meta picker for good. Setting
    // `segmentDirty` is what keeps the remembered segment from landing on
    // top of it when its (already dispatched) read settles.
    if (wantedSegment !== undefined) {
      const index = segmentIndexFor(active?.meta.segments, wantedSegment);
      if (index >= 0) {
        segmentDirty.current = true;
        segmentForced.current = true;
        setSegmentIndex(index);
      }
    } else if (
      segmentForced.current && active?.meta.segments && !active.meta.ephemeral
    ) {
      // A plain open after one that named a segment: back to the segment
      // this view actually remembers, not the one a command borrowed it for.
      // (Unreachable for a pick in practice -- `wantedSegment` is never set
      // opening one, so `segmentForced.current` is already false by the time
      // this branch is reached -- but gated the same way for symmetry with
      // the read above, rather than relying on that being the only reason.)
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
    // A fresh command open starts in typing mode: the safe default is that
    // characters reach the filter, never that they run an action.
    interaction.current = "typing";
    // A boot restore isn't an ask: the dock is back where the user left it,
    // and that's all. Taking the editor's focus, or revealing the current
    // page, would both be this panel interrupting a page load nobody
    // connected it to.
    if (passive) return;
    if (carried !== undefined) {
      // A prefix hop: the phrase the user was already typing carries over
      // (minus the prefix), in either dock, and is not selected -- the next
      // keystroke has to extend it, not replace it.
      setPhrase(carried);
      setSelectedIndex(0);
      setSelectedPath(undefined);
    } else if (isModal) {
      setPhrase("");
      setSelectedIndex(0);
      // A reveal for this exact view may already be queued (`pendingReveal`,
      // still waiting on `shown`) or may have just landed (`shown` won the
      // race and already called `applyReveal`) -- either way, clobbering the
      // selection here would drop it. Only reset when neither is true.
      if (pendingReveal.current === undefined && revealedFor.current !== name) {
        setSelectedPath(undefined);
      }
    }
    // A sidebar keeps its phrase across a re-focus/reopen, but a *non-empty*
    // one is selected same as the modal's -- the point of coming back to a
    // dock you already filtered is usually to replace that filter, not
    // resume typing into the middle of it, and a selected phrase makes
    // typing do exactly that. An empty phrase has nothing to select either
    // way. Never for a prefix hop (`carried`), which is an extension of what
    // was already being typed, not a fresh ask.
    focusInput(
      carried === undefined && (isModal || phraseRef.current.trim() !== ""),
    );
    // A sidebar keeps whatever the user filtered down to, so re-revealing
    // would drag the selection out of the set they deliberately built (and
    // the current page may not even be in it). Only an unfiltered sidebar
    // re-reveals. A prefix hop is never a re-reveal either: `phraseRef` is
    // still last render's, and the carried phrase is the point of the hop.
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
