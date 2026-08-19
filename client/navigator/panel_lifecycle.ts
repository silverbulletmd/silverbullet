/**
 * The content-agnostic half of the navigator's dock/panel management:
 * activation tokens, sidebar/modal show-hide-resize plumbing and boot
 * restore. Mounting itself is `ui/slots.ts`; see `navigator.ts` for the
 * consumer that gives these slots their Lua/pick vocabulary.
 */

import { datastore, editor } from "@silverbulletmd/silverbullet/syscalls";
import { isNarrowScreen } from "../lib/mobile.ts";
import {
  focusedSlot,
  hideSlot,
  type NavActivation,
  showSlot,
} from "./ui/slots.ts";

export type PanelLifecycleMeta = {
  dock: string;
};

/**
 * A slot's current activation: which view it's showing, the token that
 * identifies this particular `open`/`replaceInSlot` call, and the rest of
 * what the panel is to arrive with -- echoed back verbatim, never inspected
 * here.
 */
export type Activation = NavActivation;

export type OpenOpts = {
  /**
   * Report an unknown view by returning `false` rather than flashing an
   * error notification.
   */
  quiet?: boolean;
  phrase?: string;
  from?: string;
  segment?: string;
  /** Dropdown value the panel arrives with selected. */
  dropdown?: unknown;
  /** `false` opens the panel without taking focus (see `NavActivation`). */
  focus?: boolean;
};

const NAMESPACE = "navigator";
const MODAL_SLOT = "modal";
/** The modal's inset, in pixels. */
const MODAL_MODE = 100;
const MIN_WIDTH = 160;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;

export type PanelLifecycleConfig = {
  sidebarSlots?: string[];
  getMeta(name: string): PanelLifecycleMeta | undefined;
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

  function clampWidth(width: number): number {
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
  }

  function widthMode(width: number): string {
    return `0 0 ${clampWidth(width)}px`;
  }

  function dockedKey(slot: string) {
    return [NAMESPACE, "docked", slot];
  }

  // Which view each slot was last asked to show, and the token identifying
  // that activation call. The token is what tells a close or a paint-ready
  // signal meant for this activation from one a newer activation has
  // already overtaken.
  const pendingActivation = new Map<string, Activation>();
  let activationToken = 0;

  // Slot -> view name currently visible in a sidebar dock, which is also
  // what a width commit is filed under. Cleared by `hide`, so a drag tick
  // that lands after the panel closed can't re-show it.
  const visibleSidebarView = new Map<string, string>();

  // Slot -> the flex mode it is currently shown with, so a `replaceInSlot`
  // hop takes over the slot at exactly the width it already had rather
  // than at whatever width happens to be saved under its own name.
  const slotMode = new Map<string, number | string>();

  function current(slot: string): Activation | undefined {
    return pendingActivation.get(slot);
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
          `No navigator view named ${name}`,
          "error",
        );
      }
      return false;
    }
    const slot = meta.dock;

    // Toggle-on-focused: closed -> open+focus and visible-but-unfocused ->
    // re-focus are both the fall-through below (the panel stays mounted; the
    // new activation is what makes an unfocused dock take focus). Focused ->
    // hide is the one case that isn't a re-open at all, so it's handled here,
    // ahead of any of that. Modal is exempt: a picker already resets and
    // re-focuses on every open by design, and has its own dismissal (Escape,
    // backdrop, a pick) rather than a re-press-to-close gesture.
    // A focus-less open never toggles: it is an "arrange this panel" call
    // (e.g. a mention click presetting the dropdown), not a re-press of the
    // panel's own open gesture.
    if (
      !passive &&
      opts?.focus !== false &&
      slot !== MODAL_SLOT &&
      visibleSidebarView.get(slot) === name &&
      focusedSlot() === slot
    ) {
      await hide(slot);
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
      let mode: number | string = MODAL_MODE;
      if (slot !== MODAL_SLOT) {
        const saved = await datastore.get([NAMESPACE, name, "width"]);
        mode = widthMode(typeof saved === "number" ? saved : DEFAULT_WIDTH);
      }
      slotMode.set(slot, mode);
      showSlot(slot, mode, activation, slot === MODAL_SLOT);
      if (slot !== MODAL_SLOT) {
        visibleSidebarView.set(slot, name);
        await datastore.set(dockedKey(slot), name);
      }
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
    bag?: { phrase?: string; from?: string },
  ): Promise<void> {
    const meta = config.getMeta(name);
    if (!meta) {
      await editor.flashNotification(
        `No navigator view named ${name}`,
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
      showSlot(
        slot,
        slotMode.get(slot) ??
          (slot === MODAL_SLOT ? MODAL_MODE : widthMode(DEFAULT_WIDTH)),
        activation,
        // A hop swaps the rows under a panel that is already on screen:
        // gating it would blank what the user is looking at.
        false,
      );
      if (slot !== MODAL_SLOT) visibleSidebarView.set(slot, name);
    } finally {
      if (previous && previous.view !== name) {
        config.onSuperseded?.(previous.view);
      }
    }
  }

  /**
   * Closes a slot for real. `expectedToken` is the activation the caller
   * means to close: a close decided against an activation a newer one has
   * since taken over is dropped rather than applied to that newer one.
   */
  async function hide(slot: string, expectedToken?: number): Promise<void> {
    const pending = pendingActivation.get(slot);
    if (
      expectedToken !== undefined &&
      (!pending || pending.token !== expectedToken)
    ) {
      return;
    }
    visibleSidebarView.delete(slot);
    pendingActivation.delete(slot);
    // A real close, with no successor activation for the slot -- the
    // supersede case never comes through here.
    if (pending) config.onSlotClosedWithoutSuccessor?.(pending.view);
    // Closing a dock is what un-remembers it: the next boot restores whatever
    // was still open when this client last ran. Ahead of the unmount, and
    // awaited: the panel leaving the screen is what everything else reads as
    // "closed", and a reload landing between the two would bring the dock
    // straight back. A local datastore write, so nothing perceptible.
    if (sidebarSlots.includes(slot)) await datastore.del(dockedKey(slot));
    hideSlot(slot);
  }

  async function resize(data: {
    slot: string;
    width: number;
    commit?: boolean;
  }): Promise<void> {
    const name = visibleSidebarView.get(data.slot);
    if (!name || !pendingActivation.has(data.slot)) return;
    const width = clampWidth(data.width);
    if (data.commit) {
      await datastore.set([NAMESPACE, name, "width"], width);
    }
    // Re-read rather than reuse what was captured above: the panel may have
    // been closed while the commit was in flight (re-showing it would reopen
    // it), and a hop that landed there owns the slot now, so its activation
    // is the one this width belongs to.
    const activation = pendingActivation.get(data.slot);
    if (!activation) return;
    const mode = widthMode(width);
    slotMode.set(data.slot, mode);
    showSlot(data.slot, mode, activation);
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
    if (isNarrowScreen()) return;

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
    current,
    open,
    replaceInSlot,
    resize,
    hide,
    restoreDocks,
  };
}
