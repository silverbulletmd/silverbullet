import {
  luaFormatNumber,
  LuaTable,
  luaToString,
} from "../space_lua/runtime.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import { isSqlNull } from "../space_lua/liq_null.ts";

export function defaultTransformer(v: any, _k: string): Promise<string> {
  if (v === undefined || isSqlNull(v)) {
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

// Render an expression result as Markdown (for copy path)
// LuaTables are rendered natively, JS objects/arrays use `jsonToMDTable`
export function renderExpressionResult(
  result: any,
  cellTransformer: (v: any, k: string) => Promise<string> = refCellTransformer,
): Promise<string> {
  if (result === undefined || result === null) {
    return Promise.resolve("nil");
  }
  // LuaTable: render natively without `.toJS`
  if (result instanceof LuaTable) {
    return renderLuaTableToMarkdown(result, cellTransformer);
  }
  // Must check before object/array checks — tagged floats are plain objects
  if (isTaggedFloat(result)) {
    return Promise.resolve(luaFormatNumber(result.value, "float"));
  }
  if (typeof result === "number") {
    return Promise.resolve(luaFormatNumber(result));
  }
  if (
    Array.isArray(result) &&
    result.length > 0 &&
    typeof result[0] === "object"
  ) {
    // If result is an array of objects, render as a Markdown table
    try {
      return jsonToMDTable(result, cellTransformer);
    } catch (e: any) {
      console.error(
        `Error rendering expression directive: ${e.message} for value ${JSON.stringify(
          result,
        )}`,
      );
      return Promise.resolve(JSON.stringify(result));
    }
  } else if (typeof result === "object" && result.constructor === Object) {
    if (Object.keys(result).length === 0) {
      return Promise.resolve("*(empty table)*");
    }
    return jsonToMDTable([result], cellTransformer);
  } else if (Array.isArray(result)) {
    if (result.length === 0) {
      return Promise.resolve("*(empty table)*");
    }
    return renderListItems(result, cellTransformer, false);
  } else {
    return Promise.resolve(`${result}`);
  }
}

// Render a `LuaTable` to Markdown (table for records, list for arrays)
async function renderLuaTableToMarkdown(
  tbl: LuaTable,
  cellTransformer: (v: any, k: string) => Promise<string>,
  nested = false,
): Promise<string> {
  const keys = tbl.keys();
  if (keys.length === 0) return "*(empty table)*";

  const arrayLen = tbl.length;
  const stringKeys: string[] = [];
  for (const k of keys) {
    if (typeof k === "string") stringKeys.push(k);
  }

  const hasArrayPart = arrayLen > 0;
  const hasStrKeys = stringKeys.length > 0;

  // Pure array
  if (hasArrayPart && !hasStrKeys) {
    const elements: any[] = [];
    for (let i = 1; i <= arrayLen; i++) elements.push(tbl.rawGet(i));
    // If all elements are `LuaTables` then to Markdown table
    if (elements.every((el) => el instanceof LuaTable)) {
      return renderLuaTableArrayToMarkdown(
        elements as LuaTable[],
        cellTransformer,
      );
    }
    // Flat list
    return renderListItems(elements, cellTransformer, nested);
  }

  // Record or mixed - use `keys` order directly (preserve order)
  const allHeaders: string[] = keys.map(String);

  const lines: string[] = [
    `|${allHeaders.join("|")}|`,
    `|${allHeaders.map(() => "--").join("|")}|`,
  ];
  const cells: string[] = [];
  for (const k of keys) {
    const v = tbl.rawGet(k);
    cells.push(await cellTransformer(v, String(k)));
  }
  lines.push(`|${cells.join("|")}|`);
  return lines.join("\n");
}

// Render a list of items as indented Markdown list
async function renderListItems(
  items: any[],
  cellTransformer: (v: any, k: string) => Promise<string>,
  nested: boolean,
): Promise<string> {
  const rendered: string[] = [];
  for (const item of items) {
    const md = await renderItemToMarkdown(item, cellTransformer, nested);
    if (md.includes("\n")) {
      const lines = md.split("\n");
      rendered.push(`-\n${lines.map((l) => `  ${l}`).join("\n")}`);
    } else {
      rendered.push(`- ${md}`);
    }
  }
  return rendered.join("\n");
}

// Render a single item for use inside a list
function renderItemToMarkdown(
  item: any,
  cellTransformer: (v: any, k: string) => Promise<string>,
  nested: boolean,
): Promise<string> {
  if (item === undefined || item === null) return Promise.resolve("");
  if (item instanceof LuaTable) {
    if (item.empty()) return Promise.resolve("*(empty table)*");
    if (nested) {
      return item.toStringAsync();
    }
    return renderLuaTableToMarkdown(item, cellTransformer, true);
  }
  if (Array.isArray(item)) {
    if (item.length === 0) return Promise.resolve("*(empty table)*");
    if (isPlainObjectHelper(item)) {
      return jsonToMDTable(item, cellTransformer);
    }
    if (nested) {
      return Promise.resolve(JSON.stringify(item));
    }
    return renderListItems(item, cellTransformer, true);
  }
  if (isPlainObjectHelper(item)) {
    if (Object.keys(item).length === 0) {
      return Promise.resolve("*(empty table)*");
    }
    if (nested) {
      return Promise.resolve(JSON.stringify(item));
    }
    return jsonToMDTable([item], cellTransformer);
  }
  if (isTaggedFloat(item)) {
    return Promise.resolve(luaFormatNumber(item.value, "float"));
  }
  if (typeof item === "number") return Promise.resolve(luaFormatNumber(item));
  return Promise.resolve(`${item}`);
}

function isPlainObjectHelper(v: any): v is Record<string, any> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    v.constructor === Object
  );
}

// Array of record-like `LuaTables` to multi-row Markdown table
async function renderLuaTableArrayToMarkdown(
  tables: LuaTable[],
  cellTransformer: (v: any, k: string) => Promise<string>,
): Promise<string> {
  const headerSet = new Set<string>();
  for (const tbl of tables) {
    for (const k of tbl.keys()) headerSet.add(String(k));
  }
  if (headerSet.size === 0) return "*(empty table)*";
  const headers = [...headerSet];

  const lines: string[] = [
    `|${headers.join("|")}|`,
    `|${headers.map(() => "--").join("|")}|`,
  ];
  for (const tbl of tables) {
    const cells: string[] = [];
    for (const h of headers) {
      const key = /^\d+$/.test(h) ? Number(h) : h;
      const v = tbl.rawGet(key);
      cells.push(await cellTransformer(v, h));
    }
    lines.push(`|${cells.join("|")}|`);
  }
  return lines.join("\n");
}

/**
 * Applies some heuristics to figure out if a string should be rendered as a markdown block or inline markdown
 * @param s markdown string
 */
export function isBlockMarkdown(s: string) {
  if (s.includes("\n")) {
    return true;
  }
  // If it contains something resembling a list
  return !!s.match(/[-*]\s+/);
}
