import { render } from "preact";
import { NavErrorBoundary } from "./components/nav_error_boundary.tsx";
import { NavRoot } from "./components/nav_root.tsx";
import { dispatch } from "./engine.ts";
import { takeFocus } from "./focus.ts";
import { navHooks } from "./panel.ts";

declare const __NAVIGATOR_SLOT: string;
declare const sbEvent: {
  on(name: string, cb: (...args: any[]) => void): void;
};

const globals = globalThis as unknown as {
  __navigatorListening?: boolean;
  /**
   * How many times this bundle has been eval'd in this iframe. The host wipes
   * `document.body` and re-evals whenever it re-posts the panel HTML, so this
   * is the one observable that separates "the panel kept running" from "the
   * panel was rebuilt and pulled its state back" -- which otherwise look
   * identical from outside (see the `navigator:ready` handshake below).
   */
  __navBootCount?: number;
};

globals.__navBootCount = (globals.__navBootCount ?? 0) + 1;

// `sbEvent` has no unsubscribe, and the host re-evals this bundle whenever the
// panel HTML changes. Registering twice would fan every activate/refresh out
// to two app instances, re-running the view's source query per copy.
if (!globals.__navigatorListening) {
  globals.__navigatorListening = true;
  // Registered while the bundle is still being eval'd, so a forwarded event
  // that arrives in the very next task finds a listener.
  sbEvent.on(
    "navigator:activate",
    (data: {
      slot: string;
      view: string;
      token?: number;
      phrase?: string;
      from?: string;
      segment?: string;
    }) => navHooks.activate?.(data),
  );
  sbEvent.on("panel:shown", () => navHooks.shown?.());
  sbEvent.on("panel:hidden", () => {
    const closed = navHooks.hidden?.();
    // Tells the plug this slot is no longer showing anything, so a resize
    // tick that lands after the panel closed doesn't re-show it -- and, via
    // `view`/`token`, exactly which activation this close belonged to, so a
    // late-arriving notification can't be mistaken for a newer one's (see
    // `navigator.ts`'s `panelHidden`).
    dispatch("navigator:panelHidden", {
      slot: __NAVIGATOR_SLOT,
      view: closed?.view,
      token: closed?.token,
    }).catch((e) => console.error("navigator: panelHidden notify failed", e));
  });
  sbEvent.on("editor:pageLoaded", (pageRef: unknown) =>
    navHooks.pageLoaded?.(pageRef),
  );
  // A same-page reload -- which is how `editor.setUiOption` applies a forced
  // read-only toggle, the one mode change that has no event of its own.
  sbEvent.on("editor:pageReloaded", () => navHooks.pageReloaded?.());
  // The host crossed its mobile breakpoint (a rotation, a resized window), so
  // a docked panel is now -- or no longer -- a full-width drawer.
  sbEvent.on("panel:mobile", (mobile: boolean) => navHooks.mobile?.(!!mobile));
}

// The stylesheet needs to know which dock it is in before anything renders: a
// modal document sizes to its content (the host reads that height back), a
// sidebar fills its dock.
document.documentElement.dataset.slot = __NAVIGATOR_SLOT;

const root = document.getElementById("navigator-root");
if (!root) throw new Error("navigator-root not found");

root.setAttribute("tabindex", "-1");

// Always (re-)render: a re-eval follows the host replacing document.body, so
// the previous tree is detached and this root element is new.
render(
  <NavErrorBoundary slot={__NAVIGATOR_SLOT}>
    <NavRoot slot={__NAVIGATOR_SLOT} />
  </NavErrorBoundary>,
  root,
);

// The plug's `navigator:activate` push can be dropped when it fires before
// this bundle boots, so pull whatever activation it recorded for this slot.
dispatch("navigator:ready", { slot: __NAVIGATOR_SLOT })
  .then(
    (pending?: {
      view: string;
      token: number;
      passive?: boolean;
      phrase?: string;
      from?: string;
      segment?: string;
    }) => {
      if (!pending?.view) return;
      // Focus the iframe document ahead of the activation below so the first
      // keydown (often Escape) is delivered to us rather than to the parent
      // SilverBullet editor. Never for a passive boot restore: the panel is
      // coming back on its own, and the editor's focus is not ours to take.
      if (!pending.passive) takeFocus(root);
      navHooks.activate?.({
        slot: __NAVIGATOR_SLOT,
        view: pending.view,
        token: pending.token,
        passive: pending.passive,
        phrase: pending.phrase,
        from: pending.from,
        segment: pending.segment,
      });
    },
  )
  .catch((e) => console.error("navigator: ready handshake failed", e));
