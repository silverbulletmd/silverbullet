import { syscall } from "@silverbulletmd/silverbullet/syscall";
import type { MutableRef } from "preact/hooks";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { createActivate } from "../activation.ts";
import { takeFocus } from "../focus.ts";
import {
  type ActiveView,
  engine,
  navHooks,
  type PanelSetters,
  type SharedRefs,
} from "../panel.ts";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import {
  ancestorPaths,
  withExpanded,
} from "../../../../plug-api/ui/tree_model.ts";

/**
 * Whether the host is below its mobile breakpoint, where a sidebar dock is
 * laid out as a full-width drawer over the editor (see `main.scss`). Pushed in
 * by the host, because the panel's own media queries measure the panel.
 */
declare const sbMobile: boolean | undefined;

/**
 * Every handler the host drives the panel through, registered into the
 * `navHooks` slots as one set per slot: activation, visibility, the debounced
 * refresh, follow-editor reveals, and the two modes (read-only, mobile) that
 * only the host can tell us about.
 */
export function usePanelEvents({
  slot,
  refs,
  set,
  publish,
}: {
  slot: string;
  refs: SharedRefs;
  set: PanelSetters;
  publish: () => void;
}): {
  readOnly: boolean;
  mobile: boolean;
  /** The view this slot's iframe currently believes is displayed -- see
   * `commands.ts`'s `close`, which checks it before hiding the panel. */
  displayed: MutableRef<string | undefined>;
  /** The activation token of that same displayed view -- what `close` hands
   * to `editor.hidePanel` as the activation it means to close. */
  handledToken: MutableRef<number | undefined>;
  /** De-dupe token for `editor.panelReady` -- shared with `NavRoot`'s own
   * paint-timed signal so whichever of the two fires first for a given
   * activation is the one that counts. */
  readySignaledToken: MutableRef<number | undefined>;
} {
  // Read-only clients get no mutating affordances at all: they'd only fail on
  // the way to the server. Re-derived whenever the editor reloads, which is
  // what a forced read-only toggle does.
  const [readOnly, setReadOnly] = useState(false);
  // Below the host's mobile breakpoint a sidebar dock is a full-width drawer
  // over the editor, so it behaves like the modal: it closes once you pick
  // something, and it has no edge to drag.
  const [mobile, setMobile] = useState<boolean>(() => sbMobile === true);

  const displayed = useRef<string | undefined>(undefined);
  const handledToken = useRef<number | undefined>(undefined);
  const segmentForced = useRef(false);
  const stale = useRef(false);
  const hidden = useRef(false);
  const pendingReveal = useRef<string | undefined>(undefined);
  // View name `applyReveal` last ran for, so `activate`'s tail can tell
  // whether `shown` already revealed this exact view -- their arrival order
  // isn't guaranteed (`shown` is a client-local postMessage from a
  // hidden->visible prop transition, `navigator:activate` is plug-dispatched
  // and does a worker round-trip, so `shown` often lands first).
  const revealedFor = useRef<string | undefined>(undefined);
  // Page `applyReveal` last ran for. `editor:pageLoaded` also fires for
  // reloads of the page that's already revealed; re-revealing there would
  // scroll the tree back off whatever the user had scrolled to.
  const revealedPage = useRef<string | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const readySignaledToken = useRef<number | undefined>(undefined);

  const { view: viewRef } = refs;
  const { setPhrase, setSelectedIndex, setSelectedPath, setExpanded } = set;

  useLayoutEffect(() => {
    // `select` is the caller's call -- see the activate tail, which selects
    // for the modal always and for a sidebar only when it's coming back with
    // a non-empty phrase already in it.
    function focusInput(select: boolean) {
      takeFocus(refs.input.current);
      if (select) refs.input.current?.select();
    }

    // `system.getMode` covers a server/space started read-only; the UI option
    // covers the in-session "Editor: Toggle Read Only Mode" command. The
    // current page's own `perm` deliberately doesn't count: these rows are
    // other pages.
    async function syncReadOnly() {
      try {
        const [mode, forced] = await Promise.all([
          syscall("system.getMode"),
          syscall("editor.getUiOption", "forcedROMode"),
        ]);
        setReadOnly(mode === "ro" || forced === true);
      } catch (e) {
        console.error("navigator: read-only check failed", e);
      }
    }

    function applyReveal(name: string, active?: ActiveView) {
      const current = active ?? viewRef.current;
      if (!current) return;
      // Stamped with the *view's* name (not the revealed page) so
      // `activate`'s tail can compare it against its own `view: name` -- the
      // two use the same identifier space, the revealed page doesn't.
      revealedFor.current = current.name;
      revealedPage.current = name;
      // A fresh activation's remembered-expansion fetch (`createActivate`) is
      // a sibling async round trip with no fixed order against this one --
      // both now merge into `expanded` (see that fetch's own comment) rather
      // than one replacing the other, so this reveal's ancestors survive
      // regardless of which lands first.
      setExpanded((prev) =>
        withExpanded(
          prev,
          ancestorPaths(name, current.meta.hierarchy.separator),
          current.meta.expandAll === true,
        ),
      );
      setSelectedPath(name);
      requestAnimationFrame(() => {
        revealInClosest(
          document.querySelector(`[data-path="${CSS.escape(name)}"]`),
          ".sb-nav-body",
        );
      });
    }

    // Immediate ready-signal path: a reopen of the view this iframe already
    // displays, or an activation dropped as stale, both show content that's
    // already settled (nothing new is rendering), so there is nothing to
    // wait for -- unlike a fresh load, which still goes through NavRoot's
    // paint-timed `useLayoutEffect([view, bootError])`. Shared
    // `readySignaledToken` de-dupe: whichever path reaches a given token
    // first is the one that counts, and the hidePanel-style host-side guard
    // (`editor.panelReady`'s own activationId check) makes a stray extra call
    // harmless either way.
    function signalReady(token: number) {
      if (readySignaledToken.current === token) return;
      readySignaledToken.current = token;
      syscall("editor.panelReady", slot, token).catch((e) =>
        console.error("navigator: panelReady signal failed", e),
      );
    }

    const activate = createActivate({
      slot,
      refs: {
        ...refs,
        displayed,
        handledToken,
        segmentForced,
        stale,
        hidden,
        pendingReveal,
        revealedFor,
        revealedPage,
        readySignaledToken,
      },
      set,
      publish,
      syncReadOnly,
      applyReveal,
      focusInput,
      signalReady,
    });

    const shown = () => {
      hidden.current = false;
      void syncReadOnly();
      // Unlike `activate`, this fires on any hidden->visible transition,
      // which for the modal can be a passive reopen of the same cached view
      // (see the "reopening reuses the same iframe" case, where `activate`
      // no-ops because `displayed.current` is already correct). A sidebar's
      // own reopen is always covered by `activate` above, so keep this
      // reset+focus modal-only to avoid stealing editor focus if a sidebar
      // is ever revealed some other way in the future.
      if (slot === "modal") {
        setPhrase("");
        setSelectedIndex(0);
        setSelectedPath(undefined);
        focusInput(true);
      }
      if (pendingReveal.current !== undefined) {
        const name = pendingReveal.current;
        pendingReveal.current = undefined;
        applyReveal(name);
      }
      // A burst of refreshOn events landed while hidden: catch up now, once,
      // rather than having replayed each of them while hidden.
      if (stale.current) {
        stale.current = false;
        triggerRefresh();
      }
    };

    const onHidden = () => {
      hidden.current = true;
      // A genuine close (Escape, backdrop, a selection/create that closed
      // the panel) with no successor view taking the slot -- the supersede
      // case is caught in `activate` instead, which never sees a hide.
      if (displayed.current) engine.dropIfEphemeral(displayed.current);
      // Handed back to index.tsx, which forwards it in the `navigator:
      // panelHidden` payload: the identity of *this* close, read now, while
      // it's still current for this iframe. The worker compares it against
      // whatever it currently has pending for the slot before settling a
      // pick -- a close that reaches the worker late (after a newer
      // activation already took the slot) must not be mistaken for that
      // newer activation's own close (see navigator.ts's `panelHidden`).
      return { view: displayed.current, token: handledToken.current };
    };

    // Guard: events arriving before any view is active (e.g. the modal is
    // merely preloaded, never opened) are ignored -- there's nothing to
    // refresh yet, and no debounce timer worth arming.
    const triggerRefresh = () => {
      if (!engine.activeName) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(async () => {
        // Stale-while-hidden: no re-query and no state update while the
        // panel is hidden -- just remember to catch up once `panel:shown`
        // fires (see `shown` above).
        if (hidden.current) {
          stale.current = true;
          return;
        }
        await engine.refresh();
        publish();
      }, 300) as unknown as number;
    };

    const pageLoaded = (pageRef: unknown) => {
      void syncReadOnly();
      const current = viewRef.current;
      // A tree built out of the page's own content: its paths belong to the
      // page being left, so nothing about them carries over -- a header
      // collapsed here must not arrive collapsed on the next page that
      // happens to have one of the same name. Ahead of the followEditor gate
      // below, and not gated on the dock: the modal keeps its state too when
      // it is re-opened on the view it is already showing.
      if (current?.meta.expansionScope === "page") {
        setExpanded(new Set());
        setSelectedPath(undefined);
        refs.expandedDirty.current = false;
      }
      if (!current?.meta.followEditor || slot === "modal") return;
      const name = String((pageRef as any)?.name ?? pageRef);
      // Only a genuine navigation reveals -- see `revealedPage`.
      if (name === revealedPage.current) return;
      if (hidden.current) {
        // Stale-while-hidden: no state updates until the panel is shown
        // again (mirrors the persisted-expansion load in `createActivate`).
        pendingReveal.current = name;
        return;
      }
      applyReveal(name);
    };

    // Reloading the editor in place is what `editor.setUiOption` does, so it
    // is also the only signal a forced read-only toggle gives us.
    const pageReloaded = () => {
      void syncReadOnly();
    };

    const mobileChanged = (value: boolean) => setMobile(value);

    navHooks.activate = activate;
    navHooks.shown = shown;
    navHooks.hidden = onHidden;
    navHooks.refresh = triggerRefresh;
    navHooks.pageLoaded = pageLoaded;
    navHooks.pageReloaded = pageReloaded;
    navHooks.mobile = mobileChanged;

    const timer = refreshTimer;
    return () => {
      clearTimeout(timer.current);
      if (navHooks.activate === activate) navHooks.activate = undefined;
      if (navHooks.shown === shown) navHooks.shown = undefined;
      if (navHooks.hidden === onHidden) navHooks.hidden = undefined;
      if (navHooks.refresh === triggerRefresh) navHooks.refresh = undefined;
      if (navHooks.pageLoaded === pageLoaded) navHooks.pageLoaded = undefined;
      if (navHooks.pageReloaded === pageReloaded) {
        navHooks.pageReloaded = undefined;
      }
      if (navHooks.mobile === mobileChanged) navHooks.mobile = undefined;
    };
  }, [slot]);

  return { readOnly, mobile, displayed, handledToken, readySignaledToken };
}
