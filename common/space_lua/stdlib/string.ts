import {
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaTable,
  luaToString,
} from "$common/space_lua/runtime.ts";

export const stringApi = new LuaTable({
  byte: new LuaBuiltinFunction((_sf, s: string, i?: number, j?: number) => {
    i = i ?? 1;
    j = j ?? i;
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
    (_sf, s: string, pattern: string, init?: number, plain?: boolean) => {
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
  gmatch: new LuaBuiltinFunction((_sf, s: string, pattern: string) => {
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
    (_sf, s: string, pattern: string, repl: string, n?: number) => {
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
    (_sf, s: string, pattern: string, init?: number) => {
      init = init ?? 1;
      const result = s.slice(init - 1).match(pattern);
      if (!result) {
        return new LuaMultiRes([]);
      }
      return new LuaMultiRes(result.slice(1));
    },
  ),
  rep: new LuaBuiltinFunction((_sf, s: string, n: number, sep?: string) => {
    sep = sep ?? "";
    return s.repeat(n) + sep;
  }),
  reverse: new LuaBuiltinFunction((_sf, s: string) => {
    return s.split("").reverse().join("");
  }),
  sub: new LuaBuiltinFunction((_sf, s: string, i: number, j?: number) => {
    j = j ?? s.length;
    return s.slice(i - 1, j);
  }),
  split: new LuaBuiltinFunction((_sf, s: string, sep: string) => {
    return s.split(sep);
  }),
});
