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
