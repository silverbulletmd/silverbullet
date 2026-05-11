import { LuaEnv, luaGet, luaKeys, type LuaStackFrame } from "./runtime.ts";

function shouldExposeAllItemKeys(
  objectVariable: string | undefined,
  item: any,
): boolean {
  if (!objectVariable) return true;
  if (!(item && typeof item === "object")) return false;
  if (!(item instanceof Object)) return false;

  const keys = luaKeys(item).filter((k): k is string => typeof k === "string");
  if (keys.length === 0) return false;

  return (
    keys.includes(objectVariable) && keys.some((k) => k !== objectVariable)
  );
}

export function buildItemEnv(
  objectVariable: string | undefined,
  item: any,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaEnv {
  const itemEnv = new LuaEnv(env);
  const exposeAll = shouldExposeAllItemKeys(objectVariable, item);
  if (exposeAll) {
    for (const key of luaKeys(item)) {
      itemEnv.setLocal(key, luaGet(item, key, sf.astCtx ?? null, sf));
    }
    itemEnv.setLocal("_", item);
    if (objectVariable) {
      const obj = luaGet(item, objectVariable, sf.astCtx ?? null, sf);
      if (obj !== null && obj !== undefined) {
        itemEnv.setLocal(objectVariable, obj);
      }
    }
    return itemEnv;
  }
  if (!objectVariable) {
    for (const key of luaKeys(item)) {
      itemEnv.setLocal(key, luaGet(item, key, sf.astCtx ?? null, sf));
    }
    itemEnv.setLocal("_", item);
  } else {
    itemEnv.setLocal(objectVariable, item);
  }
  return itemEnv;
}
