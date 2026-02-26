import {
  luaFormatNumber,
  LuaTable,
  luaToString,
} from "../space_lua/runtime.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import { LUA_SQL_NULL } from "../space_lua/query_collection.ts";

export function defaultTransformer(v: any, _k: string): Promise<string> {
  if (v === undefined) {
    return Promise.resolve("");
  }
  if (v === LUA_SQL_NULL) {
    return Promise.resolve("*(null)*");
  }
  if (typeof v === "string") {
    return Promise.resolve(escapeRegularPipes(v.replaceAll("\n", " ")));
  }
  if (v && typeof v === "object") {
    return Promise.resolve(luaToString(v));
  }
  if (typeof v === "number") {
    return Promise.resolve(luaFormatNumber(v));
  }
  return Promise.resolve("" + v);
}

export function refCellTransformer(v: any, k: string) {
  if (k === "ref") {
    return Promise.resolve(`[[${v}]]`);
  } else {
    return defaultTransformer(v, k);
  }
}

/**
 * Escapes all pipes that would inadvertently delimit a markdown table column.
 * Does not escape columns that are used for aliasing in WikiLinks or Commands:
 * `[[WikiLink|Alias]]` and `{[Command: Name|Click Me!]("args")}`
 * @param s The text to replace
 * @returns The text where the pipes outside of silverbullet specific context is
 *  replaced with an escaped pipe.
 */
function escapeRegularPipes(s: string) {
  let result = "";
  let isInWikiLink = false;
  let isInCommandButton = false;

  for (let i = 0; i < s.length; i++) {
    if (s[i] == "[" && s[i + 1] == "[") {
      isInWikiLink = true;
    } else if (s[i] == "]" && s[i + 1] == "]" && isInWikiLink) {
      isInWikiLink = false;
    }
    if (s[i] == "{" && s[i + 1] == "[") {
      isInCommandButton = true;
    } else if (
      (s[i] == "]" || s[i] == ")") && s[i + 1] == "}" && isInCommandButton
    ) {
      isInCommandButton = false;
    } else if (s[i] == "|" && !isInWikiLink && !isInCommandButton) {
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
  if (headers.size == 0) {
    return "*(empty table)*";
  }

  const headerList = [...headers];
  const lines = [];
  lines.push(
    "|" +
      headerList
        .map(
          (headerName) => headerName,
        )
        .join("|") +
      "|",
  );
  lines.push(
    "|" +
      headerList
        .map(() => "--")
        .join("|") +
      "|",
  );
  for (const val of jsonArray) {
    const el = [];
    for (const prop of headerList) {
      const s = await valueTransformer(val[prop], prop);
      el.push(s);
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");
}

export function renderExpressionResult(result: any): Promise<string> {
  if (result === undefined || result === null) {
    return Promise.resolve("nil");
  }
  if (result instanceof LuaTable) {
    result = result.toJS();
  }
  // Must check before object/array checks — tagged floats are plain objects
  if (isTaggedFloat(result)) {
    return Promise.resolve(luaFormatNumber(result.value, "float"));
  }
  if (typeof result === "number") {
    return Promise.resolve(luaFormatNumber(result));
  }
  if (
    Array.isArray(result) && result.length > 0 && typeof result[0] === "object"
  ) {
    // If result is an array of objects, render as a Markdown table
    try {
      return jsonToMDTable(result);
    } catch (e: any) {
      console.error(
        `Error rendering expression directive: ${e.message} for value ${
          JSON.stringify(result)
        }`,
      );
      return Promise.resolve(JSON.stringify(result));
    }
  } else if (typeof result === "object" && result.constructor === Object) {
    // If result is a plain object, render as a Markdown table
    return jsonToMDTable([result]);
  } else if (Array.isArray(result)) {
    // Not-object array, let's render it as a Markdown list
    return Promise.resolve(result.map((item) => `- ${item}`).join("\n"));
  } else {
    return Promise.resolve("" + result);
  }
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
  return !!s.match(/[\-\*]\s+/);
}
