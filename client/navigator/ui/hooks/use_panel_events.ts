import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import type { MutableRef } from "preact/hooks";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { revealInClosest } from "../../../../plug-api/ui/scroll.ts";
import {
  ancestorPaths,
  withExpanded,
} from "../../../../plug-api/ui/tree_model.ts";
import type { Client } from "../../../client.ts";
import {
  isMobileDevice,
  isNarrowScreen,
  MOBILE_MEDIA_QUERY,
} from "../../../lib/mobile.ts";
import { createActivate } from "../activation.ts";
import type { NavigatorEngine } from "../engine.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "../panel.ts";
import {
  markSlotReady,
  navInputCanTakeFocus,
  type NavActivation,
} from "../slots.ts";

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
  currentName: string;
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
  const [currentName, setCurrentName] = useState(() => client.currentName());
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
      if (isMobileDevice()) return;
      const apply = (): boolean => {
        const el = refs.input.current;
        if (!navInputCanTakeFocus(el)) return false;
        el.focus({ preventScroll: true });
        if (select) el.select();
        return document.activeElement === el;
      };
      if (apply()) return;
      // The modal opens paint-gated (`.sb-modal-paint-pending`). Focus
      // taken then is dropped once the class is removed; retry until the
      // input is actually shown, up to the paint-reveal timeout.
      const started = performance.now();
      const retry = () => {
        if (apply()) return;
        if (performance.now() - started > 1000) return;
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
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
      const path = String(
        current.rows.find((row) => row.obj.ref === name)?.obj.name ?? name,
      );
      // Use the view name so activate can compare it with its own identifier.
      revealedFor.current = current.name;
      revealedPage.current = name;
      // Merge with remembered expansion: it loads concurrently, and either order
      // must preserve the revealed ancestors.
      setExpanded((prev) =>
        withExpanded(
          prev,
          ancestorPaths(path, current.meta.hierarchy.separator),
          current.meta.expandAll === true,
        ),
      );
      setSelectedPath(path);
      requestAnimationFrame(() => {
        revealInClosest(
          document.querySelector(
            `.sb-nav-root-${slot} [data-path="${CSS.escape(path)}"]`,
          ),
          ".sb-nav-body",
        );
      });
    }

    // Reopening settled content has no paint effect to signal readiness. Signal
    // directly, sharing the token guard with NavRoot’s paint-time path.
    function signalReady(token: number) {
      if (readySignaledToken.current === token) return;
      readySignaledToken.current = token;
      markSlotReady(slot, token);
    }

    const triggerRefresh = () => {
      if (!engine.activeName) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(async () => {
        await engine.refresh();
        publish();
      }, 300) as unknown as number;
    };
    refresh.current = triggerRefresh;

    const contentLoaded = (pageRef: unknown) => {
      setCurrentName(String((pageRef as any)?.name ?? pageRef));
      void syncReadOnly();
      const current = viewRef.current;
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
    const contentReloaded = () => {
      void syncReadOnly();
    };

    const subscribed: [string, (...args: any[]) => void][] = [];
    const listen = (name: string, handler: (...args: any[]) => void) => {
      if (subscribed.some(([n, h]) => n === name && h === handler)) return;
      subscribed.push([name, handler]);
      client.eventHook.addLocalListener(name, handler);
    };
    listen("editor:pageLoaded", contentLoaded);
    listen("editor:pageReloaded", contentReloaded);
    listen("editor:documentLoaded", contentLoaded);
    listen("editor:documentReloaded", contentReloaded);

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

  return { currentName, readOnly, mobile, refresh };
}
