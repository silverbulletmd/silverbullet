import {
  getMetatable,
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
  LuaTable,
  luaToString,
  luaTypeOf,
  type LuaValue,
  singleResult,
} from "./runtime.ts";
import { stringApi } from "./stdlib/string.ts";
import { tableApi } from "./stdlib/table.ts";
import { osApi } from "./stdlib/os.ts";
import { jsApi } from "./stdlib/js.ts";
import { spaceluaApi } from "./stdlib/space_lua.ts";
import { mathApi } from "./stdlib/math.ts";
import { parseBlock } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { encodingApi } from "./stdlib/encoding.ts";
import { luaToNumberDetailed } from "./tonumber.ts";
import { luaLoad } from "./stdlib/load.ts";
import { cryptoApi } from "./stdlib/crypto.ts";
import { netApi } from "./stdlib/net.ts";
import { isTaggedFloat, makeLuaFloat } from "./numeric.ts";
import { isPromise } from "./rp.ts";
import { isSqlNull } from "./sliq_null.ts";

const printFunction = new LuaBuiltinFunction({
  callback: async (_sf, ...args) => {
    console.log(
      "[Lua]",
      ...(await Promise.all(args.map((v) => luaToString(v)))),
    );
  },
  description:
    "Prints string representations of its arguments to the runtime log.",
  signatures: ["print(...)"],
  parameters: [{ name: "...", description: "Values to print." }],
  examples: [{ code: 'print("Hello, world!")' }],
});

const assertFunction = new LuaBuiltinFunction({
  callback: async (sf, value: any, message?: string) => {
    if (!(await value)) {
      throw new LuaRuntimeError(`Assertion failed: ${message}`, sf);
    }
  },
  description:
    "Raises an error when a value is falsy; otherwise completes successfully.",
  parameters: [
    { name: "value", description: "Condition to test." },
    {
      name: "message",
      type: "string",
      description: "Error detail.",
      optional: true,
    },
  ],
  examples: [{ code: 'assert(user ~= nil, "user is required")' }],
});

const ipairsFunction = new LuaBuiltinFunction({
  callback: (sf, t: LuaTable | any[]) => {
    let i = 0;

    return async () => {
      i = i + 1;

      const v = await luaGet(t, i, sf.astCtx ?? null, sf);
      if (v === null || v === undefined) {
        return;
      }

      return new LuaMultiRes([i, v]);
    };
  },
  description:
    "Returns an iterator over consecutive integer keys starting at 1 and stopping at the first `nil`.",
  parameters: [{ name: "table", type: "table" }],
  returns: [
    { type: "function", description: "Iterator yielding index and value." },
  ],
  examples: [
    {
      code: 'for i, fruit in ipairs({"apple", "banana"}) do\n  print(i, fruit)\nend',
    },
  ],
});

