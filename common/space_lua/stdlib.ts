import {
  type ILuaFunction,
  LuaBuiltinFunction,
  luaCall,
  LuaEnv,
  luaGet,
  luaKeys,
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
import { spaceluaApi } from "$common/space_lua/stdlib/space_lua.ts";
import { mathApi } from "$common/space_lua/stdlib/math.ts";
import { parse } from "$common/space_lua/parse.ts";
import { evalStatement } from "$common/space_lua/eval.ts";

const printFunction = new LuaBuiltinFunction(async (_sf, ...args) => {
  console.log(
    "[Lua]",
    ...(await Promise.all(args.map((v) => luaToString(v)))),
  );
});

const assertFunction = new LuaBuiltinFunction(
  async (sf, value: any, message?: string) => {
    if (!await value) {
      throw new LuaRuntimeError(`Assertion failed: ${message}`, sf);
    }
  },
);

const ipairsFunction = new LuaBuiltinFunction((sf, ar: LuaTable | any[]) => {
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

const pairsFunction = new LuaBuiltinFunction(
  (sf, t: LuaTable | any[] | Record<string, any>) => {
    let keys: (string | number)[];
    if (Array.isArray(t)) {
      keys = Array.from({ length: t.length }, (_, i) => i + 1); // For arrays, generate 1-based indices
    } else if (t.keys) {
      keys = t.keys();
    } else {
      // For plain JavaScript objects case, note: this will also include keys from the prototype
      keys = [];
      for (const key in t) {
        keys.push(key);
      }
    }

    let i = 0;
    return async () => {
      if (i >= keys.length) {
        return;
      }
      const key = keys[i];
      i++;
      const value = await luaGet(t, key, sf);
      return new LuaMultiRes([key, value]);
    };
  },
);

export const eachFunction = new LuaBuiltinFunction(
  (sf, ar: LuaTable | any[]) => {
    let i = 1;
    const length = ar.length;
    return async () => {
      if (i > length) {
        return;
      }
      const result = await luaGet(ar, i, sf);
      i++;
      return result;
    };
  },
);

const unpackFunction = new LuaBuiltinFunction(async (sf, t: LuaTable) => {
  const values: LuaValue[] = [];
  for (let i = 1; i <= t.length; i++) {
    values.push(await luaGet(t, i, sf));
  }
  return new LuaMultiRes(values);
});

const typeFunction = new LuaBuiltinFunction(
  (_sf, value: LuaValue): string | Promise<string> => {
    return luaTypeOf(value);
  },
);

const tostringFunction = new LuaBuiltinFunction((_sf, value: any) => {
  return luaToString(value);
});

const tonumberFunction = new LuaBuiltinFunction(
  (_sf, value: LuaValue, base?: number) => {
    if (typeof value === "string" && value.trim() === "") {
      return null;
    }
    if (base !== undefined) {
      if (base < 2 || base > 36) {
        return null;
      }
      const n = parseInt(String(value), base);
      if (isNaN(n)) {
        return null;
      }
      return n;
    }
    const n = Number(value);
    if (isNaN(n)) {
      return null;
    }
    return n;
  },
);

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
  (sf, table: LuaTable, metatable: LuaTable) => {
    if (!metatable) {
      throw new LuaRuntimeError("metatable cannot be set to nil", sf);
    }
    table.metatable = metatable;
    return table;
  },
);

const rawsetFunction = new LuaBuiltinFunction(
  (_sf, table: LuaTable, key: LuaValue, value: LuaValue) => {
    return table.rawSet(key, value);
  },
);

const getmetatableFunction = new LuaBuiltinFunction((_sf, table: LuaTable) => {
  return table.metatable;
});

const dofileFunction = new LuaBuiltinFunction(async (sf, filename: string) => {
  const global = sf.threadLocal.get("_GLOBAL");
  const file = await luaCall(
    global.get("space").get("readFile"),
    [filename],
    sf.astCtx!,
    sf,
  ) as Uint8Array;
  const code = new TextDecoder().decode(file);
  try {
    const parsedExpr = parse(code);
    const env = new LuaEnv(global);
    await evalStatement(parsedExpr, env, sf.withCtx(parsedExpr.ctx));
  } catch (e: any) {
    throw new LuaRuntimeError(
      `Error evaluating "${filename}": ${e.message}`,
      sf,
    );
  }
});

const someFunction = new LuaBuiltinFunction(async (_sf, value: any) => {
  switch (await luaTypeOf(value)) {
    case "number":
      if (!isFinite(value)) return null;
      break;
    case "string":
      if (value.trim() === "") return null;
      break;
    case "table":
      if (luaKeys(value).length === 0) return null;
  }
  return value;
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
  env.set("dofile", dofileFunction);
  // Error handling
  env.set("error", errorFunction);
  env.set("pcall", pcallFunction);
  env.set("xpcall", xpcallFunction);
  // APIs
  env.set("string", stringApi);
  env.set("table", tableApi);
  env.set("os", osApi);
  env.set("js", jsApi);
  env.set("math", mathApi);
  // Non-standard
  env.set("each", eachFunction);
  env.set("spacelua", spaceluaApi);
  env.set("some", someFunction);
  return env;
}
