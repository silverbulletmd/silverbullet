import { isILuaFunction, LuaTable } from "../../space_lua/runtime.ts";

export type ValueKind =
  | "nil"
  | "string"
  | "number"
  | "boolean"
  | "table"
  | "array"
  | "object"
  | "function"
  | "error"
  | "other";

export type ValueChildren = {
  entries: [string, unknown][];
  more: number;
};

export function valueKind(v: unknown): ValueKind {
  if (v === null || v === undefined) return "nil";
  if (v instanceof LuaTable) return "table";
  if (isILuaFunction(v)) return "function";
  if (Array.isArray(v)) return "array";
  if (v instanceof Error) return "error";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "object":
      return "object";
    default:
      return "other";
  }
}

/**
 * A value with children, read the same way whatever holds them: a Lua table,
 * a JS array or a plain object. `list` is true for an array or a Lua table
 * whose keys are exactly 1..n.
 */
export type Container = {
  list: boolean;
  size: number;
  keys(start: number, end: number): unknown[];
  get(key: unknown): unknown;
};

export function container(v: unknown): Container | null {
  if (v instanceof LuaTable) {
    const keys = v.keys();
    return {
      list:
        keys.length === v.length && keys.every((k) => typeof k === "number"),
      size: keys.length,
      keys: (start, end) => keys.slice(start, end),
      get: (k) => v.rawGet(k as string | number),
    };
  }
  if (Array.isArray(v)) {
    return {
      list: true,
      size: v.length,
      // Only the indices asked for, so huge arrays stay cheap to preview and page
      keys: (start, end) => {
        const keys: number[] = [];
        for (let i = start; i < end; i++) keys.push(i);
        return keys;
      },
      get: (k) => v[k as number],
    };
  }
  if (valueKind(v) === "object") {
    const record = v as Record<string, unknown>;
    const keys = Object.keys(record);
    return {
      list: false,
      size: keys.length,
      keys: (start, end) => keys.slice(start, end),
      get: (k) => record[k as string],
    };
  }
  return null;
}

function describeError(e: unknown): string {
  return `<unrenderable: ${errorMessage(e)}>`;
}

export function errorMessage(e: unknown): string {
  try {
    return e instanceof Error ? e.message : String(e);
  } catch {
    return "unknown error";
  }
}

export function valueChildren(
  v: unknown,
  offset = 0,
  limit = 100,
): ValueChildren {
  try {
    const c = container(v);
    if (!c) return { entries: [], more: 0 };
    const start = Math.min(Math.max(0, offset), c.size);
    const end = Math.min(c.size, start + Math.max(0, limit));
    return {
      entries: c.keys(start, end).map((k): [string, unknown] => {
        try {
          return [String(k), c.get(k)];
        } catch (e) {
          return [String(k), describeError(e)];
        }
      }),
      more: c.size - end,
    };
  } catch (e) {
    return { entries: [["", describeError(e)]], more: 0 };
  }
}

// Items inside a list or record show only their first few fields
const NESTED_WIDTH = 2;
const MAX_STRING = 80;

export function previewValue(
  v: unknown,
  opts: { depth?: number; width?: number } = {},
): string {
  try {
    return preview(v, opts.depth ?? 2, opts.width ?? 5, new Set());
  } catch (e) {
    return describeError(e);
  }
}

function previewString(s: string): string {
  return s.length > MAX_STRING
    ? `${JSON.stringify(s.slice(0, MAX_STRING)).slice(0, -1)}…"`
    : JSON.stringify(s);
}

function preview(
  v: unknown,
  depth: number,
  width: number,
  seen: Set<unknown>,
): string {
  switch (valueKind(v)) {
    case "nil":
      return "nil";
    case "string":
      return previewString(v as string);
    case "number":
    case "boolean":
      return String(v);
    case "function":
      return "function";
    case "error": {
      const err = v as Error;
      return `${err.name}: ${err.message}`;
    }
    case "other":
      return String(v);
  }
  const c = container(v)!;
  if (seen.has(v)) return "<cycle>";
  if (depth <= 0) return c.list ? "[…]" : "{…}";
  seen.add(v);
  try {
    const shown = c.keys(0, Math.min(c.size, width)).map((k) => {
      let text: string;
      try {
        text = preview(
          c.get(k),
          depth - 1,
          Math.min(width, NESTED_WIDTH),
          seen,
        );
      } catch (e) {
        text = describeError(e);
      }
      return c.list ? text : `${String(k)}: ${text}`;
    });
    if (c.size > width) shown.push("…");
    const body = shown.join(", ");
    return c.list ? `(${c.size}) [${body}]` : `{${body}}`;
  } finally {
    seen.delete(v);
  }
}