const pairsFunction = new LuaBuiltinFunction({
  callback: (sf, t: LuaTable | any[] | Record<string, any>) => {
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
  description:
    "Returns an iterator over all table key-value pairs, respecting `__pairs`.",
  parameters: [{ name: "table", type: "table" }],
  returns: [
    {
      type: "function",
      description: "Iterator plus its state and initial control value.",
    },
  ],
  examples: [
    {
      code: 'for key, value in pairs({name = "Ada", age = 36}) do\n  print(key, value)\nend',
    },
  ],
});

export const eachFunction = new LuaBuiltinFunction({
  callback: (sf, ar: LuaTable | any[]) => {
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
  description:
    "Returns a Space Lua iterator over array-like values without yielding indices.",
  parameters: [{ name: "table", type: "table" }],
  returns: [{ type: "function", description: "Iterator yielding values." }],
  examples: [
    {
      code: 'for fruit in each({"apple", "banana"}) do\n  print(fruit)\nend',
    },
  ],
});

const typeFunction = new LuaBuiltinFunction({
  callback: (_sf, value: LuaValue): string | Promise<string> => {
    return luaTypeOf(value);
  },
  description: "Returns the Lua type name of a value.",
  parameters: [{ name: "value" }],
  returns: [{ type: "string" }],
});

// tostring() checks `__tostring` metamethod first (with live SF), then
// falls back to the default `luaToString` representation.
const tostringFunction = new LuaBuiltinFunction({
  callback: (sf, value: any): string | Promise<string> => {
    const mt = getMetatable(value, sf);
    if (mt) {
      const mm = mt.rawGet("__tostring");
      if (mm !== undefined && mm !== null) {
        const ctx = sf.astCtx ?? {};
        const r = luaCall(mm, [value], ctx as any, sf);
        const unwrap = (v: any): string => {
          const s = singleResult(v);
          if (typeof s !== "string") {
            throw new LuaRuntimeError("'__tostring' must return a string", sf);
          }
          return s;
        };
        if (isPromise(r)) {
          return (r as Promise<any>).then(unwrap);
        }
        return unwrap(r);
      }
    }
    return luaToString(value);
  },
  description:
    "Converts a value to a string, respecting its `__tostring` metamethod.",
  parameters: [{ name: "value" }],
  returns: [{ type: "string" }],
});

const tonumberFunction = new LuaBuiltinFunction({
  callback: (sf, value: LuaValue, base?: number) => {
    if (base !== undefined) {
      if (!(typeof base === "number" && base >= 2 && base <= 36)) {
        throw new LuaRuntimeError(
          "bad argument #2 to 'tonumber' (base out of range)",
          sf,
        );
      }
    }

    if (typeof value === "number") {
      return value;
    }
    if (isTaggedFloat(value)) {
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
  description:
    "Converts a number or numeric string to a Lua number, optionally in a base from 2 through 36.",
  signatures: [
    "tonumber(value): number|nil",
    "tonumber(value, base): integer|nil",
  ],
  parameters: [
    { name: "value", type: "number|string" },
    { name: "base", type: "integer", optional: true },
  ],
  returns: [{ type: "number|nil" }],
  examples: [{ code: 'print(tonumber("2a", 16)) -- 42' }],
});

const errorFunction = new LuaBuiltinFunction({
  callback: (sf, message: string) => {
    throw new LuaRuntimeError(message, sf);
  },
  description: "Raises a Lua runtime error with the supplied message.",
  parameters: [{ name: "message", type: "string" }],
});

async function pcallBoundary(
  sf: LuaStackFrame,
  fn: ILuaFunction,
  args: LuaValue[],
): Promise<{ ok: true; values: LuaValue[] } | { ok: false; message: string }> {
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

const pcallFunction = new LuaBuiltinFunction({
  callback: async (sf, fn: ILuaFunction, ...args) => {
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
  description:
    "Calls a function in protected mode and returns a success flag followed by results or an error message.",
  signatures: ["pcall(function, ...): boolean, ..."],
  parameters: [
    { name: "function", type: "function" },
    { name: "...", description: "Arguments passed to the function." },
  ],
  returns: [
    { type: "boolean", description: "Whether the call succeeded." },
    { description: "Call results or error message." },
  ],
  examples: [
    { code: "local ok, result = pcall(function() return mightFail() end)" },
  ],
});

const xpcallFunction = new LuaBuiltinFunction({
  callback: async (
    sf,
    fn: ILuaFunction,
    errorHandler: ILuaFunction,
    ...args
  ) => {
    // Same semantic as `pcall` (see comments there)
    const res = await pcallBoundary(sf, fn, args);
    if (res.ok) {
      return new LuaMultiRes([true, ...res.values]);
    }
    const hr = await luaCall(errorHandler, [res.message], sf.astCtx!, sf);
    const outVals = hr instanceof LuaMultiRes ? hr.flatten().values : [hr];
    return new LuaMultiRes([false, ...outVals]);
  },
  description:
    "Calls a function in protected mode and transforms any error with an error handler.",
  signatures: ["xpcall(function, errorHandler, ...): boolean, ..."],
  parameters: [
    { name: "function", type: "function" },
    { name: "errorHandler", type: "function" },
    { name: "...", description: "Arguments passed to the function." },
  ],
  returns: [
    { type: "boolean", description: "Whether the call succeeded." },
    { description: "Call results or handler results." },
  ],
  examples: [
    {
      code: 'local ok, message = xpcall(riskyOperation, function(err)\n  return "Operation failed: " .. tostring(err)\nend)',
    },
  ],
});

const setmetatableFunction = new LuaBuiltinFunction({
  callback: (sf, table: LuaTable, metatable: LuaTable) => {
    if (!metatable) {
      throw new LuaRuntimeError("metatable cannot be set to nil", sf);
    }
    table.metatable = metatable;
    return table;
  },
  description: "Sets a table's metatable and returns the table.",
  parameters: [
    { name: "table", type: "table" },
    { name: "metatable", type: "table" },
  ],
  returns: [{ type: "table" }],
});

const rawlenFunction = new LuaBuiltinFunction({
  callback: (_sf, value: LuaValue) => luaLen(value, _sf, true),
  description: "Returns a string or table length without invoking `__len`.",
  parameters: [{ name: "value", type: "string|table" }],
  returns: [{ type: "integer" }],
});

const rawsetFunction = new LuaBuiltinFunction({
  callback: (_sf, table: LuaTable, key: LuaValue, value: LuaValue) => {
    return (table as any).rawSet(key, value);
  },
  description:
    "Sets a table key without invoking `__newindex` and returns the table.",
  parameters: [
    { name: "table", type: "table" },
    { name: "key" },
    { name: "value" },
  ],
  returns: [{ type: "table" }],
  examples: [
    {
      code: 'local t = setmetatable({}, {__newindex = function() error("blocked") end})\nrawset(t, "name", "Ada")',
    },
  ],
});

const rawgetFunction = new LuaBuiltinFunction({
  callback: (_sf, table: any, key: LuaValue) => {
    const isArray = Array.isArray(table);

    const isPlainObj =
      typeof table === "object" &&
      table !== null &&
      (table as any).constructor === Object;

    if (!isLuaTable(table) && !isArray && !isPlainObj) {
      let typeName = "userdata";
      if (table === null || table === undefined) {
        typeName = "nil";
      } else if (typeof table === "boolean") {
        typeName = "boolean";
      } else if (typeof table === "number" || isTaggedFloat(table)) {
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
      return v === undefined || isSqlNull(v) ? null : v;
    }

    const k = isTaggedFloat(key) ? key.value : key;

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
  description: "Reads a table key without invoking `__index`.",
  parameters: [{ name: "table", type: "table" }, { name: "key" }],
  returns: [{ description: "Stored value or `nil`." }],
});

const rawequalFunction = new LuaBuiltinFunction({
  callback: (_sf, a: any, b: any) => {
    const av = isTaggedFloat(a) ? a.value : a;
    const bv = isTaggedFloat(b) ? b.value : b;
    return av === bv;
  },
  description: "Tests two values for equality without invoking `__eq`.",
  parameters: [{ name: "a" }, { name: "b" }],
  returns: [{ type: "boolean" }],
});

const getmetatableFunction = new LuaBuiltinFunction({
  callback: (_sf, table: LuaTable) => (table as any).metatable,
  description: "Returns a table's metatable, or `nil` when none is set.",
  parameters: [{ name: "table", type: "table" }],
  returns: [{ type: "table|nil" }],
});

const dofileFunction = new LuaBuiltinFunction({
  callback: async (sf, filename: string) => {
    const global = sf.threadLocal.get("_GLOBAL") as LuaEnv;
    const file = (await luaCall(
      (global.get("space") as any).get("readFile"),
      [filename],
      sf.astCtx!,
      sf,
    )) as Uint8Array;
    const code = new TextDecoder().decode(file);
    try {
      const parsedExpr = parseBlock(code);
      const env = new LuaEnv(global);
      await evalStatement(parsedExpr, env, sf.withCtx(parsedExpr.ctx));
    } catch (e: any) {
      throw new LuaRuntimeError(
        `Error evaluating "${filename}": ${e.message}`,
        sf,
      );
    }
  },
  description: "Reads and executes a Lua source file from the current space.",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Space-relative Lua file path.",
    },
  ],
});

/**
 * From the Lua docs:
 *
 * If index is a number, returns all arguments after argument number
 * index; a negative number indexes from the end (-1 is the last
 * argument). Otherwise, index must be the string "#", and select
 * returns the total number of extra arguments it received.
 */
const selectFunction = new LuaBuiltinFunction({
  callback: (_sf, index: number | "#", ...args: LuaValue[]) => {
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
  description:
    "Returns the count of extra arguments or all arguments from a selected position onward.",
  signatures: ['select("#", ...): integer', "select(index, ...): ..."],
  parameters: [
    {
      name: "index",
      type: "integer|string",
      description: "One-based index, negative index from the end, or `#`.",
    },
    { name: "..." },
  ],
  returns: [{ description: "Argument count or selected argument values." }],
});

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
const nextFunction = new LuaBuiltinFunction({
  callback: (
    sf,
    table: LuaTable | Record<string, any>,
    index: number | null = null,
  ) => {
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
    if (idx === -1) {
      // Not found
      throw new LuaRuntimeError("invalid key to 'next': key not found", sf);
    }
    const key = keys[idx + 1];
    if (key === undefined) {
      // When called with the last key, should return nil
      return null;
    }
    return new LuaMultiRes([key, luaGet(table, key, sf.astCtx ?? null, sf)]);
  },
  description:
    "Returns the next table key and value after a given key, or the first pair when the key is omitted.",
  parameters: [
    { name: "table", type: "table" },
    { name: "index", description: "Previous key.", optional: true },
  ],
  returns: [
    { description: "Next key or `nil`." },
    { description: "Value at the next key." },
  ],
});

// Non-standard, but useful
const someFunction = new LuaBuiltinFunction({
  callback: async (_sf, value: any) => {
    switch (await luaTypeOf(value)) {
      case "number":
        if (!Number.isFinite(value)) return null;
        break;
      case "string":
        if (value.trim() === "") return null;
        break;
      case "table":
        if (luaKeys(value).length === 0) return null;
    }
    return value;
  },
  description:
    "Returns `nil` for empty Space Lua values and otherwise returns the value unchanged.",
  parameters: [
    {
      name: "value",
      description:
        "Value to normalize; blank strings, empty tables, infinities, and NaN are empty.",
    },
  ],
  returns: [{ description: "Original value or `nil`." }],
  examples: [
    {
      code: 'print(some("  ") or "empty")\nprint(some({}) or "empty")\nprint(some(0))',
    },
  ],
});

const loadFunction = new LuaBuiltinFunction({
  callback: (sf, s) => luaLoad(s, sf),
  description:
    "Compiles Lua source into a callable chunk without executing it.",
  parameters: [
    { name: "chunk", type: "string", description: "Lua source code." },
  ],
  returns: [
    { type: "function|nil", description: "Compiled chunk or `nil`." },
    { type: "string", description: "Compilation error when unsuccessful." },
  ],
});

function annotateBuiltinApi(
  value: unknown,
  path: string,
  page: string,
  seen = new WeakSet<object>(),
): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (isILuaFunction(value)) {
    value.info ??= { kind: "builtin" };
    value.info.name ??= path;
    value.info.see ??= page;
    return;
  }
  if (value instanceof LuaTable) {
    for (const key of value.keys()) {
      if (typeof key !== "string") continue;
      annotateBuiltinApi(value.rawGet(key), `${path}.${key}`, page, seen);
    }
  }
}

export function luaBuildStandardEnv() {
  const env = new LuaEnv();
  // _G global
  env.set("_G", env);
  // Lua version string - for now it signals Lua 5.4 compatibility with
  // selective 5.5 features; kept non-standard so callers can distinguish
  // Space Lua from a plain Lua runtime.
  env.set("_VERSION", "Lua 5.4+");
  // Top-level builtins
  env.set("print", printFunction);
  env.set("assert", assertFunction);
  env.set("type", typeFunction);
  env.set("tostring", tostringFunction);
  env.set("tonumber", tonumberFunction);
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

  for (const name of env.keys()) {
    const value = env.get(name);
    const page = value instanceof LuaTable ? `API/${name}` : "API/global";
    annotateBuiltinApi(value, name, page);
  }
  return env;
}
