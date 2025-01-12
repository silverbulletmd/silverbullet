import {
  type ILuaFunction,
  LuaBuiltinFunction,
  luaCall,
  LuaEnv,
  luaGet,
  LuaMultiRes,
  LuaRuntimeError,
  type LuaTable,
  luaToString,
  luaTypeOf,
  type LuaValue,
} from "$common/space_lua/runtime.ts";
import { stringApi } from "$common/space_lua/stdlib/string.ts";
import { tableApi } from "$common/space_lua/stdlib/table.ts";
import { osApi } from "$common/space_lua/stdlib/os.ts";
import { jsApi } from "$common/space_lua/stdlib/js.ts";
import { spaceLuaApi } from "$common/space_lua/stdlib/space_lua.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "$common/space_lua/query_collection.ts";

const printFunction = new LuaBuiltinFunction(async (_sf, ...args) => {
  console.log("[Lua]", ...(await Promise.all(args)));
});

const assertFunction = new LuaBuiltinFunction(
  async (sf, value: any, message?: string) => {
    if (!await value) {
      throw new LuaRuntimeError(`Assertion failed: ${message}`, sf);
    }
  },
);

const ipairsFunction = new LuaBuiltinFunction((sf, ar: LuaTable) => {
  let i = 1;
  return async () => {
    if (i > ar.length) {
      return;
    }
    const result = new LuaMultiRes([i, await luaGet(ar, i, sf)]);
    i++;
    return result;
  };
});

const pairsFunction = new LuaBuiltinFunction((sf, t: LuaTable) => {
  const keys = t.keys();
  let i = 0;
  return async () => {
    if (i >= keys.length) {
      return;
    }
    const key = keys[i];
    i++;
    return new LuaMultiRes([key, await luaGet(t, key, sf)]);
  };
});

const unpackFunction = new LuaBuiltinFunction(async (sf, t: LuaTable) => {
  const values: LuaValue[] = [];
  for (let i = 1; i <= t.length; i++) {
    values.push(await luaGet(t, i, sf));
  }
  return new LuaMultiRes(values);
});

const typeFunction = new LuaBuiltinFunction((_sf, value: LuaValue): string => {
  return luaTypeOf(value);
});

const tostringFunction = new LuaBuiltinFunction((_sf, value: any) => {
  return luaToString(value);
});

const tonumberFunction = new LuaBuiltinFunction((_sf, value: LuaValue) => {
  return Number(value);
});

const errorFunction = new LuaBuiltinFunction((sf, message: string) => {
  throw new LuaRuntimeError(message, sf);
});

const pcallFunction = new LuaBuiltinFunction(
  async (sf, fn: ILuaFunction, ...args) => {
    try {
      return new LuaMultiRes([true, await luaCall(fn, args, sf.astCtx!, sf)]);
    } catch (e: any) {
      if (e instanceof LuaRuntimeError) {
        return new LuaMultiRes([false, e.message]);
      }
      return new LuaMultiRes([false, e.message]);
    }
  },
);

const xpcallFunction = new LuaBuiltinFunction(
  async (sf, fn: ILuaFunction, errorHandler: ILuaFunction, ...args) => {
    try {
      return new LuaMultiRes([true, await fn.call(sf, ...args)]);
    } catch (e: any) {
      const errorMsg = e instanceof LuaRuntimeError ? e.message : e.message;
      return new LuaMultiRes([
        false,
        await luaCall(errorHandler, [errorMsg], sf.astCtx!, sf),
      ]);
    }
  },
);

const setmetatableFunction = new LuaBuiltinFunction(
  (_sf, table: LuaTable, metatable: LuaTable) => {
    table.metatable = metatable;
    return table;
  },
);

const rawsetFunction = new LuaBuiltinFunction(
  (_sf, table: LuaTable, key: LuaValue, value: LuaValue) => {
    table.rawSet(key, value);
    return table;
  },
);

const getmetatableFunction = new LuaBuiltinFunction((_sf, table: LuaTable) => {
  return table.metatable;
});

const tagFunction = new LuaBuiltinFunction(
  (sf, tagName: LuaValue): LuaQueryCollection => {
    const global = sf.threadLocal.get("_GLOBAL");
    if (!global) {
      throw new LuaRuntimeError("Global not found", sf);
    }
    return {
      query: async (query: LuaCollectionQuery): Promise<any[]> => {
        return (await global.get("datastore").get("query_lua").call(
          sf,
          [
            "idx",
            tagName,
          ],
          query,
        )).asJSArray();
      },
    };
  },
);

export function luaBuildStandardEnv() {
  const env = new LuaEnv();
  // Top-level builtins
  env.set("print", printFunction);
  env.set("assert", assertFunction);
  env.set("type", typeFunction);
  env.set("tostring", tostringFunction);
  env.set("tonumber", tonumberFunction);
  env.set("unpack", unpackFunction);
  // Iterators
  env.set("pairs", pairsFunction);
  env.set("ipairs", ipairsFunction);
  // meta table stuff
  env.set("setmetatable", setmetatableFunction);
  env.set("getmetatable", getmetatableFunction);
  env.set("rawset", rawsetFunction);
  // Error handling
  env.set("error", errorFunction);
  env.set("pcall", pcallFunction);
  env.set("xpcall", xpcallFunction);
  env.set("tag", tagFunction);
  // APIs
  env.set("string", stringApi);
  env.set("table", tableApi);
  env.set("os", osApi);
  env.set("js", jsApi);
  env.set("space_lua", spaceLuaApi);
  return env;
}
