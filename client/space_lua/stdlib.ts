import {
  type ILuaFunction,
  isILuaFunction,
  isLuaTable,
  LuaBuiltinFunction,
  luaCall,
  luaCloseFromMark,
  luaEnsureCloseStack,
  LuaEnv,
  luaGet,
  luaKeys,
  luaLen,
  LuaMultiRes,
  LuaRuntimeError,
  type LuaStackFrame,
  type LuaTable,
  luaToString,
  luaTypeOf,
  type LuaValue,
} from "./runtime.ts";
import { stringApi } from "./stdlib/string.ts";
import { tableApi } from "./stdlib/table.ts";
import { osApi } from "./stdlib/os.ts";
import { jsApi } from "./stdlib/js.ts";
import { spaceluaApi } from "./stdlib/space_lua.ts";
import { mathApi } from "./stdlib/math.ts";
import { parse } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { encodingApi } from "./stdlib/encoding.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaLoad } from "./stdlib/load.ts";
import { cryptoApi } from "./stdlib/crypto.ts";
import { netApi } from "./stdlib/net.ts";
import { makeLuaFloat } from "./numeric.ts";

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

const ipairsFunction = new LuaBuiltinFunction((sf, t: LuaTable | any[]) => {
  let i = 0;

  return async () => {
    i = i + 1;

    const v = await luaGet(t, i, sf.astCtx ?? null, sf);
    if (v === null || v === undefined) {
      return;
    }

    return new LuaMultiRes([i, v]);
  };
});

const pairsFunction = new LuaBuiltinFunction(
  (sf, t: LuaTable | any[] | Record<string, any>) => {
    // Respect `__pairs` metamethod for Lua tables
    if (isLuaTable(t)) {
      const mt = (t as any).metatable as LuaTable | null | undefined;
      if (mt) {
        const mm = mt.get("__pairs", sf);
        if (mm && (typeof mm === "function" || isILuaFunction(mm))) {
          // __pairs must return (iter, state, control, closing)
          return luaCall(mm, [t], sf.astCtx ?? {}, sf);
        }
      }
    }

    let keys: (string | number)[];
    if (Array.isArray(t)) {
      keys = Array.from({ length: t.length }, (_, i) => i + 1); // For arrays, generate 1-based indices
    } else if (isLuaTable(t) || t instanceof LuaEnv) {
      keys = t.keys();
    } else {
      // For plain JavaScript objects case, note: this will also include keys from the prototype
      keys = [];
      for (const key in t) {
        keys.push(key);
      }
    }

    let i = 0;
    const iter = async () => {
      if (i >= keys.length) {
        return;
      }
      const key = keys[i];
      i++;
      const value = await luaGet(t, key, sf.astCtx ?? null, sf);
      return new LuaMultiRes([key, value]);
    };

    // Must return (iter, state, control) for generic for
    return new LuaMultiRes([iter, t, null]);
  },
);

export const eachFunction = new LuaBuiltinFunction(
  (sf, ar: LuaTable | any[]) => {
    let i = 1;
    const length = (ar as any).length;
    return async () => {
      if (i > length) {
        return;
      }
      const result = await luaGet(ar, i, sf.astCtx ?? null, sf);
      i++;
      return result;
    };
  },
);

