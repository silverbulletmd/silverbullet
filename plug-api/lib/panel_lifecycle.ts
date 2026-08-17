/**
 * The content-agnostic half of a dock/panel content manager: activation
 * tokens, sidebar/modal show-hide-resize plumbing, boot restore, and a
 * preamble-keyed content cache. Extracted from the navigator so a future
 * dock consumer (anything that wants a persistent, resizable,
 * keyed-panel-backed slot) can reuse it without navigator's own Lua/pick
 * vocabulary. See `client/navigator/navigator.ts` for the reference
 * consumer.
 */

import {
  datastore,
  editor,
  events,
} from "@silverbulletmd/silverbullet/syscalls";
import type { PanelMode } from "@silverbulletmd/silverbullet/type/client";

export type PanelLifecycleContent = { html: string; script: string };

export type PanelLifecycleMeta = {
  dock: string;
  refreshOn?: string[];
};

/**
 * A slot's current activation: which view it's showing, the token that
 * identifies this particular `open`/`replaceInSlot` call, and (for a
 * passive boot restore) `passive`. Everything else is caller-supplied and
 * echoed back verbatim -- this module never inspects it.
 */
export type Activation = {
  view: string;
  token: number;
  passive?: boolean;
} & Record<string, unknown>;

export type OpenOpts = {
  /**
   * Report an unknown view by returning `false` rather than flashing an
   * error notification.
   */
  quiet?: boolean;
} & Record<string, unknown>;

export type PanelLifecycleConfig = {
  /** Datastore key prefix and event-name prefix (e.g. "navigator"). */
  namespace: string;
  sidebarSlots?: string[];
  modalSlot?: string;
  widthBounds: { min: number; max: number; default: number };
  modalMode: PanelMode;
  /** Used in the "No {notFoundLabel} named X" flash notification. */
  notFoundLabel: string;
  getMeta(name: string): PanelLifecycleMeta | undefined;
  buildEvents(refreshOn?: string[]): string[];
  content: {
    preamble(): Promise<string>;
    build(slot: string, preamble: string): Promise<PanelLifecycleContent>;
  };
  /** Views that should win over a saved dock at boot restore. */
  getForcedOpens?(): { name: string; dock: string }[];
  /** A newer activation took the slot from this still-pending one. Fired
   * only after the new activation's own async work completes (or throws) —
   * never right after the slot is claimed — so a caller settling state for
   * `previousView` can assume any in-flight work it raced against has had
   * time to land first. */
  onSuperseded?(previousView: string): void;
  /** A slot closed for real (no successor activation) while `view` was up. */
  onSlotClosedWithoutSuccessor?(view: string): void;
};

