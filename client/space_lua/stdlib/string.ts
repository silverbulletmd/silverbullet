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
  return new LuaMultiRes(caps.map((c) => ("s" in c ? c.s : c.position)));
}

export const stringApi = new LuaTable({
  byte: new LuaBuiltinFunction({
    callback: (_sf, s: string, i?: number, j?: number) => {
      i = i ?? 1;
      j = j ?? i;
      if (j > s.length) j = s.length;
      if (i < 1) i = 1;
      const result = [];
      for (let k = i; k <= j; k++) {
        result.push(s.charCodeAt(k - 1));
      }
      return new LuaMultiRes(result);
    },
    documentation: {
      description:
        "Returns the numeric character codes in the inclusive range from `i` to `j`.",
      parameters: [
        { name: "s", type: "string" },
        { name: "i", type: "integer", optional: true },
        { name: "j", type: "integer", optional: true },
      ],
      returns: [{ type: "integer", description: "One result per character." }],
    },
  }),
  char: new LuaBuiltinFunction({
    callback: (_sf, ...args: number[]) => String.fromCharCode(...args),
    documentation: {
      description: "Creates a string from numeric character codes.",
      signatures: ["string.char(...): string"],
      returns: [{ type: "string" }],
    },
  }),
  find: new LuaBuiltinFunction({
    callback: (_sf, s: string, pattern: string, init = 1, plain = false) => {
      const r = patternFind(s, pattern, init, plain);
      if (!r) return null;
      const result: any[] = [r.start, r.end];
      for (const c of r.captures) {
        result.push("s" in c ? c.s : c.position);
      }
      return new LuaMultiRes(result);
    },
    documentation: {
      description:
        "Finds the first Lua-pattern match and returns its bounds followed by captures.",
      parameters: [
        { name: "s", type: "string" },
        { name: "pattern", type: "string" },
        { name: "init", type: "integer", optional: true },
        { name: "plain", type: "boolean", optional: true },
      ],
      returns: [
        { type: "integer|nil", description: "Start index or `nil`." },
        { type: "integer", description: "End index." },
      ],
    },
  }),
  format: new LuaBuiltinFunction({
    callback: (_sf, format: string, ...args: any[]) => {
      for (let i = 0; i < args.length; i++) {
        args[i] = untagNumber(args[i]);
      }
      return luaFormat(format, ...args);
    },
    documentation: {
      description: "Formats values according to a C-style format string.",
      signatures: ["string.format(format, ...): string"],
      parameters: [
        { name: "format", type: "string" },
        {
          name: "...",
          description: "Values consumed by conversion specifiers.",
        },
      ],
      returns: [{ type: "string" }],
      examples: [
        { code: 'print(string.format("Name: %s, score: %.1f", "Ada", 9.5))' },
      ],
    },
  }),
  gmatch: new LuaBuiltinFunction({
    callback: (_sf, s: string, pattern: string, init = 1) => {
      const iter = patternGmatch(s, pattern, init);
      return () => {
        const caps = iter();
        if (!caps) return;
        return capturesToLua(caps);
      };
    },
    documentation: {
      description:
        "Returns an iterator over successive Lua-pattern matches and captures.",
      parameters: [
        { name: "s", type: "string" },
        { name: "pattern", type: "string" },
        { name: "init", type: "integer", optional: true },
      ],
      returns: [{ type: "function", description: "Match iterator." }],
      examples: [
        {
          code: 'for word in string.gmatch("hello world", "%w+") do\n  print(word)\nend',
        },
      ],
    },
  }),
  gsub: new LuaBuiltinFunction({
    callback: async (sf, s: string, pattern: string, repl: any, n?: number) => {
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
    documentation: {
      description:
        "Replaces Lua-pattern matches using a string, table, or function replacement.",
      parameters: [
        { name: "s", type: "string" },
        { name: "pattern", type: "string" },
        { name: "replacement", type: "string|table|function" },
        { name: "n", type: "integer", optional: true },
      ],
      returns: [
        { type: "string", description: "Result string." },
        { type: "integer", description: "Number of replacements." },
      ],
      examples: [
        {
          code: 'local result, count = string.gsub("hello hello", "hello", "hi", 1)\nprint(result, count) -- hi hello  1',
        },
      ],
    },
  }),
  len: new LuaBuiltinFunction({
    callback: (_sf, s: string) => s.length,
    documentation: {
      description: "Returns the length of a string.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "integer" }],
    },
  }),
  lower: new LuaBuiltinFunction({
    callback: (_sf, s: string) => luaToString(s.toLowerCase()),
    documentation: {
      description: "Returns a copy of a string converted to lowercase.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "string" }],
    },
  }),
  upper: new LuaBuiltinFunction({
    callback: (_sf, s: string) => luaToString(s.toUpperCase()),
    documentation: {
      description: "Returns a copy of a string converted to uppercase.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "string" }],
    },
  }),
  match: new LuaBuiltinFunction({
    callback: (_sf, s: string, pattern: string, init = 1) => {
      const caps = patternMatch(s, pattern, init);
      if (!caps) return null;
      return capturesToLua(caps);
    },
    documentation: {
      description:
        "Returns captures from the first Lua-pattern match, or `nil` when none is found.",
      parameters: [
        { name: "s", type: "string" },
        { name: "pattern", type: "string" },
        { name: "init", type: "integer", optional: true },
      ],
      returns: [{ description: "Pattern captures, whole match, or `nil`." }],
      examples: [
        { code: 'local year, month = string.match("2024-03", "(%d+)%-(%d+)")' },
      ],
    },
  }),
  rep: new LuaBuiltinFunction({
    callback: (_sf, s: string, n: number, sep?: string) => {
      if (n <= 0) return "";
      sep = sep ?? "";
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        parts.push(s);
      }
      return parts.join(sep);
    },
    documentation: {
      description:
        "Returns `n` copies of a string joined by an optional separator.",
      parameters: [
        { name: "s", type: "string" },
        { name: "n", type: "integer" },
        { name: "sep", type: "string", optional: true },
      ],
      returns: [{ type: "string" }],
    },
  }),
  reverse: new LuaBuiltinFunction({
    callback: (_sf, s: string) => s.split("").reverse().join(""),
    documentation: {
      description: "Returns a string with its characters in reverse order.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "string" }],
    },
  }),
  sub: new LuaBuiltinFunction({
    callback: (_sf, s: string, i: number, j?: number) => {
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
    },
    documentation: {
      description:
        "Returns the substring from inclusive index `i` through `j`, supporting negative indices.",
      parameters: [
        { name: "s", type: "string" },
        { name: "i", type: "integer" },
        { name: "j", type: "integer", optional: true },
      ],
      returns: [{ type: "string" }],
    },
  }),

  split: new LuaBuiltinFunction({
    callback: (_sf, s: string, sep: string) => s.split(sep),
    documentation: {
      description:
        "Splits a string on a literal separator and returns the substrings.",
      parameters: [
        { name: "s", type: "string" },
        { name: "sep", type: "string" },
      ],
      returns: [{ type: "table" }],
      examples: [
        {
          code: 'for part in each(string.split("a,b,c", ",")) do\n  print(part)\nend',
        },
      ],
    },
  }),

  pack: strPackFn,
  unpack: strUnpackFn,
  packsize: strPackSizeFn,

  // Non-standard extensions
  startsWith: new LuaBuiltinFunction({
    callback: (_sf, s: string, prefix: string) => s.startsWith(prefix),
    documentation: {
      description: "Returns whether a string starts with a literal prefix.",
      parameters: [
        { name: "s", type: "string" },
        { name: "prefix", type: "string" },
      ],
      returns: [{ type: "boolean" }],
    },
  }),
  endsWith: new LuaBuiltinFunction({
    callback: (_sf, s: string, suffix: string) => s.endsWith(suffix),
    documentation: {
      description: "Returns whether a string ends with a literal suffix.",
      parameters: [
        { name: "s", type: "string" },
        { name: "suffix", type: "string" },
      ],
      returns: [{ type: "boolean" }],
    },
  }),
  trim: new LuaBuiltinFunction({
    callback: (_sf, s: string) => s.trim(),
    documentation: {
      description: "Removes whitespace from both ends of a string.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "string" }],
    },
  }),
  trimStart: new LuaBuiltinFunction({
    callback: (_sf, s: string) => s.trimStart(),
    documentation: {
      description: "Removes whitespace from the beginning of a string.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "string" }],
    },
  }),
  trimEnd: new LuaBuiltinFunction({
    callback: (_sf, s: string) => s.trimEnd(),
    documentation: {
      description: "Removes whitespace from the end of a string.",
      parameters: [{ name: "s", type: "string" }],
      returns: [{ type: "string" }],
    },
  }),
  matchRegex: new LuaBuiltinFunction({
    callback: (_sf, s: string, pattern: string) => {
      const regex = new RegExp(pattern);
      const result = s.match(regex);
      return jsToLuaValue(result);
    },
    documentation: {
      description:
        "Matches a string with a JavaScript regular expression and returns the match array.",
      parameters: [
        { name: "s", type: "string" },
        { name: "pattern", type: "string" },
      ],
      returns: [{ type: "table|nil" }],
      examples: [
        {
          code: 'local match = string.matchRegex("hello123", "([a-z]+)([0-9]+)")\nprint(match[1], match[2], match[3])',
        },
      ],
    },
  }),
  matchRegexAll: new LuaBuiltinFunction({
    callback: (_sf, s: string, pattern: string) => {
      const regex = new RegExp(pattern, "g");
      return () => {
        const match = regex.exec(s);
        if (!match) {
          return;
        }
        return jsToLuaValue(match);
      };
    },
    documentation: {
      description:
        "Returns an iterator over all JavaScript regular-expression matches.",
      parameters: [
        { name: "s", type: "string" },
        { name: "pattern", type: "string" },
      ],
      returns: [
        { type: "function", description: "Iterator yielding match arrays." },
      ],
      examples: [
        {
          code: 'for match in string.matchRegexAll("a1b2", "([a-z])([0-9])") do\n  print(match[1], match[2], match[3])\nend',
        },
      ],
    },
  }),
});