const unpackFunction = new LuaBuiltinFunction(async (sf, t: LuaTable) => {
  const values: LuaValue[] = [];
  for (let i = 1; i <= (t as any).length; i++) {
    values.push(await luaGet(t, i, sf.astCtx ?? null, sf));
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
  (sf, value: LuaValue, base?: number) => {
    if (base !== undefined) {
      if (!(typeof base === "number" && base >= 2 && base <= 36)) {
        throw new LuaRuntimeError(
          "bad argument #2 to 'tonumber' (base out of range)",
          sf,
        );
      }
    }

    if (typeof value === "number" || value instanceof Number) {
      return value;
    }

    if (typeof value !== "string") {
      return null;
    }

    const result = luaToNumberDetailed(value, base);
    if (result === null) {
      return null;
    }

    if (result.numericType === "float") {
      return makeLuaFloat(result.value);
    }

    return result.value;
  },
);

const errorFunction = new LuaBuiltinFunction((sf, message: string) => {
  throw new LuaRuntimeError(message, sf);
});

async function pcallBoundary(
  sf: LuaStackFrame,
  fn: ILuaFunction,
  args: LuaValue[],
): Promise<
  | { ok: true; values: LuaValue[] }
  | { ok: false; message: string }
> {
  const closeStack = luaEnsureCloseStack(sf);
  const mark = closeStack.length;

  const errMsgOf = (e: any): string =>
    e instanceof LuaRuntimeError ? e.message : (e?.message ?? String(e));

  try {
    const r = await luaCall(fn, args, sf.astCtx!, sf);
    await luaCloseFromMark(sf, mark, null);
    const values = r instanceof LuaMultiRes ? r.flatten().values : [r];
    return { ok: true, values };
  } catch (e: any) {
    const msg = errMsgOf(e);
    try {
      await luaCloseFromMark(sf, mark, msg);
      return { ok: false, message: msg };
    } catch (closeErr: any) {
      return { ok: false, message: errMsgOf(closeErr) };
    }
  }
}

const pcallFunction = new LuaBuiltinFunction(
  async (sf, fn: ILuaFunction, ...args) => {
    // To-be-closed variables must be closed when unwinding to the
    // protected call boundary. Space Lua uses a per-thread close
    // stack, so we snapshot its length and close anything pushed
    // after that.
    //
    // The protected call boundary must be established *before*
    // evaluating the function and its arguments.  Otherwise, any
    // `<close>` locals created while evaluating `pcall`'s arguments
    // will be wrongly treated as "inside" the protected call, and
    // `pcall` may end up closing them (or affecting close ordering).
    //
    // `threadState` is read-only on the stack frame; do not reassign!
    const res = await pcallBoundary(sf, fn, args);
    if (res.ok) {
      return new LuaMultiRes([true, ...res.values]);
    }
    return new LuaMultiRes([false, res.message]);
  },
);

const xpcallFunction = new LuaBuiltinFunction(
  async (sf, fn: ILuaFunction, errorHandler: ILuaFunction, ...args) => {
    // Same semantic as `pcall` (see comments there)
    const res = await pcallBoundary(sf, fn, args);
    if (res.ok) {
      return new LuaMultiRes([true, ...res.values]);
    }
    const hr = await luaCall(errorHandler, [res.message], sf.astCtx!, sf);
    const outVals = hr instanceof LuaMultiRes ? hr.flatten().values : [hr];
    return new LuaMultiRes([false, ...outVals]);
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

const rawlenFunction = new LuaBuiltinFunction(
  (_sf, value: LuaValue) => {
    return luaLen(value, _sf);
  },
);

const rawsetFunction = new LuaBuiltinFunction(
  (_sf, table: LuaTable, key: LuaValue, value: LuaValue) => {
    return (table as any).rawSet(key, value);
  },
);

const rawgetFunction = new LuaBuiltinFunction(
  (_sf, table: any, key: LuaValue) => {
    const isArray = Array.isArray(table);

    const isPlainObj = typeof table === "object" &&
      table !== null &&
      (table as any).constructor === Object;

    if (!isLuaTable(table) && !isArray && !isPlainObj) {
      let typeName = "userdata";
      if (table === null || table === undefined) {
        typeName = "nil";
      } else if (typeof table === "boolean") {
        typeName = "boolean";
      } else if (typeof table === "number" || table instanceof Number) {
        typeName = "number";
      } else if (typeof table === "string") {
        typeName = "string";
      } else if (
        typeof table === "function" ||
        (typeof table === "object" &&
          table !== null &&
          typeof (table as any).call === "function")
      ) {
        typeName = "function";
      }
      throw new LuaRuntimeError(
        `bad argument #1 to 'rawget' (table expected, got ${typeName})`,
        _sf,
      );
    }

    if (isLuaTable(table)) {
      const v = table.rawGet(key);
      return v === undefined ? null : v;
    }

    const k = key instanceof Number ? Number(key) : key;

    if (isArray) {
      if (typeof k === "number") {
        const v = (table as any[])[k - 1];
        return v === undefined ? null : v;
      }
      const v = (table as Record<string, any>)[k];
      return v === undefined ? null : v;
    }

    const v = (table as Record<string | number, any>)[k as any];
    return v === undefined ? null : v;
  },
);

const rawequalFunction = new LuaBuiltinFunction(
  (_sf, a: any, b: any) => {
    const av = a instanceof Number ? Number(a) : a;
    const bv = b instanceof Number ? Number(b) : b;
    return av === bv;
  },
);

const getmetatableFunction = new LuaBuiltinFunction((_sf, table: LuaTable) => {
  return (table as any).metatable;
});

const dofileFunction = new LuaBuiltinFunction(async (sf, filename: string) => {
  const global = sf.threadLocal.get("_GLOBAL") as LuaEnv;
  const file = await luaCall(
    (global.get("space") as any).get("readFile"),
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

/**
 * From the Lua docs:
 *
 * If index is a number, returns all arguments after argument number
 * index; a negative number indexes from the end (-1 is the last
 * argument). Otherwise, index must be the string "#", and select
 * returns the total number of extra arguments it received.
 */
const selectFunction = new LuaBuiltinFunction(
  (_sf, index: number | "#", ...args: LuaValue[]) => {
    if (index === "#") {
      return args.length;
    }
    if (typeof index === "number") {
      if (index >= 0) {
        return new LuaMultiRes(args.slice(index - 1));
      }
      return new LuaMultiRes(args.slice(args.length + index));
    }
  },
);

/**
 * From the Lua docs:
 *
 * Allows a program to traverse all fields of a table. Its first
 * argument is a table and its second argument is an index in this
 * table. A call to next returns the next index of the table and its
 * associated value. When called with nil as its second argument, next
 * returns an initial index and its associated value. When called with
 * the last index, or with nil in an empty table, next returns nil. If
 * the second argument is absent, then it is interpreted as nil. In
 * particular, you can use next(t) to check whether a table is empty.
 *
 * The order in which the indices are enumerated is not specified, even
 * for numeric indices. (To traverse a table in numerical order, use
 * a numerical for.)
 *
 * You should not assign any value to a non-existent field in a table
 * during its traversal. You may however modify existing fields. In
 * particular, you may set existing fields to nil.
 */
const nextFunction = new LuaBuiltinFunction(
  (sf, table: LuaTable | Record<string, any>, index: number | null = null) => {
    if (!table) {
      // When nil value
      return null;
    }
    const keys = luaKeys(table);

    // Empty table -> null return value
    if (keys.length === 0) {
      return null;
    }

    if (index === null) {
      // Return the first key, value
      const key = keys[0];
      return new LuaMultiRes([key, luaGet(table, key, sf.astCtx ?? null, sf)]);
    }
    // Find index in the key list
    const idx = keys.indexOf(index);
    if (idx === -1) { // Not found
      throw new LuaRuntimeError("invalid key to 'next': key not found", sf);
    }
    const key = keys[idx + 1];
    if (key === undefined) {
      // When called with the last key, should return nil
      return null;
    }
    return new LuaMultiRes([key, luaGet(table, key, sf.astCtx ?? null, sf)]);
  },
);

// Non-standard, but useful
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

const loadFunction = new LuaBuiltinFunction((sf, s) => luaLoad(s, sf));

export function luaBuildStandardEnv() {
  const env = new LuaEnv();
  // _G global
  env.set("_G", env);
  // Top-level builtins
  env.set("print", printFunction);
  env.set("assert", assertFunction);
  env.set("type", typeFunction);
  env.set("tostring", tostringFunction);
  env.set("tonumber", tonumberFunction);
  env.set("unpack", unpackFunction);
  env.set("select", selectFunction);
  env.set("next", nextFunction);
  // Iterators
  env.set("pairs", pairsFunction);
  env.set("ipairs", ipairsFunction);
  // meta table stuff
  env.set("setmetatable", setmetatableFunction);
  env.set("getmetatable", getmetatableFunction);
  env.set("rawlen", rawlenFunction);
  env.set("rawset", rawsetFunction);
  env.set("rawget", rawgetFunction);
  env.set("rawequal", rawequalFunction);
  env.set("dofile", dofileFunction);
  // Error handling
  env.set("error", errorFunction);
  env.set("pcall", pcallFunction);
  env.set("xpcall", xpcallFunction);
  // Evaluation
  env.set("load", loadFunction);
  // APIs
  env.set("string", stringApi);
  env.set("table", tableApi);
  env.set("os", osApi);
  env.set("js", jsApi);
  env.set("math", mathApi);
  // Non-standard
  env.set("each", eachFunction);
  env.set("spacelua", spaceluaApi);
  env.set("encoding", encodingApi);
  env.set("crypto", cryptoApi);
  env.set("net", netApi);
  env.set("some", someFunction);
  return env;
}
