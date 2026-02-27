import { LuaEnv, luaGet, luaKeys, type LuaStackFrame } from "./runtime.ts";

/**
 * Build an environment for evaluating per-item expressions in queries.
 * Extracted to its own module to avoid circular imports between
 * query_collection.ts and aggregates.ts.
 */
export function buildItemEnv(
  objectVariable: string | undefined,
  item: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaEnv {
  const itemEnv = new LuaEnv(env);
  if (!objectVariable) {
    // Inject all item keys as variables
    for (const key of luaKeys(item)) {
      itemEnv.setLocal(key, luaGet(item, key, sf.astCtx ?? null, sf));
    }
    // As well as _
    itemEnv.setLocal("_", item);
  } else {
    itemEnv.setLocal(objectVariable, item);
  }
  return itemEnv;
}
