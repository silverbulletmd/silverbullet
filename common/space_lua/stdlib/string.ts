import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaMultiRes,
  LuaTable,
  luaToString,
} from "$common/space_lua/runtime.ts";
import printf from "./printf.ts";

// Bits and pieces borrowed from https://github.com/paulcuth/starlight/blob/master/src/runtime/lib/string.js

const ROSETTA_STONE = {
  "([^a-zA-Z0-9%(])-": "$1*?",
  "([^%])-([^a-zA-Z0-9?])": "$1*?$2",
  "(.)-$": "$1*?",
  "%a": "[a-zA-Z]",
  "%A": "[^a-zA-Z]",
  "%c": "[\x00-\x1f]",
  "%C": "[^\x00-\x1f]",
  "%d": "\\d",
  "%D": "[^\d]",
  "%l": "[a-z]",
  "%L": "[^a-z]",
  "%p": "[\.\,\"'\?\!\;\:\#\$\%\&\(\)\*\+\-\/\<\>\=\@\\[\\]\\\\^\_\{\}\|\~]",
  "%P": "[^\.\,\"'\?\!\;\:\#\$\%\&\(\)\*\+\-\/\<\>\=\@\\[\\]\\\\^\_\{\}\|\~]",
  "%s": "[ \\t\\n\\f\\v\\r]",
  "%S": "[^ \t\n\f\v\r]",
  "%u": "[A-Z]",
  "%U": "[^A-Z]",
  "%w": "[a-zA-Z0-9]",
  "%W": "[^a-zA-Z0-9]",
  "%x": "[a-fA-F0-9]",
  "%X": "[^a-fA-F0-9]",
  "%([^a-zA-Z])": "\\$1",
};

function translatePattern(pattern: string): string {
  pattern = "" + pattern;

  // Replace single backslash with double backslashes
  pattern = pattern.replace(new RegExp("\\\\", "g"), "\\\\");

  for (const [key, value] of Object.entries(ROSETTA_STONE)) {
    pattern = pattern.replace(new RegExp(key, "g"), value);
  }

  let l = pattern.length;
  let n = 0;

  for (let i = 0; i < l; i++) {
    const character = pattern.slice(i, 1);
    if (i && pattern.slice(i - 1, 1) == "\\") {
      continue;
    }

    let addSlash = false;

    if (character == "[") {
      if (n) addSlash = true;
      n++;
    } else if (character == "]" && pattern.slice(i - 1, 1) !== "\\") {
      n--;
      if (n) addSlash = true;
    }

    if (addSlash) {
      pattern = pattern.slice(0, i) + pattern.slice(i++ + 1);
      l++;
    }
  }

  return pattern;
}

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
    (_sf, s: string, pattern: string, init = 1, plain = false) => {
      // Regex
      if (!plain) {
        pattern = translatePattern(pattern);
        const reg = new RegExp(pattern);
        const index = s.slice(init - 1).search(reg);

        if (index < 0) return;

        const match = s.slice(init - 1).match(reg);
        const result = [index + init, index + init + match![0].length - 1];

        match!.shift();
        return new LuaMultiRes(result.concat(match));
      }

      // Plain
      const index = s.indexOf(pattern, init - 1);
      return (index === -1)
        ? new LuaMultiRes([])
        : new LuaMultiRes([index + 1, index + pattern.length]);
    },
  ),
  format: new LuaBuiltinFunction((_sf, format: string, ...args: any[]) => {
    return printf(format, ...args);
  }),
  gmatch: new LuaBuiltinFunction((_sf, s: string, pattern: string) => {
    pattern = translatePattern(pattern);
    const reg = new RegExp(pattern, "g"),
      matches = s.match(reg);
    return () => {
      if (!matches) {
        return;
      }
      const match = matches.shift();
      if (!match) {
        return;
      }
      const groups = new RegExp(pattern).exec(match) || [];

      groups.shift();
      return groups.length ? new LuaMultiRes(groups) : match;
    };
  }),
  gsub: new LuaBuiltinFunction(
    async (
      sf,
      s: string,
      pattern: string,
      repl: any, // string or LuaFunction
      n = Infinity,
    ) => {
      pattern = translatePattern("" + pattern);
      const replIsFunction = repl.call;

      let count = 0,
        result = "",
        str,
        prefix,
        match: any,
        lastMatch;

      while (
        count < n &&
        s &&
        (match = s.match(pattern))
      ) {
        if (replIsFunction) {
          // If no captures, pass in the whole match
          if (match[1] === undefined) {
            str = await repl.call(sf, match[0]);
          } else {
            // Else pass in the captures
            str = await repl.call(sf, ...match.slice(1));
          }
          if (str instanceof LuaMultiRes) {
            str = str.values[0];
          }
          if (str === undefined || str === null) {
            str = match[0];
          }
        } else if (repl instanceof LuaTable) {
          str = repl.get(match[0]);
        } else {
          str = `${repl}`.replace(/%([0-9])/g, (_, i) => match[i]);
        }

        if (match[0].length === 0) {
          if (lastMatch === void 0) {
            prefix = "";
          } else {
            prefix = s.slice(0, 1);
          }
        } else {
          prefix = s.slice(0, match.index);
        }

        lastMatch = match[0];
        result += `${prefix}${str}`;
        s = s.slice(`${prefix}${lastMatch}`.length);

        count++;
      }

      return new LuaMultiRes([`${result}${s}`, count]);
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
      s = s.slice(init - 1);
      const matches = s.match(new RegExp(translatePattern(pattern)));

      if (!matches) {
        return null;
      } else if (!matches[1]) {
        // No captures
        return matches[0];
      }

      matches.shift();
      return new LuaMultiRes(matches);
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
    if (i < 0) {
      i = s.length + i + 1;
    }
    if (j < 0) {
      j = s.length + j + 1;
    }
    return s.slice(i - 1, j);
  }),
  split: new LuaBuiltinFunction((_sf, s: string, sep: string) => {
    return s.split(sep);
  }),

  // Non-standard
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
