/**
 * Size bounds for the window docks, shared by dragging (`resize_handle.tsx`),
 * saved sizes (`panel_lifecycle.ts`) and configured ones (`view_defaults.ts`).
 */

export type DockSlot = "lhs" | "rhs" | "bhs";

export const MIN_DOCK_SIZE = 160;
/** Side docks: wider than this crowds the editor whatever the window size. */
export const MAX_DOCK_WIDTH = 600;
/** The bottom dock always leaves this much of the window for the top bar and editor. */
export const EDITOR_RESERVE_PX = 200;

/** The tallest the bottom dock may be in a window `viewportHeight` tall. */
export function maxDockHeight(
  viewportHeight: number = globalThis.innerHeight ?? Infinity,
): number {
  return Math.max(MIN_DOCK_SIZE, viewportHeight - EDITOR_RESERVE_PX);
}

/** `size` held within the slot's bounds: a width for a side dock, a height for the bottom one. */
export function clampDockSize(
  slot: string,
  size: number,
  viewportHeight?: number,
): number {
  const max = slot === "bhs" ? maxDockHeight(viewportHeight) : MAX_DOCK_WIDTH;
  return Math.min(max, Math.max(MIN_DOCK_SIZE, size));
}

/**
 * The live bound for the bottom dock's element, so a height saved in a taller
 * window, or a window shrunk while the dock is open, still leaves the editor room.
 */
export const BOTTOM_DOCK_MAX_HEIGHT = `calc(100% - ${EDITOR_RESERVE_PX}px)`;
