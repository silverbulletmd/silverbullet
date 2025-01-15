import {
  LuaBuiltinFunction,
  luaCall,
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
    const jsPattern = pattern
      .replace(/%(.)/g, (_, char) => {
        switch (char) {
          case ".":
            return "[.]";
          case "%":
            return "%";
          case "d":
            return "\\d";
          case "s":
            return "\\s";
          case "w":
            return "\\w";
          default:
            return char;
        }
      });

    const regex = new RegExp(jsPattern, "g");
    return () => {
      const result = regex.exec(s);
      if (!result) {
        return;
      }
      const captures = result.slice(1);
      return new LuaMultiRes(captures.length > 0 ? captures : [result[0]]);
    };
  }),
  gsub: new LuaBuiltinFunction(
    async (
      sf,
      s: string,
      pattern: string,
      repl: any, // string or LuaFunction
      n?: number,
    ) => {
      n = n ?? Infinity;

      // Convert Lua patterns to JavaScript regex
      // This handles:
      // - %.: Match literal dot
      // - %%: Match literal %
      // - %d: Match digit
      // - %s: Match whitespace
      // - %w: Match word character
      const jsPattern = pattern
        .replace(/%(.)/g, (_, char) => {
          switch (char) {
            case ".":
              return "[.]"; // Match literal dot using character class
            case "%":
              return "%"; // Match literal %
            case "d":
              return "\\d"; // Match digit
            case "s":
              return "\\s"; // Match whitespace
            case "w":
              return "\\w"; // Match word character
            default:
              return char; // Match literal character
          }
        });

      const regex = new RegExp(jsPattern, "g");
      let result = s;
      let count = 0;

      // Collect all matches first to handle replacements properly
      const positions: Array<[number, number, string, string[]]> = [];
      let match: RegExpExecArray | null;
      let lastIndex = 0;

      while ((match = regex.exec(result)) !== null && count < n) {
        if (match.index >= lastIndex) {
          positions.push([
            match.index,
            match[0].length,
            match[0],
            match.slice(1),
          ]);
          count++;
          lastIndex = match.index + 1;
        }
        regex.lastIndex = match.index + 1;
      }

      // Process replacements in reverse order to maintain string indices
      for (let i = positions.length - 1; i >= 0; i--) {
        const [index, length, fullMatch, captures] = positions[i];

        let replacement: any;
        if (repl.call) {
          const args = captures.length > 0 ? captures : [fullMatch];
          replacement = await luaCall(repl, args, sf.astCtx!, sf);
          replacement = (replacement === null || replacement === undefined)
            ? fullMatch
            : replacement;
        } else {
          replacement = repl;
        }

        result = result.slice(0, index) +
          replacement +
          result.slice(index + length);
      }

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

  // Non-standard
  startswith: new LuaBuiltinFunction((_sf, s: string, prefix: string) => {
    return s.startsWith(prefix);
  }),
  endswith: new LuaBuiltinFunction((_sf, s: string, suffix: string) => {
    return s.endsWith(suffix);
  }),
});
