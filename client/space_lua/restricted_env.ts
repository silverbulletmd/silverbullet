import { isSqlNull } from "./sliq_null.ts";
import { parseBlock, parseExpressionString } from "./parse.ts";
import { evalStatement, evalExpression } from "./eval.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { makeLuaBudget } from "./budget.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaMultiRes,
  LuaStackFrame,
  LuaTable,
  type RestrictedPolicy,
} from "./runtime.ts";
import { isTaggedFloat } from "./numeric.ts";
import { opaqueRenderValue } from "./restricted_render.ts";

export type Capability =
  | "space:read"
  | "space:write"
  | "network"
  | "widget:render";
export type RestrictedAPI = {
  capabilities?: Capability[];
  callback: (this: LuaStackFrame, ...args: any[]) => unknown;
  render?: boolean;
};

export const pureAPIs = [
  "assert",
  "type",
  "tostring",
  "tonumber",
  "select",
  "next",
  "pairs",
  "ipairs",
  "error",
  "pcall",
  "xpcall",
  "setmetatable",
  "getmetatable",
  "rawlen",
  "rawset",
  "rawget",
  "rawequal",
  "math.abs",
  "math.ceil",
  "math.floor",
  "math.max",
  "math.min",
  "math.sqrt",
  "math.sin",
  "math.cos",
  "math.log",
  "math.exp",
  "math.fmod",
  "math.modf",
  "math.tointeger",
  "math.type",
  "math.ult",
  "string.len",
  "string.lower",
  "string.upper",
  "string.sub",
  "string.reverse",
  "string.byte",
  "string.char",
  "string.find",
  "string.match",
  "string.gsub",
  "string.gmatch",
  "string.format",
  "string.rep",
  "table.insert",
  "table.remove",
  "table.sort",
  "table.concat",
  "table.unpack",
  "table.pack",
  "table.move",
  "table.includes",
  "table.find",
  "table.select",
  "string.startsWith",
  "os.date",
  "spacelua.interpolate",
];

export function toLuaData(value: unknown, depth = 0): any {
  if (depth > 40) throw new Error("Safe mode: input depth exceeded");
  if (isSqlNull(value)) return value;
  if (value == null || ["boolean", "number", "string"].includes(typeof value))
    return value;
  if (isTaggedFloat(value)) return value.value;
  if (value instanceof LuaTable) {
    const table = new LuaTable();
    for (const key of value.keys()) {
      if (typeof key !== "string" && typeof key !== "number")
        throw new Error("Non-data table key");
      void table.rawSet(key, toLuaData(value.rawGet(key), depth + 1));
    }
    return table;
  }
  if (
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null &&
      !Array.isArray(value))
  ) {
    throw new Error("Safe mode: non-data API result");
  }
  const table = new LuaTable();
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (Array.isArray(value) && key === "length") continue;
    if (!Object.hasOwn(descriptor, "value"))
      throw new Error("Safe mode: accessor in API result");
    void table.rawSet(
      Array.isArray(value) ? Number(key) + 1 : key,
      toLuaData(descriptor.value, depth + 1),
    );
  }
  return table;
}

export function inertResult(
  value: any,
  depth = 0,
  budget = { nodes: 10000 },
): any {
  if (--budget.nodes < 0 || depth > 40)
    throw new Error("Safe mode: output limit exceeded");
  if (value instanceof LuaMultiRes)
    return inertResult(value.unwrap(), depth, budget);
  if (isSqlNull(value)) return null;
  if (isTaggedFloat(value)) return value.value;
  if (value == null || ["boolean", "number", "string"].includes(typeof value))
    return value;
  if (!(value instanceof LuaTable) || value.metatable)
    throw new Error("Safe mode: non-data result");
  const keys = value.keys();
  const array = keys.every(
    (key) => typeof key === "number" && key >= 1 && key <= keys.length,
  );
  const out: any = array ? [] : Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" && typeof key !== "number")
      throw new Error("Safe mode: non-data key");
    out[array ? Number(key) - 1 : key] = inertResult(
      value.rawGet(key),
      depth + 1,
      budget,
    );
  }
  return out;
}

