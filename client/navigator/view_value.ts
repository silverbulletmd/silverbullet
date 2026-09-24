import { LuaTable, luaTypeOf } from "../space_lua/runtime.ts";
import { type ViewSpec, validateViewSpec, wireMeta } from "./lua_views.ts";
import type { ViewMeta } from "./types.ts";

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
  "openOnStart",
  "refreshOnOpen",
  "followEditor",
  "ephemeral",
]);

function field(spec: ViewSpec, key: string): unknown {
  return spec instanceof LuaTable ? spec.rawGet(key) : spec[key];
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

export class ViewValue extends LuaTable {
  constructor(
    readonly spec: ViewSpec,
    readonly meta: ViewMeta,
    readonly stateKey: string | undefined,
    readonly selectable: boolean,
  ) {
    super();
  }
}

export function isViewValue(value: unknown): value is ViewValue {
  return value instanceof ViewValue;
}

export function newView(spec: ViewSpec): ViewValue {
  if (luaTypeOf(spec) !== "table") {
    throw new Error("view.new: spec must be a table");
  }
  const captured =
    spec instanceof LuaTable
      ? new LuaTable(Object.fromEntries(entries(spec)))
      : { ...spec };
  for (const key of REGISTRATION_FIELDS) {
    if (key === "title") continue;
    if (field(captured, key) !== undefined && field(captured, key) !== null) {
      throw new Error(`view.new: ${key} is not allowed`);
    }
  }
  const stateKey = field(captured, "stateKey");
  if (
    stateKey !== undefined &&
    stateKey !== null &&
    (typeof stateKey !== "string" || stateKey.trim().length === 0)
  ) {
    throw new Error("view.new: stateKey must be a non-empty string");
  }
  const source = field(captured, "source");
  if (
    source !== undefined &&
    source !== null &&
    luaTypeOf(source) !== "function"
  ) {
    throw new Error("view.new: source must be a function");
  }
  const onSelect = field(captured, "onSelect");
  if (
    onSelect !== undefined &&
    onSelect !== null &&
    luaTypeOf(onSelect) !== "function"
  ) {
    throw new Error("view.new: onSelect must be a function");
  }
  try {
    validateViewSpec(captured, "view.new", false);
    return new ViewValue(
      captured,
      wireMeta(captured),
      stateKey as string | undefined,
      onSelect !== undefined && onSelect !== null,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("view.define:")) {
      throw new Error(error.message.replace(/^view\.define:/, "view.new:"));
    }
    throw error;
  }
}

export function normalizeDefineSpec(spec: ViewSpec): ViewSpec {
  if (luaTypeOf(spec) !== "table") {
    throw new Error("view.define: spec must be a table");
  }
  const view = field(spec, "view");
  if (view !== undefined && view !== null && !isViewValue(view)) {
    throw new Error("view.define: view must be a view.new value");
  }
  const explicit = isViewValue(view);
  const registration: Record<string, unknown> = {};
  const content: Record<string, unknown> = {};
  for (const [key, entry] of entries(spec)) {
    if (key === "view") continue;
    if (REGISTRATION_FIELDS.has(key)) {
      registration[key] = entry;
    } else if (explicit) {
      throw new Error(`view.define: '${key}' cannot be combined with 'view'`);
    } else {
      content[key] = entry;
    }
  }
  let value: ViewValue;
  if (explicit) {
    value = view;
  } else {
    try {
      value = newView(content);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("view.new:")) {
        throw new Error(error.message.replace(/^view\.new:/, "view.define:"));
      }
      throw error;
    }
  }
  return new LuaTable({
    ...Object.fromEntries(entries(value.spec)),
    ...registration,
  });
}
