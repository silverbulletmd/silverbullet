import { isTaggedFloat } from "./numeric.ts";
import type { LuaQueryCollection } from "./query_collection.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaFunction,
  LuaMultiRes,
  LuaNativeJSFunction,
  LuaStackFrame,
  LuaTable,
} from "./runtime.ts";
import { isSqlNull } from "./sliq_null.ts";
import { isPromise } from "./rp.ts";

export type RuntimeJSON =
  | null
  | boolean
  | number
  | string
  | RuntimeJSON[]
  | { [key: string]: RuntimeJSON };

// CDP gives up around 1000 levels; stay well below it.
const maxDepth = 200;

/** Rows a materialized query collection returns before it is cut off. */
export const maxCollectionRows = 1000;

export type RuntimeJSONOptions = {
  /** Environment and frame query collections are evaluated in. */
  env?: LuaEnv;
  sf?: LuaStackFrame;
  maxCollectionRows?: number;
};

type Context = {
  env: LuaEnv;
  sf: LuaStackFrame;
  maxCollectionRows: number;
};

/**
 * Convert a Lua (or JS) value into plain JSON for callers outside the page,
 * such as the runtime API, whose transport (CDP `returnByValue`) rejects
 * symbols and BigInt and silently turns functions, Dates and Maps into `{}`.
 */
export function toRuntimeJSON(
  value: unknown,
  options: RuntimeJSONOptions = {},
): Promise<RuntimeJSON> {
  const env = options.env ?? new LuaEnv();
  const ctx: Context = {
    env,
    sf: options.sf ?? LuaStackFrame.createWithGlobalEnv(env),
    maxCollectionRows: options.maxCollectionRows ?? maxCollectionRows,
  };
  return convert(value, ctx, new Set(), 0);
}

async function convert(
  value: unknown,
  ctx: Context,
  ancestors: Set<object>,
  depth: number,
): Promise<RuntimeJSON> {
  if (isPromise(value)) {
    value = await value;
  }
  if (value instanceof LuaMultiRes) {
    value = value.unwrap();
  }
  if (value === null || value === undefined || isSqlNull(value)) {
    return null;
  }
  if (isTaggedFloat(value)) {
    value = value.value;
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return numberToJSON(value);
    case "bigint":
      return Number.isSafeInteger(Number(value))
        ? Number(value)
        : value.toString();
    case "symbol":
      return "<symbol>";
    case "function":
      return "<function>";
  }
  if (
    value instanceof LuaFunction ||
    value instanceof LuaBuiltinFunction ||
    value instanceof LuaNativeJSFunction
  ) {
    return "<function>";
  }
  const obj = value as object;
  if (obj instanceof Date) {
    return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  }
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    return `<binary: ${obj.byteLength} bytes>`;
  }
  if (obj instanceof Error) {
    return `<error: ${obj.message}>`;
  }
  if (ancestors.has(obj)) {
    return "<cycle>";
  }
  if (depth >= maxDepth) {
    return "<max depth>";
  }
  ancestors.add(obj);
  try {
    const child = (v: unknown) => convert(v, ctx, ancestors, depth + 1);
    if (obj instanceof LuaTable) {
      return await luaTableToJSON(obj, child);
    }
    if (Array.isArray(obj) || obj instanceof Set) {
      const out: RuntimeJSON[] = [];
      for (const v of obj) {
        out.push(await child(v));
      }
      return out;
    }
    if (obj instanceof Map) {
      const out: Record<string, RuntimeJSON> = {};
      for (const [k, v] of obj) {
        out[keyToString(k)] = await child(v);
      }
      return out;
    }
    if (typeof (obj as any).query === "function") {
      return await collectionToJSON(obj as LuaQueryCollection, ctx, child);
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return `<${proto?.constructor?.name || "object"}>`;
    }
    const out: Record<string, RuntimeJSON> = {};
    for (const k of Object.keys(obj)) {
      out[k] = await child((obj as any)[k]);
    }
    return out;
  } finally {
    ancestors.delete(obj);
  }
}

async function collectionToJSON(
  collection: LuaQueryCollection,
  ctx: Context,
  child: (v: unknown) => Promise<RuntimeJSON>,
): Promise<RuntimeJSON> {
  const rows = await collection.query({}, ctx.env, ctx.sf);
  const out: RuntimeJSON[] = [];
  for (const row of rows.slice(0, ctx.maxCollectionRows)) {
    out.push(await child(row));
  }
  const rest = rows.length - out.length;
  if (rest > 0) {
    out.push(`<truncated: ${rest} more rows; use sb query with where/limit>`);
  }
  return out;
}

async function luaTableToJSON(
  table: LuaTable,
  child: (v: unknown) => Promise<RuntimeJSON>,
): Promise<RuntimeJSON> {
  const keys = table.keys();
  const length = table.length;
  // Only a pure sequence becomes an array; a mixed table becomes an object so
  // its string keys are not dropped.
  const isSequenceKey = (k: unknown) =>
    typeof k === "number" &&
    Number.isInteger(k) &&
    k >= 1 &&
    (k <= length || isNil(table.rawGet(k)));
  if (length > 0 && keys.every(isSequenceKey)) {
    const out: RuntimeJSON[] = [];
    for (let i = 1; i <= length; i++) {
      out.push(await child(table.rawGet(i)));
    }
    return out;
  }
  const out: Record<string, RuntimeJSON> = {};
  for (const k of keys) {
    out[keyToString(k)] = await child(table.rawGet(k));
  }
  return out;
}

function isNil(v: unknown): boolean {
  return v === null || v === undefined || isSqlNull(v);
}

function numberToJSON(n: number): number | string {
  if (Number.isNaN(n)) {
    return "NaN";
  }
  if (n === Number.POSITIVE_INFINITY) {
    return "Infinity";
  }
  if (n === Number.NEGATIVE_INFINITY) {
    return "-Infinity";
  }
  // JSON has no -0; normalize so the value round-trips unchanged.
  return n === 0 ? 0 : n;
}

function keyToString(k: unknown): string {
  if (isTaggedFloat(k)) {
    k = k.value;
  }
  switch (typeof k) {
    case "string":
      return k;
    case "number":
    case "boolean":
    case "bigint":
      return String(k);
    default:
      return `<${k instanceof LuaTable ? "table" : typeof k} key>`;
  }
}
