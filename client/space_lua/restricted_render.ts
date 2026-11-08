import { isSqlNull } from "./sliq_null.ts";
import { isTaggedFloat } from "./numeric.ts";
import { LuaMultiRes, LuaTable } from "./runtime.ts";

const trusted = new WeakMap<object, unknown>();

export function opaqueRenderValue(value: unknown): object {
  const token = Object.freeze(Object.create(null));
  trusted.set(token, value);
  return token;
}

export function restrictedRenderValue(
  value: any,
  depth = 0,
  budget = { nodes: 10000 },
): any {
  if (--budget.nodes < 0 || depth > 40)
    throw new Error("Restricted result is too large");
  if (value instanceof LuaMultiRes)
    return restrictedRenderValue(value.unwrap(), depth, budget);
  if (value && typeof value === "object" && trusted.has(value))
    return trusted.get(value);
  if (
    value == null ||
    isSqlNull(value) ||
    isTaggedFloat(value) ||
    ["string", "boolean", "number"].includes(typeof value)
  )
    return value;
  if (
    !(value instanceof LuaTable) ||
    value.metatable ||
    value.rawGet("_isWidget") === true
  ) {
    throw new Error("Only installed widgets and plain data may be rendered");
  }
  const result = new LuaTable();
  for (const key of value.keys()) {
    if (typeof key !== "string" && typeof key !== "number")
      throw new Error("Invalid result key");
    void result.rawSet(
      key,
      restrictedRenderValue(value.rawGet(key), depth + 1, budget),
    );
  }
  return result;
}
