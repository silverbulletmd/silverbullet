import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import type { MutableRef } from "preact/hooks";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import {
  ancestorPaths,
  withExpanded,
} from "../../../../plug-api/ui/tree_model.ts";
import type { Client } from "../../../client.ts";
import { isNarrowScreen, MOBILE_MEDIA_QUERY } from "../../../lib/mobile.ts";
import { createActivate } from "../activation.ts";
import type { NavigatorEngine } from "../engine.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "../panel.ts";
import { markSlotReady, type NavActivation } from "../slots.ts";

/**
 * Everything that drives the panel from outside its own keystrokes:
 * activation, the debounced refresh, follow-editor reveals, and the two modes
 * (read-only, mobile) it has to track.
 */
export function usePanelEvents({
  slot,
  client,
  engine,
  activation,
  refs,
  set,
  publish,
}: {
  slot: string;
  client: Client;
  engine: NavigatorEngine;
  activation: NavActivation;
  refs: SharedRefs;
  set: PanelSetters;
  publish: () => void;
}): {
  readOnly: boolean;
  mobile: boolean;
  /** The debounced source re-run, for the commands that want one promptly
   * (an action or a move that changed what the rows describe). */
  refresh: MutableRef<() => void>;
} {
  // Read-only clients get no mutating affordances at all: they'd only fail on
  // the way to the server. Re-derived whenever the editor reloads, which is
  // what a forced read-only toggle does.
  const [readOnly, setReadOnly] = useState(false);
  // Below the mobile breakpoint a sidebar dock is a full-width drawer over the
  // editor, so it behaves like the modal: it closes once you pick something,
  // and it has no edge to drag.
  const [mobile, setMobile] = useState<boolean>(isNarrowScreen);

  const segmentForced = useRef(false);
  const dropdownForced = useRef(false);
  // View name `applyReveal` last ran for, so `activate`'s tail can tell
  // whether this exact view was already revealed.
  const revealedFor = useRef<string | undefined>(undefined);
  // Page `applyReveal` last ran for. `editor:pageLoaded` also fires for
  // reloads of the page that's already revealed; re-revealing there would
  // scroll the tree back off whatever the user had scrolled to.
  const revealedPage = useRef<string | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const activate = useRef<(data: NavActivation) => void>(() => {});
  const refresh = useRef<() => void>(() => {});

  const { view: viewRef, displayed, readySignaledToken } = refs;
  const { setSelectedPath, setExpanded } = set;

  useLayoutEffect(() => {
    const mql = globalThis.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (ev: MediaQueryListEvent) => setMobile(ev.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    // `select` is the caller's call -- see the activate tail, which selects
    // for the modal always and for a sidebar only when it's coming back with
    // a non-empty phrase already in it.
    function focusInput(select: boolean) {
      refs.input.current?.focus();
      if (select) refs.input.current?.select();
    }

    // `system.getMode` covers a server/space started read-only; the UI option
    // covers the in-session "Editor: Toggle Read Only Mode" command. The
    // current page's own `perm` deliberately doesn't count: these rows are
    // other pages.
    async function syncReadOnly() {
      try {
        const [mode, forced] = await Promise.all([
          system.getMode(),
          editor.getUiOption("forcedROMode"),
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
          document.querySelector(
            `.sb-nav-root-${slot} [data-path="${CSS.escape(name)}"]`,
          ),
          ".sb-nav-body",
        );
      });
    }

    // Immediate ready-signal path: a reopen of the view this panel already
    // displays shows content that's already settled (nothing new is
    // rendering), so there is nothing to wait for -- unlike a fresh load,
    // which still goes through NavRoot's paint-timed
    // `useLayoutEffect([view, bootError])`. Shared `readySignaledToken`
    // de-dupe: whichever path reaches a given token first is the one that
    // counts.
    function signalReady(token: number) {
      if (readySignaledToken.current === token) return;
      readySignaledToken.current = token;
      markSlotReady(slot, token);
    }

    // Guard: events arriving before any view is active are ignored -- there's
    // nothing to refresh yet, and no debounce timer worth arming.
    const triggerRefresh = () => {
      if (!engine.activeName) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(async () => {
        await engine.refresh();
        publish();
      }, 300) as unknown as number;
    };
    refresh.current = triggerRefresh;

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
      applyReveal(name);
    };

    // Reloading the editor in place is what `editor.setUiOption` does, so it
    // is also the only signal a forced read-only toggle gives us.
    const pageReloaded = () => {
      void syncReadOnly();
    };

    // Per (event, handler) pair, not per event: a view whose `refreshOn`
    // names `editor:pageLoaded` needs the refresh *as well as* the
    // follow-editor handler already subscribed to it.
    const subscribed: [string, (...args: any[]) => void][] = [];
    const listen = (name: string, handler: (...args: any[]) => void) => {
      if (subscribed.some(([n, h]) => n === name && h === handler)) return;
      subscribed.push([name, handler]);
      client.eventHook.addLocalListener(name, handler);
    };
    listen("editor:pageLoaded", pageLoaded);
    listen("editor:pageReloaded", pageReloaded);

    activate.current = createActivate({
      slot,
      engine,
      refs: {
        ...refs,
        segmentForced,
        dropdownForced,
        revealedFor,
        revealedPage,
      },
      listenForRefresh: (names) => {
        for (const name of names) listen(name, triggerRefresh);
      },
      set,
      publish,
      syncReadOnly,
      applyReveal,
      focusInput,
      signalReady,
    });

    const timer = refreshTimer;
    return () => {
      clearTimeout(timer.current);
      for (const [name, handler] of subscribed) {
        client.eventHook.removeLocalListener(name, handler);
      }
      // Unmounting *is* the close: a one-shot view's rows must not survive it
      // into the slot's next occupant.
      if (displayed.current) engine.dropIfEphemeral(displayed.current);
    };
  }, [slot]);

  // Every activation this slot is handed, including the one it mounted with.
  useLayoutEffect(() => {
    activate.current(activation);
  }, [activation]);

  return { readOnly, mobile, refresh };
}
