import { useEffect, useState } from "preact/hooks";

/**
 * Where the navigator's panels live: one entry per occupied slot, rendered by
 * `panels.tsx` inside the client's own Preact tree. `panel_lifecycle.ts`
 * writes here; nothing else does.
 */

/** How long a gated slot may stay hidden waiting for its first real content. */
const PAINT_REVEAL_TIMEOUT_MS = 800;

export type NavActivation = {
  view: string;
  token: number;
  /** A boot restore rather than a user asking: no focus is taken. */
  passive?: boolean;
  /** The phrase to arrive with (minus the prefix, for a prefix hop). */
  phrase?: string;
  /** Prefix routing: the view Backspace-on-empty steps back to. */
  from?: string;
  /** Segment label to activate, overriding the remembered one. */
  segment?: string;
  /** Dropdown value to select, overriding the remembered one. */
  dropdown?: unknown;
  /** `false`: the panel opens without taking focus from the editor. Unlike
   * `passive` (a boot restore), only the focus grab is skipped -- the rows
   * still refresh and phrase/selection reset as for any user-asked open. */
  focus?: boolean;
};

export type NavSlotState = {
  activation: NavActivation;
  /** The flex mode for a dock, the inset for the modal. */
  mode: number | string;
  /**
   * Paint-gated reveal: a gated slot (the modal) renders hidden until the
   * panel reports it has something to show for this activation, so a picker
   * never flashes unfiltered content on its way to the filtered list.
   */
  paintReady: boolean;
};

const states = new Map<string, NavSlotState>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

function slotState(slot: string): NavSlotState | undefined {
  return states.get(slot);
}

export function showSlot(
  slot: string,
  mode: number | string,
  activation: NavActivation,
  gated = false,
): void {
  states.set(slot, { activation, mode, paintReady: !gated });
  notify();
  if (gated) {
    setTimeout(
      () => markSlotReady(slot, activation.token),
      PAINT_REVEAL_TIMEOUT_MS,
    );
  }
}

export function hideSlot(slot: string): void {
  if (states.delete(slot)) notify();
}

export function markSlotReady(slot: string, token: number): void {
  const state = states.get(slot);
  if (!state || state.paintReady || state.activation.token !== token) return;
  states.set(slot, { ...state, paintReady: true });
  notify();
}

/** The slot whose panel currently holds focus, if any. */
export function focusedSlot(): string | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  const root = active.closest(".sb-nav-root");
  return root instanceof HTMLElement ? root.dataset.slot : undefined;
}

export function useNavigatorSlot(slot: string): NavSlotState | undefined {
  const [state, setState] = useState(() => slotState(slot));
  useEffect(() => {
    setState(slotState(slot));
    const listener = () => setState(slotState(slot));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [slot]);
  return state;
}
