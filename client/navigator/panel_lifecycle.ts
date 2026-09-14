/**
 * The content-agnostic half of the navigator's dock/panel management:
 * activation tokens, window-dock/modal show-hide-resize plumbing and boot
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
  supportedDocks?: string[];
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

export type HideOpts = {
  /**
   * Whether this close is the client saying it wants the view closed, and so
   * should be remembered as `open = false`. `false` for a close the client
   * did not ask for -- a narrow-screen drawer dismissing itself after a
   * selection -- which must not opt the client out of a configured `open`.
   * Defaults to `true`.
   */
  recordIntent?: boolean;
  /** Whether a view displaced from this slot should return. Defaults to true. */
  restoreDisplaced?: boolean;
};

const NAMESPACE = "navigator";
const MODAL_SLOT = "modal";
/** The modal's inset, in pixels. */
const MODAL_MODE = 100;
const MIN_DOCK_SIZE = 160;
const MAX_DOCK_SIZE = 600;
const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 300;

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
  /** Resolves the slot a view actually opens in, overriding `meta.dock`. */
  resolveDock?(name: string, meta: PanelLifecycleMeta): Promise<string>;
  /** The space's configured sidebar width for a view, if it set one. */
  defaultWidth?(name: string): number | undefined;
  /** The space's configured bottom-panel height for a view, if it set one. */
  defaultHeight?(name: string): number | undefined;
  /** Views the space configured open, for the boot-restore pass. */
  getDefaultOpens?(): string[];
  /** Whether a window-docked view opens at boot. */
  sidebarDefaultOpen?(name: string): Promise<boolean>;
};