export function createRestrictedEnv(
  apis: Record<string, RestrictedAPI> = {},
  grants: Capability[] = ["space:read"],
  unavailableAPIs: string[] = [],
) {
  const env = new LuaEnv();
  const policy: RestrictedPolicy = { nativeFunctions: new Set() };
  const std = luaBuildStandardEnv();
  const inventory: string[] = [];
  const install = (name: string, value: any) => {
    const parts = name.split(".");
    if (parts.length === 1) env.setLocal(name, value);
    else {
      if (!env.has(parts[0])) env.setLocal(parts[0], new LuaTable());
      let table = env.get(parts[0]) as LuaTable;
      for (const part of parts.slice(1, -1)) {
        if (!(table.rawGet(part) instanceof LuaTable))
          void table.rawSet(part, new LuaTable());
        table = table.rawGet(part);
      }
      void table.rawSet(parts.at(-1)!, value);
    }
  };
  const allow = (fn: LuaBuiltinFunction) => {
    policy.nativeFunctions.add(fn);
    return fn;
  };
  const allowIterator = (value: any): any => {
    if (typeof value === "function" || value instanceof LuaBuiltinFunction)
      policy.nativeFunctions.add(value);
    if (value instanceof LuaMultiRes)
      for (const item of value.values) allowIterator(item);
    return value;
  };
  for (const name of pureAPIs) {
    const [ns, key] = name.split(".");
    const original = key ? std.get(ns).rawGet(key) : std.get(ns);
    if (!(original instanceof LuaBuiltinFunction))
      throw new Error(`Missing builtin ${name}`);
    const wrapped = allow(
      new LuaBuiltinFunction(async (sf, ...args) => {
        if (
          [
            "rawget",
            "rawset",
            "setmetatable",
            "getmetatable",
            "next",
            "pairs",
            "ipairs",
          ].includes(name) &&
          !(args[0] instanceof LuaTable)
        ) {
          throw new Error("Safe mode: a private Lua table is required");
        }
        if (name === "setmetatable" && !(args[1] instanceof LuaTable)) {
          throw new Error("Safe mode: a private Lua metatable is required");
        }
        const userIterator =
          name === "pairs" && args[0].metatable?.rawGet("__pairs");
        const result = await original.fn(sf, ...args);
        return !userIterator &&
          ["pairs", "ipairs", "string.gmatch"].includes(name)
          ? allowIterator(result)
          : result;
      }),
    );
    install(name, wrapped);
    inventory.push(name);
  }
  const templateBody = parseExpressionString(
    "function(obj) return spacelua.interpolate(templateStr, obj) end",
  );
  install(
    "template.new",
    allow(
      new LuaBuiltinFunction((sf, text: unknown, stripIndent = true) => {
        if (typeof text !== "string")
          throw new Error("template.new expects a string");
        const closure = new LuaEnv(env);
        closure.setLocal(
          "templateStr",
          stripIndent ? text.replace(/^    /gm, "") : text,
        );
        return evalExpression(templateBody, closure, sf);
      }),
    ),
  );
  inventory.push("template.new");
  for (const [name, api] of Object.entries(apis)) {
    const granted =
      api.capabilities !== undefined &&
      api.capabilities.every((capability) => grants.includes(capability));
    install(
      name,
      allow(
        new LuaBuiltinFunction(async (sf, ...args) => {
          if (!granted)
            throw new Error(`Safe mode: capability denied for ${name}`);
          const input = args.map((arg) => inertResult(arg));
          const result = await api.callback.call(sf, ...input);
          return api.render ? opaqueRenderValue(result) : toLuaData(result);
        }),
      ),
    );
    if (granted) inventory.push(name);
  }
  for (const name of unavailableAPIs) {
    if (inventory.includes(name) || Object.hasOwn(apis, name)) continue;
    install(
      name,
      allow(
        new LuaBuiltinFunction(() => {
          throw new Error(
            `${name} is not available in restricted expressions. Ask a Builder to expose a reviewed helper in Library/ or CONFIG.`,
          );
        }),
      ),
    );
  }
  env.setLocal("_G", env);
  const tl = new LuaEnv();
  tl.setLocal("_GLOBAL", env);
  const budget = makeLuaBudget({
    busyLimitMs: 25,
    onLimit: (b) => {
      b.stopped = true;
    },
  });
  const sf = new LuaStackFrame(tl, null, undefined, undefined, {
    restrictedPolicy: policy,
    budget,
  });
  return {
    env,
    sf,
    policy,
    inventory,
    async run(code: string) {
      if (code.length > 100000)
        throw new Error("Safe mode: source limit exceeded");
      const result = await evalStatement(parseBlock(code), env, sf);
      const value = result?.ctrl === "return" ? result.values[0] : null;
      const output = inertResult(value);
      if (JSON.stringify(output).length > 100000)
        throw new Error("Safe mode: output size exceeded");
      return output;
    },
  };
}
