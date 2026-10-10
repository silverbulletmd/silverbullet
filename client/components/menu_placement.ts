export const MENU_MAX_WIDTH = 260;
const GUTTER = 8;
const GAP = 4;

export type MenuPlacement = { top: number; right: number; maxWidth: number };

export function placeMenu(
  trigger: DOMRect,
  viewport: { width: number; height: number },
): MenuPlacement {
  const maxWidth = Math.min(MENU_MAX_WIDTH, viewport.width - GUTTER * 2);
  const rightAligned = viewport.width - trigger.right;
  const right = Math.min(
    Math.max(rightAligned, GUTTER),
    Math.max(viewport.width - maxWidth - GUTTER, GUTTER),
  );
  return { top: trigger.bottom + GAP, right, maxWidth };
}

/** Below the button and right-aligned to it; flipped above when it would run off the bottom. */
export function placePopupMenu(
  button: { top: number; bottom: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = button.bottom + GAP;
  const top =
    below + menu.height > viewport.height - GUTTER
      ? Math.max(GUTTER, button.top - GAP - menu.height)
      : below;
  const left = Math.max(
    GUTTER,
    Math.min(button.right - menu.width, viewport.width - menu.width - GUTTER),
  );
  return { top, left };
}
