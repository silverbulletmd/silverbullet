import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaRuntimeError,
  LuaTable,
  luaToString,
} from "../runtime.ts";
import { isTaggedFloat, untagNumber } from "../numeric.ts";
import { luaFormat } from "./format.ts";
import {
  type CaptureResult,
  type GsubCallbacks,
  patternFind,
  patternGmatch,
  patternGsub,
  patternMatch,
} from "./pattern.ts";
import { strPackFn, strPackSizeFn, strUnpackFn } from "./string_pack.ts";

function capturesToLua(caps: CaptureResult[]): any {
  if (caps.length === 0) return null;
  if (caps.length === 1) {
    const c = caps[0];
    return "s" in c ? c.s : c.position;
  }
  return new LuaMultiRes(
    caps.map((c) => ("s" in c ? c.s : c.position)),
  );
}

export const stringApi = new LuaTable({
  byte: new LuaBuiltinFunction((_sf, s: string, i?: number, j?: number) => {
    i = i ?? 1;
    j = j ?? i;
    if (j > s.length) j = s.length;
    if (i < 1) i = 1;
    const result = [];
    for (let k = i; k <= j; k++) {
      result.push(s.charCodeAt(k - 1));
    }
    return new LuaMultiRes(result);
  }),
  char: new LuaBuiltinFunction((_sf, ...args: number[]) => {
    return String.fromCharCode(...args);
  }),
  find: new LuaBuiltinFunction(
    (_sf, s: string, pattern: string, init = 1, plain = false) => {
      const r = patternFind(s, pattern, init, plain);
      if (!r) return null;
      const result: any[] = [r.start, r.end];
      for (const c of r.captures) {
        result.push("s" in c ? c.s : c.position);
      }
      return new LuaMultiRes(result);
    },
  ),
  format: new LuaBuiltinFunction((_sf, format: string, ...args: any[]) => {
    for (let i = 0; i < args.length; i++) {
      args[i] = untagNumber(args[i]);
    }
    return luaFormat(format, ...args);
  }),
  gmatch: new LuaBuiltinFunction(
    (_sf, s: string, pattern: string, init = 1) => {
      const iter = patternGmatch(s, pattern, init);
      return () => {
        const caps = iter();
        if (!caps) return;
        return capturesToLua(caps);
      };
    },
  ),
  gsub: new LuaBuiltinFunction(
    async (
      sf,
      s: string,
      pattern: string,
      repl: any,
      n?: number,
    ) => {
      const callbacks: GsubCallbacks = {};
      if (typeof repl === "string") {
        callbacks.replString = repl;
      } else if (repl instanceof LuaTable) {
        callbacks.replTable = (key: string) => {
          const v = repl.get(key);
          if (v === null || v === undefined || v === false) return null;
          return typeof v === "number"
            ? String(v)
            : String(isTaggedFloat(v) ? v.value : v);
        };
      } else if (repl.call) {
        callbacks.replFunction = async (...caps: CaptureResult[]) => {
          const args = caps.map((c) => ("s" in c ? c.s : c.position));
          let result = await repl.call(sf, ...args);
          if (result instanceof LuaMultiRes) {
            result = result.values[0];
          }
          if (result === null || result === undefined || result === false) {
            return null;
          }
          return luaToString(result);
        };
      } else {
        throw new LuaRuntimeError(
          "string.gsub replacement argument should be a function, table or string",
          sf,
        );
      }
      const [result, count] = await patternGsub(s, pattern, callbacks, n);
      return new LuaMultiRes([result, count]);
    },
  ),
  len: new LuaBuiltinFunction((_sf, s: string) => {
    return s.length;
  }),
  lower: new LuaBuiltinFunction((_sf, s: string) => {
    return luaToString(s.toLowerCase());
  }),
  upper: new LuaBuiltinFunction((_sf, s: string) => {
    return luaToString(s.toUpperCase());
  }),
  match: new LuaBuiltinFunction(
    (_sf, s: string, pattern: string, init = 1) => {
      const caps = patternMatch(s, pattern, init);
      if (!caps) return null;
      return capturesToLua(caps);
    },
  ),
  rep: new LuaBuiltinFunction((_sf, s: string, n: number, sep?: string) => {
    if (n <= 0) return "";
    sep = sep ?? "";
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(s);
    }
    return parts.join(sep);
  }),
  reverse: new LuaBuiltinFunction((_sf, s: string) => {
    return s.split("").reverse().join("");
  }),
  sub: new LuaBuiltinFunction((_sf, s: string, i: number, j?: number) => {
    const len = s.length;
    let start: number;
    if (i > 0) {
      start = i;
    } else if (i < -len) {
      start = 1;
    } else {
      start = i === 0 ? 1 : len + i + 1;
    }
    let end: number;
    if (j === undefined || j === null || j > len) {
      end = len;
    } else if (j >= 0) {
      end = j;
    } else if (j < -len) {
      end = 0;
    } else {
      end = len + j + 1;
    }
    if (start <= end) {
      return s.substring(start - 1, end);
    }
    return "";
  }),

  split: new LuaBuiltinFunction((_sf, s: string, sep: string) => {
    return s.split(sep);
  }),

  pack: strPackFn,
  unpack: strUnpackFn,
  packsize: strPackSizeFn,

  // Non-standard extensions
  startsWith: new LuaBuiltinFunction((_sf, s: string, prefix: string) => {
    return s.startsWith(prefix);
  }),
  endsWith: new LuaBuiltinFunction((_sf, s: string, suffix: string) => {
    return s.endsWith(suffix);
  }),
  trim: new LuaBuiltinFunction((_sf, s: string) => {
    return s.trim();
  }),
  trimStart: new LuaBuiltinFunction((_sf, s: string) => {
    return s.trimStart();
  }),
  trimEnd: new LuaBuiltinFunction((_sf, s: string) => {
    return s.trimEnd();
  }),
  matchRegex: new LuaBuiltinFunction((_sf, s: string, pattern: string) => {
    const regex = new RegExp(pattern);
    const result = s.match(regex);
    return jsToLuaValue(result);
  }),
  matchRegexAll: new LuaBuiltinFunction((_sf, s: string, pattern: string) => {
    const regex = new RegExp(pattern, "g");
    return () => {
      const match = regex.exec(s);
      if (!match) {
        return;
      }
      return jsToLuaValue(match);
    };
  }),
});
