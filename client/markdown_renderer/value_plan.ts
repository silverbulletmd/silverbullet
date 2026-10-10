import type { WidgetObject } from "../codemirror/widgets/widget_body.ts";
import { isDomNode } from "../lib/dom.ts";
import type { ViewValue } from "../navigator/view_value.ts";
import { isViewValue } from "../navigator/view_value.ts";
import {
  containsWidget,
  fragmentParts,
  isFragmentValue,
  isWidgetValue,
  liveOf,
  textPart,
} from "../space_lua/fragment.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import {
  buildResultTableMarkdown,
  classifyResult,
  isBlockMarkdown,
  renderResultToMarkdown,
} from "../space_lua/render_lua_markdown.ts";
import {
  type LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "../space_lua/runtime.ts";
import { isSqlNull } from "../space_lua/sliq_null.ts";
import { SLOT_CHAR, type SlotTable, slotMarker } from "./slots.ts";

type WidgetEvents = Record<string, (e: any) => void>;

export type ValuePlan =
  | { kind: "empty"; widget?: true }
  | {
      kind: "markdown";
      markdown: string;
      slots: SlotTable;
      // The raw data (string, number, list, record, query result) this plan
      // renders; never set for a widget
      raw?: unknown;
      block?: boolean;
      cssClasses?: string[];
      events?: WidgetEvents;
    }
  | {
      kind: "literal";
      markdown: string;
      block?: boolean;
      cssClasses?: string[];
    }
  | {
      kind: "html";
      html: string | HTMLElement;
      block: boolean;
      copyMarkdown: string;
      cssClasses?: string[];
      events?: WidgetEvents;
    }
  | { kind: "sandbox"; widget: WidgetObject }
  | { kind: "view"; view: ViewValue };

// Converts a widget's own fields; a fragment's parts stay as they are, since
// each one is planned (and converted) on its own. Event handlers keep the
// frame they are converted with, so it must carry the global environment
// (string methods, `load` and `spacelua.*` need it).
function toJSWidget(v: unknown, globalEnv: LuaEnv): any {
  if (!(v instanceof LuaTable) || !isWidgetValue(v) || isViewValue(v)) return v;
  const sf = LuaStackFrame.createWithGlobalEnv(globalEnv);
  if (!isFragmentValue(v)) return luaValueToJS(v, sf);
  const js: Record<string, unknown> = { parts: fragmentParts(v) };
  for (const k of v.keys()) {
    if (k !== "parts") js[k] = luaValueToJS(v.rawGet(k), sf);
  }
  return js;
}

function displayBlock(w: any): boolean | undefined {
  return w.display === "block"
    ? true
    : w.display === "inline"
      ? false
      : undefined;
}

function addSlot(slots: SlotTable, value: unknown): string {
  slots.push(value);
  return slotMarker(slots.length - 1);
}

// Text next to slot markers must not be able to forge one
function itemText(v: unknown): string {
  return rawItemText(v).replaceAll(SLOT_CHAR, "\uFFFD");
}

function rawItemText(v: unknown): string {
  if (v === null || v === undefined || isSqlNull(v)) return "";
  return textPart(v) ?? `${v}`;
}

function isTableValue(v: unknown): boolean {
  return (
    typeof v === "object" && v !== null && !isSqlNull(v) && !isTaggedFloat(v)
  );
}

// Widgets and tables (e.g. a query result in a template) become slot
// markers, text and numbers stay text. Slot values are kept as they are:
// each is planned (and converted) on its own.
function flattenItems(
  items: unknown[],
  slots: SlotTable,
  separator: string,
): string {
  return items
    .map((p) =>
      isWidgetValue(p) || isTableValue(p) ? addSlot(slots, p) : itemText(p),
    )
    .join(separator);
}

// A live wrapper can (contrivedly) contain itself
const MAX_LIVE_UNWRAPS = 16;

export function planValue(
  raw: unknown,
  onLive: (refreshOn: string[]) => void,
  globalEnv: LuaEnv,
): ValuePlan {
  let value = raw;
  const liveAt = (v: unknown) => (isViewValue(v) ? undefined : liveOf(v));
  for (let live = liveAt(value), n = 0; live; live = liveAt(value), n++) {
    if (n >= MAX_LIVE_UNWRAPS) {
      value = "**Error:** Widget nesting too deep (widget.live)";
      break;
    }
    onLive(live.refreshOn);
    value = live.value;
  }
  return planUnwrapped(value, globalEnv);
}

function planUnwrapped(raw: unknown, globalEnv: LuaEnv): ValuePlan {
  if (raw === null || raw === undefined || isSqlNull(raw)) {
    return { kind: "empty" };
  }
  if (isViewValue(raw)) return { kind: "view", view: raw };
  const value = toJSWidget(raw, globalEnv);
  if (isWidgetValue(value)) {
    const w = value as any;
    if (isFragmentValue(w)) {
      const slots: SlotTable = [];
      const markdown = flattenItems(fragmentParts(w), slots, "");
      return {
        kind: "markdown",
        markdown,
        slots,
        block: displayBlock(w),
        cssClasses: w.cssClasses,
        events: w.events,
      };
    }
    if (w.sandbox) return { kind: "sandbox", widget: w };
    if (w.html) {
      return {
        kind: "html",
        html: w.html,
        block: w.display === "block",
        copyMarkdown: typeof w.markdown === "string" ? w.markdown : "",
        cssClasses: w.cssClasses,
        events: w.events,
      };
    }
    if (typeof w.markdown === "string") {
      return w.evaluate === false
        ? {
            kind: "literal",
            markdown: w.markdown,
            block: displayBlock(w),
            cssClasses: w.cssClasses,
          }
        : {
            kind: "markdown",
            markdown: w.markdown,
            slots: [],
            block: displayBlock(w),
            cssClasses: w.cssClasses,
            events: w.events,
          };
    }
    return { kind: "empty", widget: true };
  }
  if (isDomNode(value)) {
    return {
      kind: "html",
      html: value as HTMLElement,
      block: false,
      copyMarkdown: "",
    };
  }
  const c = classifyResult(value);
  if (c.kind === "contentList") {
    const slots: SlotTable = [];
    const markdown = flattenItems(c.items, slots, "\n");
    return { kind: "markdown", markdown, slots, raw: value };
  }
  if (c.kind === "record" || c.kind === "recordArray") {
    const slots: SlotTable = [];
    const markdown = buildResultTableMarkdown(c, (v) =>
      isDomNode(v) || containsWidget(v) ? addSlot(slots, v) : undefined,
    );
    return { kind: "markdown", markdown, slots, block: true, raw: value };
  }
  const { markdown, dataType } = renderResultToMarkdown(value, c);
  const block =
    dataType === "table" ||
    dataType === "list" ||
    (typeof value === "string" && isBlockMarkdown(value))
      ? true
      : undefined;
  return { kind: "markdown", markdown, slots: [], block, raw: value };
}
