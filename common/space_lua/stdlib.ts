import {
  type ILuaFunction,
  LuaBuiltinFunction,
  luaCall,
  LuaEnv,
  luaGet,
  LuaMultiRes,
  LuaRuntimeError,
  LuaTable,
  luaToString,
  luaTypeOf,
  type LuaValue,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";
import { stringApi } from "$common/space_lua/stdlib/string.ts";
import { tableApi } from "$common/space_lua/stdlib/table.ts";
import { osApi } from "$common/space_lua/stdlib/os.ts";
import { jsApi } from "$common/space_lua/stdlib/js.ts";
import { parse } from "$common/space_lua/parse.ts";
import type {
  LuaBlock,
  LuaFunctionCallStatement,
} from "$common/space_lua/ast.ts";
import { evalExpression } from "$common/space_lua/eval.ts";

const printFunction = new LuaBuiltinFunction(async (_sf, ...args) => {
  console.log("[Lua]", ...(await Promise.all(args.map(luaToString))));
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

/**
 * This is not standard Lua, but it's a useful feature for us
 */
const interpolateFunction = new LuaBuiltinFunction(
  async (sf, template: string, expandedEnv?: LuaTable) => {
    let result = "";
    let currentIndex = 0;

    while (true) {
      const startIndex = template.indexOf("${", currentIndex);
      if (startIndex === -1) {
        result += template.slice(currentIndex);
        break;
      }

      result += template.slice(currentIndex, startIndex);

      // Find matching closing brace by counting nesting
      let nestLevel = 1;
      let endIndex = startIndex + 2;
      while (nestLevel > 0 && endIndex < template.length) {
        if (template[endIndex] === "{") {
          nestLevel++;
        } else if (template[endIndex] === "}") {
          nestLevel--;
        }
        if (nestLevel > 0) {
          endIndex++;
        }
      }

      if (nestLevel > 0) {
        throw new LuaRuntimeError("Unclosed interpolation expression", sf);
      }

      const expr = template.slice(startIndex + 2, endIndex);
      try {
        const parsedLua = parse(`_(${expr})`) as LuaBlock;
        const parsedExpr =
          (parsedLua.statements[0] as LuaFunctionCallStatement).call
            .args[0];

        const globalEnv = sf.threadLocal.get("_GLOBAL");
        if (!globalEnv) {
          throw new Error("_GLOBAL not defined");
        }
        // Create a new env with the global env as the parent, augmented with the expandedEnv
        const env = new LuaEnv(globalEnv);
        if (expandedEnv) {
          // Iterate over the keys in the expandedEnv and set them in the new env
          for (const key of expandedEnv.keys()) {
            env.setLocal(key, expandedEnv.rawGet(key));
          }
        }
        const luaResult = luaValueToJS(
          await evalExpression(
            parsedExpr,
            env,
            sf,
          ),
        );
        result += luaToString(luaResult);
      } catch (e: any) {
        throw new LuaRuntimeError(
          `Error evaluating "${expr}": ${e.message}`,
          sf,
        );
      }

      currentIndex = endIndex + 1;
    }

    return result;
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
  // String interpolation
  env.set("interpolate", interpolateFunction);

  // APIs
  env.set("string", stringApi);
  env.set("table", tableApi);
  env.set("os", osApi);
  env.set("js", jsApi);
  return env;
}
