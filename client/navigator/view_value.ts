import { LuaTable, luaTypeOf } from "../space_lua/runtime.ts";
import { hasViewMark, VIEW_VALUE_MARK } from "../space_lua/widget_marks.ts";
import type { ViewMeta } from "./types.ts";
import { type ViewSpec, validateViewSpec, wireMeta } from "./view_spec.ts";

const REGISTRATION_FIELDS = new Set([
  "name",
  "title",
  "command",
  "key",
  "mac",
  "menu",
  "menuMac",
  "menuWindows",
  "menuLinux",
  "hide",
  "dock",
  "supportedDocks",
  "defaultOpen",
  "frame",
  "openOnStart",
  "refreshOnOpen",
  "followEditor",
  "ephemeral",
]);

function field(spec: ViewSpec, key: string): unknown {
  return spec instanceof LuaTable ? spec.rawGet(key) : spec[key];
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function entries(spec: ViewSpec): [string, unknown][] {
  if (spec instanceof LuaTable) {
    return spec
      .keys()
      .filter((key): key is string => typeof key === "string")
      .map((key) => [key, spec.rawGet(key)]);
  }
  return Object.entries(spec);
}

export function isViewValue(value: unknown): value is ViewValue {
  return hasViewMark(value);
}

export class ViewValue extends LuaTable {
  readonly [VIEW_VALUE_MARK] = true;

  constructor(
    readonly spec: ViewSpec,
    readonly meta: ViewMeta,
    readonly stateKey: string | undefined,
    readonly selectable: boolean,
  ) {
    super();
  }

  // A live widget is a description, not data: converting it to a plain object
  // would silently empty it.
  override toJS(): any {
    return this;
  }
}

export function newView(spec: ViewSpec): ViewValue {
  if (luaTypeOf(spec) !== "table") {
    throw new Error("widget.new: spec must be a table");
  }
  const captured =
    spec instanceof LuaTable
      ? new LuaTable(Object.fromEntries(entries(spec)))
      : { ...spec };
  if (
    present(field(captured, "markdown")) ||
    present(field(captured, "html"))
  ) {
    throw new Error(
      "widget.new: source and content cannot be combined with markdown or html",
    );
  }
  for (const key of REGISTRATION_FIELDS) {
    if (key === "title") continue;
    if (field(captured, key) !== undefined && field(captured, key) !== null) {
      throw new Error(`widget.new: ${key} is not allowed`);
    }
  }
  const stateKey = field(captured, "stateKey");
  if (
    stateKey !== undefined &&
    stateKey !== null &&
    (typeof stateKey !== "string" || stateKey.trim().length === 0)
  ) {
    throw new Error("widget.new: stateKey must be a non-empty string");
  }
  const source = field(captured, "source");
  if (
    source !== undefined &&
    source !== null &&
    luaTypeOf(source) !== "function"
  ) {
    throw new Error("widget.new: source must be a function");
  }
  const onSelect = field(captured, "onSelect");
  if (
    onSelect !== undefined &&
    onSelect !== null &&
    luaTypeOf(onSelect) !== "function"
  ) {
    throw new Error("widget.new: onSelect must be a function");
  }
  try {
    validateViewSpec(captured, "widget.new", false);
    return new ViewValue(
      captured,
      wireMeta(captured),
      stateKey as string | undefined,
      onSelect !== undefined && onSelect !== null,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("view.define:")) {
      throw new Error(error.message.replace(/^view\.define:/, "widget.new:"));
    }
    throw error;
  }
}

export function normalizeDefineSpec(spec: ViewSpec): ViewSpec {
  if (luaTypeOf(spec) !== "table") {
    throw new Error("view.define: spec must be a table");
  }
  const legacy = field(spec, "view");
  if (legacy !== undefined && legacy !== null) {
    throw new Error("view.define: 'view' was renamed to 'widget'");
  }
  const widget = field(spec, "widget");
  if (widget !== undefined && widget !== null && !isViewValue(widget)) {
    throw new Error(
      "view.define: widget must be a live widget (source or content); return static widgets from content",
    );
  }
  const explicit = isViewValue(widget);
  const registration: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  for (const [key, entry] of entries(spec)) {
    if (key === "widget") continue;
    if (REGISTRATION_FIELDS.has(key)) {
      registration[key] = entry;
    } else if (explicit) {
      throw new Error(`view.define: '${key}' cannot be combined with 'widget'`);
    } else {
      content[key] = entry;
    }
  }
  let value: ViewValue;
  if (explicit) {
    value = widget;
  } else {
    try {
      value = newView(content);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("widget.new:")) {
        throw new Error(error.message.replace(/^widget\.new:/, "view.define:"));
      }
      throw error;
    }
  }
  return new LuaTable({
    ...Object.fromEntries(entries(value.spec)),
    ...registration,
  });
}
