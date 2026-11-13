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

/**
 * Below the button and right-aligned to it (`align: "end"`), or left-aligned to
 * it so it extends rightwards (`align: "start"`); flipped above when it would
 * run off the bottom, and kept inside the viewport.
 */
export function placePopupMenu(
  button: { top: number; bottom: number; left?: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  align: "start" | "end" = "end",
): { top: number; left: number } {
  const below = button.bottom + GAP;
  const top =
    below + menu.height > viewport.height - GUTTER
      ? Math.max(GUTTER, button.top - GAP - menu.height)
      : below;
  const left = Math.max(
    GUTTER,
    Math.min(
      align === "start"
        ? (button.left ?? button.right)
        : button.right - menu.width,
      viewport.width - menu.width - GUTTER,
    ),
  );
  return { top, left };
}

/**
 * A submenu beside the row that opens it: rightwards from the parent menu,
 * its first row level with that row, or leftwards when there is no room on the
 * right; kept inside the viewport.
 */
export function placeSubmenu(
  row: { top: number },
  parent: { left: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  // The menu's own padding and border, so its first row lines up with `row`
  inset = 5,
): { top: number; left: number } {
  const right = parent.right - 2;
  const left =
    right + menu.width <= viewport.width - GUTTER
      ? right
      : Math.max(GUTTER, parent.left + 2 - menu.width);
  const top = Math.max(
    GUTTER,
    Math.min(row.top - inset, viewport.height - menu.height - GUTTER),
  );
  return { top, left };
}
