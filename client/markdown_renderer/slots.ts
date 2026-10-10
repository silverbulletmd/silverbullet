import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { Tag } from "./html_render.ts";

export const SLOT_CHAR = "￼";
export const SLOT_MARKER_RE = /￼(\d+)￼/g;
export const LuaValueSlotType = "LuaValueSlot";
export const SlotRefType = "SlotRef";

// Lua values indexed by slot id
export type SlotTable = unknown[];

export function slotMarker(id: number): string {
  return `${SLOT_CHAR}${id}${SLOT_CHAR}`;
}

export function slotNode(id: number): ParseTree {
  return { type: LuaValueSlotType, children: [{ text: String(id) }] };
}

export function slotIdOf(node: ParseTree): number {
  return Number.parseInt(renderToText(node).replaceAll(SLOT_CHAR, ""), 10);
}

export function slotPlaceholderTag(id: number): Tag {
  return {
    name: "span",
    attrs: { class: "sb-slot", "data-sb-slot": String(id) },
    body: [],
  };
}

export const SLOT_PLACEHOLDER_RE =
  /<span class="sb-slot" data-sb-slot="(\d+)"><\/span>/g;

/** A slot placeholder, or (for a marker that isn't this fragment's) its text. */
export function slotTag(
  t: ParseTree,
  slotRefLimit: number | undefined,
): Tag | string {
  const id = slotIdOf(t);
  if (t.type === SlotRefType && id >= (slotRefLimit ?? 0)) {
    return renderToText(t);
  }
  return slotPlaceholderTag(id);
}
