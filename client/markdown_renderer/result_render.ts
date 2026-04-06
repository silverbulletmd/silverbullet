import {
  luaFormatNumber,
  LuaTable,
  luaToString,
} from "../space_lua/runtime.ts";
import { isSqlNull } from "../space_lua/liq_null.ts";

export function defaultTransformer(v: any, _k: string): Promise<string> {
  if (v === undefined || v === null || isSqlNull(v)) {
    return Promise.resolve("");
  }
  if (typeof v === "string") {
    return Promise.resolve(escapeRegularPipes(v.replaceAll("\n", " ")));
  }
  if (v instanceof LuaTable) {
    // Render nested `LuaTables` as literal `{...}` for copy path
    return v.toStringAsync().then((s) => escapeRegularPipes(s));
  }
  if (v && typeof v === "object") {
    return Promise.resolve(luaToString(v));
  }
  if (typeof v === "number") {
    return Promise.resolve(luaFormatNumber(v));
  }
  return Promise.resolve(`${v}`);
}

export function refCellTransformer(v: any, k: string) {
  if (k === "ref") {
    return Promise.resolve(`[[${v}]]`);
  }
  return defaultTransformer(v, k);
}

/**
 * Escapes all pipes that would inadvertently delimit a markdown table column.
 * Does not escape pipes inside bracket-delimited constructs such as
 * `[[WikiLink|Alias]]` or `[attribute: a|b]`.
 * @param s The text to replace
 * @returns The text where the pipes outside of bracket context are
 *  replaced with an escaped pipe.
 */
function escapeRegularPipes(s: string) {
  let result = "";
  let bracketDepth = 0;

  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[") {
      bracketDepth++;
    } else if (s[i] === "]") {
      if (bracketDepth > 0) bracketDepth--;
    } else if (s[i] === "|" && bracketDepth === 0) {
      result += "\\";
    }

    result += s[i];
  }

  return result;
}

// Nicely format an array of JSON objects as a Markdown table
export async function jsonToMDTable(
  jsonArray: any[],
  valueTransformer: (v: any, k: string) => Promise<string> = defaultTransformer,
): Promise<string> {
  const headers = new Set<string>();
  for (const entry of jsonArray) {
    for (const k of Object.keys(entry)) {
      headers.add(k);
    }
  }

  // Handle empty case manually, instead of three lines of ||
  if (headers.size === 0) {
    return "*(empty table)*";
  }

  const headerList = [...headers];
  const lines = [];
  lines.push(`|${headerList.map((headerName) => headerName).join("|")}|`);
  lines.push(`|${headerList.map(() => "--").join("|")}|`);
  for (const val of jsonArray) {
    const el = [];
    for (const prop of headerList) {
      const s = await valueTransformer(val[prop], prop);
      el.push(s);
    }
    lines.push(`|${el.join("|")}|`);
  }
  return lines.join("\n");
}