export function createPanelLifecycle(config: PanelLifecycleConfig) {
  const sidebarSlots = config.sidebarSlots ?? ["lhs", "rhs"];
  const modalSlot = config.modalSlot ?? "modal";

  function clampWidth(width: number): number {
    return Math.min(
      config.widthBounds.max,
      Math.max(config.widthBounds.min, width),
    );
  }

  function widthMode(width: number): string {
    return `0 0 ${clampWidth(width)}px`;
  }

  function dockedKey(slot: string) {
    return [config.namespace, "docked", slot];
  }

  // Which view each slot was last asked to show, and the token identifying
  // that activation call. The iframe pulls this on boot (its own `ready`
  // event) because the activate push below is dropped when the panel
  // hasn't finished mounting yet -- so a single activation can reach the
  // panel twice, and the token is how it tells a duplicate from a genuine
  // re-invocation.
  const pendingActivation = new Map<string, Activation>();
  let activationToken = 0;

  // Slot -> view name currently visible (not hidden) in a sidebar dock.
  // Only `resize` reads it: a drag tick that lands after the panel closed
  // (or switched views) must not re-show it. Cleared by `panelHidden`.
  const visibleSidebarView = new Map<string, string>();

  // Slots with a real close in flight: `panelHidden` has cleared
  // `visibleSidebarView` for the slot but its `datastore.del` hasn't
  // resolved yet. `resize`'s datastore-fallback path checks this before
  // trusting a re-derived name, so a drag tick landing in that window can't
  // read the not-yet-deleted key and re-show (and re-arm) a panel that's
  // actually closing.
  const closingSlots = new Set<string>();

  // Slot -> events forwarded to the panel the last time it was shown,
  // reused by `resize` so its re-`showPanel` call (same key, same
  // html/script) doesn't drop any event subscriptions.
  const slotEvents = new Map<string, string[]>();

  // Slot -> the flex mode it is currently shown with, so a `replaceInSlot`
  // hop takes over the slot at exactly the width it already had rather
  // than at whatever width happens to be saved under its own name.
  const slotMode = new Map<string, number | string>();

  // Cached per slot and keyed by the caller's preamble. The identity of the
  // html/script strings is what lets the host's `show-keyed-panel` reducer
  // recognize a same-content re-show and skip rebuilding the iframe, so a
  // plain per-slot memo is required -- but memoizing the preamble too would
  // pin whatever it was at first-build time. Re-reading it per build and
  // only rebuilding when it actually changed keeps both properties.
  const panelContentCache = new Map<
    string,
    { preamble: string; content: PanelLifecycleContent }
  >();

  async function panelContent(slot: string): Promise<PanelLifecycleContent> {
    const preamble = await config.content.preamble();
    const cached = panelContentCache.get(slot);
    if (cached && cached.preamble === preamble) return cached.content;
    const content = await config.content.build(slot, preamble);
    panelContentCache.set(slot, { preamble, content });
    return content;
  }

  function ready(data: { slot: string }): Activation | undefined {
    return pendingActivation.get(data.slot);
  }

  /**
   * @param passive a boot restore rather than a user asking for the view:
   * the panel comes back where it was, but must not take focus.
   */
  async function activateShow(
    name: string,
    passive: boolean,
    opts?: OpenOpts,
  ): Promise<boolean> {
    const meta = config.getMeta(name);
    if (!meta) {
      if (!opts?.quiet) {
        await editor.flashNotification(
          `No ${config.notFoundLabel} named ${name}`,
          "error",
        );
      }
      return false;
    }
    const slot = meta.dock;

    // Toggle-on-focused: closed -> open+focus and visible-but-unfocused ->
    // re-focus are both the fall-through below (`showPanel` no-ops on an
    // already-shown key; the re-dispatch is what makes an unfocused dock
    // take focus). Focused -> hide is the one case that isn't a re-open at
    // all, so it's handled here, ahead of any of that. Modal is exempt: a
    // picker already resets and re-focuses on every open by design, and has
    // its own dismissal (Escape, backdrop, a pick) rather than a
    // re-press-to-close gesture.
    if (
      !passive &&
      slot !== modalSlot &&
      visibleSidebarView.get(slot) === name &&
      (await editor.getFocusedPanelSlot()) === slot
    ) {
      await editor.hidePanel(slot as any);
      await editor.focus();
      return true;
    }

    // Last-open-wins: this activation takes the slot from whatever was
    // pending for it. Captured now, acted on only once this activation's
    // own work below is done (see the `finally` below): `finally`, not a
    // plain trailing call, so a throw anywhere below can't leave the
    // outgoing activation's supersede notification undelivered.
    const previous = pendingActivation.get(slot);

    try {
      const token = ++activationToken;
      const { quiet: _quiet, ...bag } = opts ?? {};
      const activation: Activation = {
        view: name,
        token,
        passive,
        ...bag,
      };
      pendingActivation.set(slot, activation);
      const { html, script } = await panelContent(slot);
      let mode: number | string = config.modalMode;
      if (slot !== modalSlot) {
        const saved = await datastore.get([config.namespace, name, "width"]);
        mode = widthMode(
          typeof saved === "number" ? saved : config.widthBounds.default,
        );
      }
      const panelEvents = config.buildEvents(meta.refreshOn);
      slotEvents.set(slot, panelEvents);
      slotMode.set(slot, mode);
      await editor.showPanel(slot as any, mode, html, script, {
        key: `${config.namespace}:${slot}`,
        events: panelEvents,
        activationId: token,
      });
      if (slot !== modalSlot) {
        visibleSidebarView.set(slot, name);
        await datastore.set(dockedKey(slot), name);
      }
      // Tell the (possibly already-mounted) iframe which view to display.
      // Re-run on a dock that's already showing this view: `showPanel`
      // above is a no-op (same key, same html/script identity) and this
      // re-signal is what makes the panel re-focus rather than toggle
      // closed.
      await events.dispatchEvent(`${config.namespace}:activate`, {
        slot,
        ...activation,
      });
      return true;
    } finally {
      if (previous && previous.view !== name) {
        config.onSuperseded?.(previous.view);
      }
    }
  }

  function open(name: string, opts?: OpenOpts): Promise<boolean> {
    return activateShow(name, false, opts);
  }

  /**
   * Swap the view a slot is showing for a sibling, in place -- the slot's
   * own `dock` (if any) is ignored, since the whole point is that it takes
   * over the slot the user is already looking at, at the width that slot
   * already has. Deliberately never persisted to `dockedKey`: the caller
   * decides what "docked" means for its own content, this primitive never
   * writes that key.
   */
  async function replaceInSlot(
    slot: string,
    name: string,
    bag?: Record<string, unknown>,
  ): Promise<void> {
    const meta = config.getMeta(name);
    if (!meta) {
      await editor.flashNotification(
        `No ${config.notFoundLabel} named ${name}`,
        "error",
      );
      return;
    }
    const previous = pendingActivation.get(slot);
    try {
      const token = ++activationToken;
      const activation: Activation = {
        view: name,
        token,
        ...bag,
      };
      pendingActivation.set(slot, activation);
      // The target's refresh triggers, since it is the view whose content
      // is about to be on screen. Only the forwarded-event subscriptions
      // change; the html and script are identical, so the panel is not
      // rebuilt.
      const panelEvents = config.buildEvents(meta.refreshOn);
      slotEvents.set(slot, panelEvents);
      const { html, script } = await panelContent(slot);
      await editor.showPanel(
        slot as any,
        slotMode.get(slot) ??
          (slot === modalSlot
            ? config.modalMode
            : widthMode(config.widthBounds.default)),
        html,
        script,
        {
          key: `${config.namespace}:${slot}`,
          events: panelEvents,
          activationId: token,
        },
      );
      if (slot !== modalSlot) visibleSidebarView.set(slot, name);
      await events.dispatchEvent(`${config.namespace}:activate`, {
        slot,
        ...activation,
      });
    } finally {
      if (previous && previous.view !== name) {
        config.onSuperseded?.(previous.view);
      }
    }
  }

  async function panelHidden(data: {
    slot: string;
    view?: string;
    token?: number;
  }): Promise<void> {
    visibleSidebarView.delete(data.slot);
    // A real close, with no successor activation for the slot. A no-op for
    // every other view. The close has to be matched against the slot's
    // *current* activation by token before it's allowed to fire the hook: a
    // stale close (its round trip through client/worker/iframe hops landing
    // after a newer activation already took the slot) must not be mistaken
    // for that newer activation's own close.
    const pending = pendingActivation.get(data.slot);
    if (pending && data.token !== undefined && pending.token === data.token) {
      config.onSlotClosedWithoutSuccessor?.(pending.view);
    }
    // Closing a dock is what un-remembers it: the next boot restores
    // whatever was still open when this client last ran.
    if (sidebarSlots.includes(data.slot)) {
      // Marked in the same synchronous tick as the map delete above (no
      // await between them), so any `resize` that reads the map as empty
      // always sees this too -- see `closingSlots`.
      closingSlots.add(data.slot);
      try {
        await datastore.del(dockedKey(data.slot));
      } finally {
        closingSlots.delete(data.slot);
      }
    }
  }

  async function resize(data: {
    slot: string;
    width: number;
    commit?: boolean;
    view?: string;
  }): Promise<void> {
    let name = visibleSidebarView.get(data.slot);
    if (!name) {
      // Not necessarily a stray event: this is in-memory state, and the
      // panel iframe it describes lives on the host side -- anything that
      // recycles this worker without also rebuilding the panel wipes this
      // map while the dock stays visibly open. Bail immediately if a real
      // close is already in flight rather than pay for a re-derivation that
      // would only be discarded.
      if (closingSlots.has(data.slot)) return;
      let candidate =
        typeof data.view === "string" && data.view ? data.view : undefined;
      if (!candidate) {
        const saved = await datastore.get(dockedKey(data.slot));
        candidate = typeof saved === "string" ? saved : undefined;
      }
      if (!candidate) return; // genuinely no dock in this slot
      // Confirm this actually names a live view before trusting it into
      // `visibleSidebarView` and, below, into the width datastore key.
      const meta = config.getMeta(candidate);
      if (!meta) return;
      // A real activation, or a real close, may have landed while the
      // awaits above were in flight; prefer that fresher truth over the
      // derivation this tick was about to commit.
      const fresh = visibleSidebarView.get(data.slot);
      if (fresh) {
        name = fresh;
      } else {
        if (closingSlots.has(data.slot)) return;
        name = candidate;
        visibleSidebarView.set(data.slot, name);
        slotEvents.set(data.slot, config.buildEvents(meta.refreshOn));
      }
    }
    const width = clampWidth(data.width);
    if (data.commit) {
      await datastore.set([config.namespace, name, "width"], width);
    }
    // The already-built content, deliberately: a drag tick must not re-read
    // the preamble (a syscall per rAF frame), and swapping the html
    // mid-drag would rebuild the iframe under the user's pointer.
    const built = panelContentCache.get(data.slot);
    const { html, script } = built
      ? built.content
      : await panelContent(data.slot);
    // The panel may have been closed (or switched to a different view) by
    // the time the awaits above settle; re-showing it now would incorrectly
    // reopen it, or apply this drag's width to the wrong view.
    if (visibleSidebarView.get(data.slot) !== name) return;
    const panelEvents =
      slotEvents.get(data.slot) ??
      config.buildEvents(config.getMeta(name)?.refreshOn);
    slotMode.set(data.slot, widthMode(width));
    // No `activationId` here, deliberately: this slot's own
    // `pendingActivation` token can be stale relative to what this iframe's
    // own handled-token still has (e.g. right after a worker reload, which
    // resets the former but never touches the latter) -- passing it would
    // risk *replacing* a still-correct activationId with a wrong one.
    // Omitting the field leaves the reducer's own `show-keyed-panel` case to
    // preserve whatever was already there, which is what a drag-resize
    // re-show -- the same activation the whole time -- actually wants.
    await editor.showPanel(data.slot as any, widthMode(width), html, script, {
      key: `${config.namespace}:${data.slot}`,
      events: panelEvents,
    });
  }

  async function preloadModal(): Promise<void> {
    const { html, script } = await panelContent(modalSlot);
    await editor.showPanel(modalSlot as any, config.modalMode, html, script, {
      key: `${config.namespace}:${modalSlot}`,
      preload: true,
      events: [`${config.namespace}:activate`],
    });
  }

  /**
   * Which views want a dock at boot: whatever was still open when this
   * client last ran (per slot, `dockedKey`), overridden by any view the
   * caller reports as force-open. Restoring is passive -- the panel comes
   * back, the editor keeps focus.
   */
  async function restoreDocks(): Promise<void> {
    // A narrow screen always boots with its drawers closed: there a dock
    // covers the editor whole, so restoring one would hide the page the
    // user actually navigated to.
    if (await editor.isNarrowScreen()) return;

    const forced = new Map<string, string>();
    for (const view of config.getForcedOpens?.() ?? []) {
      if (sidebarSlots.includes(view.dock)) forced.set(view.dock, view.name);
    }

    for (const slot of sidebarSlots) {
      let name = forced.get(slot);
      if (!name) {
        const saved = await datastore.get(dockedKey(slot));
        if (typeof saved !== "string") continue;
        const meta = config.getMeta(saved);
        // Skipped, not forgotten: a name that doesn't resolve right now is
        // at least as likely to be a view that hasn't been indexed yet (a
        // cold first boot, a space still syncing) as one that is really
        // gone, and forgetting it there would silently close a dock the
        // user never closed. It costs one lookup per boot to keep trying.
        if (!meta) continue;
        // A dock mismatch *is* decisive: the view exists and lives
        // somewhere else now, so this slot's memory of it is stale by
        // definition.
        if (meta.dock !== slot) {
          await datastore.del(dockedKey(slot));
          continue;
        }
        name = saved;
      }
      await activateShow(name, true);
    }
  }

  return {
    ready,
    open,
    replaceInSlot,
    resize,
    panelHidden,
    preloadModal,
    restoreDocks,
  };
}