export function createPanelLifecycle(config: PanelLifecycleConfig) {
  const sidebarSlots = config.sidebarSlots ?? ["lhs", "rhs", "bhs"];

  function clampSize(size: number): number {
    return Math.min(MAX_DOCK_SIZE, Math.max(MIN_DOCK_SIZE, size));
  }

  function sizeMode(size: number): string {
    return `0 0 ${clampSize(size)}px`;
  }

  function sizeKey(slot: string): "width" | "height" {
    return slot === "bhs" ? "height" : "width";
  }

  function startingSize(name: string, slot: string): number {
    return slot === "bhs"
      ? (config.defaultHeight?.(name) ?? DEFAULT_HEIGHT)
      : (config.defaultWidth?.(name) ?? DEFAULT_WIDTH);
  }

  function dockedKey(slot: string) {
    return [NAMESPACE, "docked", slot];
  }

  // Activation tokens distinguish late close/paint signals from the current view.
  const pendingActivation = new Map<string, Activation>();
  let activationToken = 0;
  let invalidationToken = 0;
  const slotInvalidatedAt = new Map<string, number>();

  // Track the visible view for size commits; clearing on hide prevents a late
  // drag tick from reopening the panel.
  const visibleDockView = new Map<string, string>();

  const displaced = new Map<string, string>();

  // Keep the current width across replaceInSlot hops.
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
    const startedAt = invalidationToken;
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
    const slot = config.resolveDock
      ? await config.resolveDock(name, meta)
      : meta.dock;
    if ((slotInvalidatedAt.get(slot) ?? 0) > startedAt) return false;

    if (
      !passive &&
      opts?.focus !== false &&
      slot !== MODAL_SLOT &&
      visibleDockView.get(slot) === name &&
      focusedSlot() === slot
    ) {
      await hide(slot);
      await editor.focus();
      return true;
    }

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
      if (previous && previous.view !== name && sidebarSlots.includes(slot)) {
        displaced.set(slot, previous.view);
      } else if (!previous) {
        displaced.delete(slot);
      }
      let mode: number | string = MODAL_MODE;
      if (slot !== MODAL_SLOT) {
        const saved = await datastore.get([NAMESPACE, name, sizeKey(slot)]);
        if (pendingActivation.get(slot)?.token !== token) return false;
        mode = sizeMode(
          typeof saved === "number" ? saved : startingSize(name, slot),
        );
      }
      slotMode.set(slot, mode);
      showSlot(slot, mode, activation, slot === MODAL_SLOT);
      if (slot !== MODAL_SLOT) {
        visibleDockView.set(slot, name);
        await datastore.set(dockedKey(slot), name);
        await datastore.set([NAMESPACE, name, "open"], true);
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
          (slot === MODAL_SLOT
            ? MODAL_MODE
            : sizeMode(startingSize(name, slot))),
        activation,
        // A hop swaps the rows under a panel that is already on screen:
        // gating it would blank what the user is looking at.
        false,
      );
      if (slot !== MODAL_SLOT) visibleDockView.set(slot, name);
    } finally {
      if (previous && previous.view !== name) {
        config.onSuperseded?.(previous.view);
      }
    }
  }

  async function hide(
    slot: string,
    expectedToken?: number,
    opts?: HideOpts,
  ): Promise<void> {
    const pending = pendingActivation.get(slot);
    if (
      expectedToken !== undefined &&
      (!pending || pending.token !== expectedToken)
    ) {
      return;
    }
    slotInvalidatedAt.set(slot, ++invalidationToken);
    visibleDockView.delete(slot);
    pendingActivation.delete(slot);
    if (pending) config.onSlotClosedWithoutSuccessor?.(pending.view);
    if (sidebarSlots.includes(slot)) {
      const resident = await datastore.get(dockedKey(slot));
      await datastore.del(dockedKey(slot));
      if (opts?.recordIntent !== false) {
        if (pending) {
          await datastore.set([NAMESPACE, pending.view, "open"], false);
        }
        // A `replaceInSlot` hop leaves the slot's resident-of-record behind:
        // the user closed the panel, so neither view may reopen at boot.
        if (typeof resident === "string" && resident !== pending?.view) {
          await datastore.set([NAMESPACE, resident, "open"], false);
        }
      }
    }
    const back = displaced.get(slot);
    displaced.delete(slot);
    if (back && opts?.restoreDisplaced === false) {
      hideSlot(slot);
      if (opts.recordIntent !== false) {
        await datastore.set([NAMESPACE, back, "open"], false);
      }
      return;
    }
    if (back && opts?.restoreDisplaced !== false && config.getMeta(back)) {
      await activateShow(back, true);
      return;
    }
    hideSlot(slot);
  }

  async function resize(data: {
    slot: string;
    width?: number;
    height?: number;
    commit?: boolean;
  }): Promise<void> {
    const name = visibleDockView.get(data.slot);
    if (!name || !pendingActivation.has(data.slot)) return;
    const key = sizeKey(data.slot);
    const requested = key === "height" ? data.height : data.width;
    if (requested === undefined) return;
    const size = clampSize(requested);
    if (data.commit) {
      await datastore.set([NAMESPACE, name, key], size);
    }
    const activation = pendingActivation.get(data.slot);
    if (!activation) return;
    const mode = sizeMode(size);
    slotMode.set(data.slot, mode);
    showSlot(data.slot, mode, activation);
  }

  async function restoreDocks(): Promise<void> {
    // Boot with narrow-screen drawers closed so they do not obscure the page.
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
        // Keep unresolved names: the view may not be indexed yet. Retry next boot.
        if (!meta) continue;
        const resolved = config.resolveDock
          ? await config.resolveDock(saved, meta)
          : meta.dock;
        if (resolved !== slot) {
          await datastore.del(dockedKey(slot));
          continue;
        }
        name = saved;
      }
      await activateShow(name, true);
    }

    const configuredOpens = [...(config.getDefaultOpens?.() ?? [])].sort();
    for (const name of configuredOpens) {
      const meta = config.getMeta(name);
      if (!meta) continue;
      const slot = config.resolveDock
        ? await config.resolveDock(name, meta)
        : meta.dock;
      if (!sidebarSlots.includes(slot)) continue;
      const occupant = pendingActivation.get(slot)?.view;
      if (occupant) {
        // Silent when it is this very view: the slot loop above already
        // restored it from the docked key, which is the same outcome.
        if (occupant !== name) {
          // Two views configured open on the same side is an authoring
          // mistake; a view the client itself left docked there is not.
          const message = `view.defaults: "${name}" is configured open on ${slot}, already taken by "${occupant}"`;
          if (configuredOpens.includes(occupant)) console.warn(message);
          else console.debug(message);
        }
        continue;
      }
      if (!(await config.sidebarDefaultOpen?.(name))) continue;
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
