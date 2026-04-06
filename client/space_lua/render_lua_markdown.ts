import { luaFormatNumber, LuaTable } from "../space_lua/runtime.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import { isSqlNull } from "../space_lua/liq_null.ts";

/**
 * Applies some heuristics to figure out if a string should be rendered
 * as a markdown block or inline markdown.
 */
export function isBlockMarkdown(s: string) {
  if (s.includes("\n")) {
    return true;
  }
  return !!s.match(/[-*]\s+/);
}

function isEmpty(v: any): boolean {
  return v === undefined || v === null || isSqlNull(v);
}

function isPlainObject(v: any): v is Record<string, any> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    v.constructor === Object
  );
}

function formatScalar(v: any): string {
  if (isEmpty(v)) return "";
  if (isTaggedFloat(v)) return luaFormatNumber(v.value, "float");
  if (typeof v === "number") return luaFormatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `${v}`.trim();
}

const emptyTable = "<table data-table-empty></table>";

/**
 * Build an HTML table from string headers and a row accessor.
 * Each row is rendered by calling `getCell(rowIndex, header)`.
 */
function buildHtmlTable(
  headers: string[],
  rowCount: number,
  getCell: (rowIndex: number, header: string) => any,
): string {
  if (headers.length === 0) return emptyTable;
  const parts: string[] = ["<table><thead><tr>"];
  for (const h of headers) parts.push(`<th>${h}</th>`);
  parts.push("</tr></thead><tbody>");
  for (let i = 0; i < rowCount; i++) {
    parts.push("<tr>");
    for (const h of headers) parts.push(renderTd(getCell(i, h)));
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("");
}

/** Collect the union of string keys across items. */
function collectHeaders<T>(
  items: T[],
  getKeys: (item: T) => Iterable<string>,
): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const k of getKeys(item)) set.add(k);
  }
  return [...set];
}

/**
 * Render any Lua/JS value to a markdown string (with embedded HTML
 * for structured data like tables).
 *
 * Scalar lists are rendered as plain lines. Tables use HTML for
 * full nesting support.
 *
 * The returned markdown can be fed through the markdown parser and
 * renderer to produce final HTML, getting wiki links, hashtags,
 * formatting etc. for free.
 */
export function renderResultToMarkdown(result: any): {
  markdown: string;
  dataType: string;
} {
  if (isEmpty(result)) {
    return { markdown: "", dataType: "nil" };
  }
  if (typeof result === "string") {
    return { markdown: result, dataType: "string" };
  }
  if (isTaggedFloat(result)) {
    return {
      markdown: luaFormatNumber(result.value, "float"),
      dataType: "number",
    };
  }
  if (typeof result === "number") {
    return { markdown: luaFormatNumber(result), dataType: "number" };
  }
  if (typeof result === "boolean") {
    return { markdown: result ? "true" : "false", dataType: "boolean" };
  }
  if (result instanceof LuaTable) {
    if (result.empty()) {
      return { markdown: emptyTable, dataType: "table" };
    }
    return renderLuaTable(result);
  }
  if (Array.isArray(result)) {
    if (result.length === 0) {
      return { markdown: emptyTable, dataType: "table" };
    }
    if (result.every(isPlainObject)) {
      const headers = collectHeaders(result, Object.keys);
      return {
        markdown: buildHtmlTable(
          headers,
          result.length,
          (i, h) => result[i][h],
        ),
        dataType: "table",
      };
    }
    return { markdown: renderArrayToMarkdown(result), dataType: "list" };
  }
  if (isPlainObject(result)) {
    if (Object.keys(result).length === 0) {
      return { markdown: emptyTable, dataType: "table" };
    }
    const headers = Object.keys(result);
    return {
      markdown: buildHtmlTable(headers, 1, (_i, h) => result[h]),
      dataType: "table",
    };
  }
  return { markdown: `${result}`, dataType: "string" };
}

function renderLuaTable(tbl: LuaTable): { markdown: string; dataType: string } {
  const keys = tbl.keys();
  if (keys.length === 0) return { markdown: emptyTable, dataType: "table" };

  const arrayLen = tbl.length;
  const hasStrKeys = keys.some((k) => typeof k === "string");

  // Pure array
  if (arrayLen > 0 && !hasStrKeys) {
    const elements: any[] = [];
    for (let i = 1; i <= arrayLen; i++) elements.push(tbl.rawGet(i));
    if (elements.every((el) => el instanceof LuaTable)) {
      return {
        markdown: renderLuaTableArray(elements as LuaTable[]),
        dataType: "list",
      };
    }
    return { markdown: renderArrayToMarkdown(elements), dataType: "list" };
  }

  // Has string keys (record or mixed) — single-row table
  const headers = keys.map(String);
  return {
    markdown: buildHtmlTable(headers, 1, (_i, h) => {
      const key = keys[headers.indexOf(h)];
      return tbl.rawGet(key);
    }),
    dataType: "table",
  };
}

function renderLuaTableArray(tables: LuaTable[]): string {
  const headers = collectHeaders(tables, (t) => t.keys().map(String));
  if (headers.length === 0) return emptyTable;
  return buildHtmlTable(headers, tables.length, (i, h) => {
    const key = /^\d+$/.test(h) ? Number(h) : h;
    return tables[i].rawGet(key);
  });
}

function luaTypeName(v: any): string | undefined {
  if (isEmpty(v)) return undefined;
  if (typeof v === "number" || isTaggedFloat(v)) return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof LuaTable) {
    return v.keys().some((k) => typeof k === "string") ? "table" : "array";
  }
  if (Array.isArray(v)) return "array";
  if (isPlainObject(v)) return "table";
  return "string";
}

function renderTd(v: any): string {
  if (isEmpty(v)) return "<td data-table-cell-empty></td>";
  const type = luaTypeName(v);
  const attr = type ? ` data-table-cell-type="${type}"` : "";
  return `<td${attr}>${renderCellContent(v)}</td>`;
}

function renderArrayToMarkdown(items: any[]): string {
  return items.map((item) => renderCellContent(item)).join("\n");
}

function renderArrayToHtmlLines(items: any[]): string {
  return items.map((item) => renderCellContent(item)).join("<br>");
}

/**
 * Render a value as cell content. Used inside HTML contexts (table
 * cells, nested structures) where markdown block syntax won't be
 * parsed, so arrays are rendered as HTML <ul> lists.
 */
function renderCellContent(v: any): string {
  if (isEmpty(v)) return "";
  if (isTaggedFloat(v)) return luaFormatNumber(v.value, "float");
  if (v instanceof LuaTable) {
    if (v.empty()) return emptyTable;
    const keys = v.keys();
    const hasStrKeys = keys.some((k) => typeof k === "string");
    if (!hasStrKeys && v.length > 0) {
      const elements: any[] = [];
      for (let i = 1; i <= v.length; i++) elements.push(v.rawGet(i));
      if (elements.every((el) => el instanceof LuaTable)) {
        return renderLuaTableArray(elements as LuaTable[]);
      }
      return renderArrayToHtmlLines(elements);
    }
    return renderLuaTable(v).markdown;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return emptyTable;
    if (v.every(isPlainObject)) {
      const headers = collectHeaders(v, Object.keys);
      return buildHtmlTable(headers, v.length, (i, h) => v[i][h]);
    }
    return renderArrayToHtmlLines(v);
  }
  if (isPlainObject(v)) {
    if (Object.keys(v).length === 0) return emptyTable;
    const headers = Object.keys(v);
    return buildHtmlTable(headers, 1, (_i, h) => v[h]);
  }
  return formatScalar(v);
}
