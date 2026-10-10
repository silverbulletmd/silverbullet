import { isTaggedFloat } from "./numeric.ts";
import { LuaTable, luaFormatNumber } from "./runtime.ts";
import { hasViewMark } from "./widget_marks.ts";

export const WIDGET_AS_TEXT_MESSAGE =
  "this value is a widget and can't be used as text; use widget.toMarkdown(w) to get its markdown";

export function isWidgetValue(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  if (hasViewMark(v)) return true;
  if (v instanceof LuaTable) return v.rawGet("_isWidget") === true;
  return (v as any)._isWidget === true;
}

/** A field of a Lua table or a JS object. */
export function luaField(v: unknown, key: string): unknown {
  return v instanceof LuaTable ? v.rawGet(key) : (v as any)?.[key];
}

function partsField(v: unknown): unknown {
  return luaField(v, "parts");
}

export type LiveSpec = { value: unknown; refreshOn: string[] };

/** The wrapper `widget.live` returns, from either its Lua or JS shape. */
export function liveOf(v: unknown): LiveSpec | undefined {
  if (!isWidgetValue(v)) return undefined;
  const live = luaField(v, "live");
  if (live === undefined || live === null) return undefined;
  const refreshOn = luaField(live, "refreshOn");
  const list =
    refreshOn instanceof LuaTable
      ? refreshOn.toJSArray()
      : Array.isArray(refreshOn)
        ? refreshOn
        : [];
  return {
    value: luaField(live, "value") ?? null,
    refreshOn: list.filter((e): e is string => typeof e === "string"),
  };
}

/** A widget, or a list holding one (a query result cell can be either). */
export function containsWidget(v: unknown): boolean {
  if (isWidgetValue(v)) return true;
  const items =
    v instanceof LuaTable ? v.toJSArray() : Array.isArray(v) ? v : undefined;
  return !!items?.some(isWidgetValue);
}

export function isFragmentValue(v: unknown): boolean {
  if (!isWidgetValue(v)) return false;
  const parts = partsField(v);
  return parts !== undefined && parts !== null;
}

export function fragmentParts(v: unknown): unknown[] {
  const parts = partsField(v);
  if (parts instanceof LuaTable) {
    const out: unknown[] = [];
    for (let i = 1; i <= parts.length; i++) out.push(parts.rawGet(i));
    return out;
  }
  return Array.isArray(parts) ? parts : [];
}

/** Text of a string or number; undefined for anything else. */
export function textPart(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return luaFormatNumber(v);
  if (isTaggedFloat(v)) return luaFormatNumber((v as any).value, "float");
  return undefined;
}

export function makeFragment(parts: unknown[]): LuaTable {
  const flat: unknown[] = [];
  const push = (p: unknown) => {
    if (p === null || p === undefined) return;
    if (isFragmentValue(p)) {
      for (const q of fragmentParts(p)) push(q);
      return;
    }
    const text = textPart(p);
    if (text !== undefined) {
      if (typeof flat[flat.length - 1] === "string") {
        flat[flat.length - 1] += text;
      } else {
        flat.push(text);
      }
      return;
    }
    flat.push(p);
  };
  for (const p of parts) push(p);
  const fragment = new LuaTable();
  void fragment.rawSet("_isWidget", true);
  void fragment.rawSet("parts", new LuaTable(flat as any[]));
  return fragment;
}

export function concatWithWidgets(
  left: unknown,
  right: unknown,
): LuaTable | undefined {
  if (!isWidgetValue(left) && !isWidgetValue(right)) return undefined;
  const ok = (v: unknown) => isWidgetValue(v) || textPart(v) !== undefined;
  if (!ok(left) || !ok(right)) return undefined;
  return makeFragment([left, right]);
}
