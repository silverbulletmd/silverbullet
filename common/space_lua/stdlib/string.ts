import {
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaTable,
  luaToString,
} from "$common/space_lua/runtime.ts";

export const stringApi = new LuaTable({
  byte: new LuaBuiltinFunction((s: string, i?: number, j?: number) => {
    i = i ?? 1;
    j = j ?? i;
    const result = [];
    for (let k = i; k <= j; k++) {
      result.push(s.charCodeAt(k - 1));
    }
    return new LuaMultiRes(result);
  }),
  char: new LuaBuiltinFunction((...args: number[]) => {
    return String.fromCharCode(...args);
  }),
  find: new LuaBuiltinFunction(
    (s: string, pattern: string, init?: number, plain?: boolean) => {
      init = init ?? 1;
      plain = plain ?? false;
      const result = s.slice(init - 1).match(pattern);
      if (!result) {
        return new LuaMultiRes([]);
      }
      return new LuaMultiRes([
        result.index! + 1,
        result.index! + result[0].length,
      ]);
    },
  ),
  format: new LuaBuiltinFunction((format: string, ...args: any[]) => {
    return format.replace(/%./g, (match) => {
      switch (match) {
        case "%s":
          return luaToString(args.shift());
        case "%d":
          return String(args.shift());
        default:
          return match;
      }
    });
  }),
  gmatch: new LuaBuiltinFunction((s: string, pattern: string) => {
    const regex = new RegExp(pattern, "g");
    return () => {
      const result = regex.exec(s);
      if (!result) {
        return;
      }
      return new LuaMultiRes(result.slice(1));
    };
  }),
  gsub: new LuaBuiltinFunction(
    (s: string, pattern: string, repl: string, n?: number) => {
      n = n ?? Infinity;
      const regex = new RegExp(pattern, "g");
      let result = s;
      let match: RegExpExecArray | null;
      for (let i = 0; i < n; i++) {
        match = regex.exec(result);
        if (!match) {
          break;
        }
        result = result.replace(match[0], repl);
      }
      return result;
    },
  ),
  len: new LuaBuiltinFunction((s: string) => {
    return s.length;
  }),
  lower: new LuaBuiltinFunction((s: string) => {
    return luaToString(s.toLowerCase());
  }),
  upper: new LuaBuiltinFunction((s: string) => {
    return luaToString(s.toUpperCase());
  }),
  match: new LuaBuiltinFunction(
    (s: string, pattern: string, init?: number) => {
      init = init ?? 1;
      const result = s.slice(init - 1).match(pattern);
      if (!result) {
        return new LuaMultiRes([]);
      }
      return new LuaMultiRes(result.slice(1));
    },
  ),
  rep: new LuaBuiltinFunction((s: string, n: number, sep?: string) => {
    sep = sep ?? "";
    return s.repeat(n) + sep;
  }),
  reverse: new LuaBuiltinFunction((s: string) => {
    return s.split("").reverse().join("");
  }),
  sub: new LuaBuiltinFunction((s: string, i: number, j?: number) => {
    j = j ?? s.length;
    return s.slice(i - 1, j);
  }),
  split: new LuaBuiltinFunction((s: string, sep: string) => {
    return s.split(sep);
  }),
});
