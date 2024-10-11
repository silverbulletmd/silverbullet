import {
  type ILuaFunction,
  LuaBuiltinFunction,
  LuaEnv,
  LuaMultiRes,
  type LuaTable,
  luaToString,
  luaTypeOf,
  type LuaValue,
} from "$common/space_lua/runtime.ts";
import { stringApi } from "$common/space_lua/stdlib/string.ts";
import { tableApi } from "$common/space_lua/stdlib/table.ts";
import { osApi } from "$common/space_lua/stdlib/os.ts";
import { jsApi } from "$common/space_lua/stdlib/js.ts";

const printFunction = new LuaBuiltinFunction((...args) => {
  console.log("[Lua]", ...args.map(luaToString));
});

const assertFunction = new LuaBuiltinFunction(
  async (value: any, message?: string) => {
    if (!await value) {
      throw new Error(`Assertion failed: ${message}`);
    }
  },
);

const ipairsFunction = new LuaBuiltinFunction((ar: LuaTable) => {
  let i = 1;
  return () => {
    if (i > ar.length) {
      return;
    }
    const result = new LuaMultiRes([i, ar.get(i)]);
    i++;
    return result;
  };
});

const pairsFunction = new LuaBuiltinFunction((t: LuaTable) => {
  const keys = t.keys();
  let i = 0;
  return () => {
    if (i >= keys.length) {
      return;
    }
    const key = keys[i];
    i++;
    return new LuaMultiRes([key, t.get(key)]);
  };
});

const unpackFunction = new LuaBuiltinFunction((t: LuaTable) => {
  const values: LuaValue[] = [];
  for (let i = 1; i <= t.length; i++) {
    values.push(t.get(i));
  }
  return new LuaMultiRes(values);
});

const typeFunction = new LuaBuiltinFunction((value: LuaValue): string => {
  return luaTypeOf(value);
});

const tostringFunction = new LuaBuiltinFunction((value: any) => {
  return luaToString(value);
});

const tonumberFunction = new LuaBuiltinFunction((value: LuaValue) => {
  return Number(value);
});

const errorFunction = new LuaBuiltinFunction((message: string) => {
  throw new Error(message);
});

const pcallFunction = new LuaBuiltinFunction(
  async (fn: ILuaFunction, ...args) => {
    try {
      return new LuaMultiRes([true, await fn.call(...args)]);
    } catch (e: any) {
      return new LuaMultiRes([false, e.message]);
    }
  },
);

const xpcallFunction = new LuaBuiltinFunction(
  async (fn: ILuaFunction, errorHandler: ILuaFunction, ...args) => {
    try {
      return new LuaMultiRes([true, await fn.call(...args)]);
    } catch (e: any) {
      return new LuaMultiRes([false, await errorHandler.call(e.message)]);
    }
  },
);

const setmetatableFunction = new LuaBuiltinFunction(
  (table: LuaTable, metatable: LuaTable) => {
    table.metatable = metatable;
    return table;
  },
);

const rawsetFunction = new LuaBuiltinFunction(
  (table: LuaTable, key: LuaValue, value: LuaValue) => {
    table.rawSet(key, value);
    return table;
  },
);

const getmetatableFunction = new LuaBuiltinFunction((table: LuaTable) => {
  return table.metatable;
});

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

  // APIs
  env.set("string", stringApi);
  env.set("table", tableApi);
  env.set("os", osApi);
  env.set("js", jsApi);
  return env;
}
