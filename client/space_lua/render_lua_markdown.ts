import {
  defaultTransformer,
  escapeRegularPipes,
  jsonToMDTable,
} from "../markdown_renderer/result_render.ts";
import { isSqlNull } from "../space_lua/liq_null.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import { LuaTable, luaFormatNumber } from "../space_lua/runtime.ts";

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
 * Classification of a JS/Lua value that drives both the HTML and the
 * clean-markdown renderers. Keeping this in one place ensures the two
 * output paths stay in lock-step when new cases are added.
 */
export type Classified =
  | { kind: "nil"; dataType: "nil" }
  | {
      kind: "scalar";
      text: string;
      dataType: "string" | "number" | "boolean";
    }
  | { kind: "emptyTable"; dataType: "table" }
  | {
      kind: "record";
      headers: string[];
      getCell: (header: string) => any;
      dataType: "table";
    }
  | {
      kind: "recordArray";
      headers: string[];
      rowCount: number;
      getCell: (rowIndex: number, header: string) => any;
      // LuaTable record-arrays are historically tagged as "list", while
      // JS record-arrays are tagged as "table". Preserved for compatibility.
      dataType: "table" | "list";
    }
  | { kind: "scalarArray"; items: any[]; dataType: "list" };

export function classifyResult(result: any): Classified {
  if (isEmpty(result)) return { kind: "nil", dataType: "nil" };
  if (typeof result === "string") {
    return { kind: "scalar", text: result, dataType: "string" };
  }
  if (isTaggedFloat(result)) {
    return {
      kind: "scalar",
      text: luaFormatNumber(result.value, "float"),
      dataType: "number",
    };
  }
  if (typeof result === "number") {
    return {
      kind: "scalar",
      text: luaFormatNumber(result),
      dataType: "number",
    };
  }
  if (typeof result === "boolean") {
    return {
      kind: "scalar",
      text: result ? "true" : "false",
      dataType: "boolean",
    };
  }

  if (result instanceof LuaTable) {
    if (result.empty()) return { kind: "emptyTable", dataType: "table" };
    const keys = result.keys();
    const arrayLen = result.length;
    const hasStrKeys = keys.some((k) => typeof k === "string");

    // Pure array
    if (arrayLen > 0 && !hasStrKeys) {
      const elements: any[] = [];
      for (let i = 1; i <= arrayLen; i++) elements.push(result.rawGet(i));
      if (elements.every((el) => el instanceof LuaTable)) {
        const tables = elements as LuaTable[];
        const headers = collectHeaders(tables, (t) => t.keys().map(String));
        if (headers.length === 0) {
          return { kind: "emptyTable", dataType: "table" };
        }
        return {
          kind: "recordArray",
          headers,
          rowCount: tables.length,
          getCell: (i, h) => {
            const key = /^\d+$/.test(h) ? Number(h) : h;
            return tables[i].rawGet(key);
          },
          dataType: "list",
        };
      }
      return { kind: "scalarArray", items: elements, dataType: "list" };
    }

    // Has string keys (record or mixed) — single-row table
    const headers = keys.map(String);
    return {
      kind: "record",
      headers,
      getCell: (h) => {
        const key = keys[headers.indexOf(h)];
        return result.rawGet(key);
      },
      dataType: "table",
    };
  }

  if (Array.isArray(result)) {
    if (result.length === 0) return { kind: "emptyTable", dataType: "table" };
    if (result.every(isPlainObject)) {
      const headers = collectHeaders(result, Object.keys);
      return {
        kind: "recordArray",
        headers,
        rowCount: result.length,
        getCell: (i, h) => result[i][h],
        dataType: "table",
      };
    }
    return { kind: "scalarArray", items: result, dataType: "list" };
  }

  if (isPlainObject(result)) {
    if (Object.keys(result).length === 0) {
      return { kind: "emptyTable", dataType: "table" };
    }
    const headers = Object.keys(result);
    return {
      kind: "record",
      headers,
      getCell: (h) => result[h],
      dataType: "table",
    };
  }

  return { kind: "scalar", text: `${result}`, dataType: "string" };
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
export function renderResultToMarkdown(
  result: any,
  classified: Classified = classifyResult(result),
): {
  markdown: string;
  dataType: string;
} {
  switch (classified.kind) {
    case "nil":
      return { markdown: "", dataType: "nil" };
    case "scalar":
      return { markdown: classified.text, dataType: classified.dataType };
    case "emptyTable":
      return { markdown: emptyTable, dataType: "table" };
    case "record":
      return {
        markdown: buildHtmlTable(classified.headers, 1, (_i, h) =>
          classified.getCell(h),
        ),
        dataType: "table",
      };
    case "recordArray":
      return {
        markdown: buildHtmlTable(
          classified.headers,
          classified.rowCount,
          classified.getCell,
        ),
        dataType: classified.dataType,
      };
    case "scalarArray":
      return {
        markdown: renderArrayToMarkdown(classified.items),
        dataType: "list",
      };
  }
}

/**
 * Render any Lua/JS value as "clean" GFM-style markdown suitable for
 * the Copy button. Tables render as pipe tables, scalar arrays as
 * newline-joined lines, scalars as their plain text.
 *
 * Nested structures inside a table cell degrade to their Lua literal
 * form (via `LuaTable.toStringAsync()` in `defaultTransformer`), since
 * GFM table cells cannot contain block-level content.
 */
/**
 * Cell transformer for the clean-markdown (copy) path. Renders:
 *  - `ref` columns as wiki links,
 *  - scalar arrays as `<br/>`-joined lines (mirrors the HTML display
 *    path, and relies on the markdown renderer now handling self-closing
 *    `<br/>` inside GFM table cells),
 *  - everything else via `defaultTransformer` (which Lua-encodes nested
 *    tables and escapes pipes for scalars).
 */
function cleanCellTransformer(v: any, k: string): Promise<string> {
  if (k === "ref") return Promise.resolve(`[[${v}]]`);
  const c = classifyResult(v);
  if (c.kind === "scalarArray") {
    return Promise.resolve(
      c.items
        .map(formatScalar)
        .map((s) => escapeRegularPipes(s.replaceAll("\n", " ")))
        .join("<br/>"),
    );
  }
  return defaultTransformer(v, k);
}

export async function renderResultToCleanMarkdown(
  result: any,
  classified: Classified = classifyResult(result),
): Promise<string> {
  switch (classified.kind) {
    case "nil":
      return "";
    case "scalar":
      return classified.text;
    case "emptyTable":
      return "*(empty table)*";
    case "record": {
      const row: Record<string, any> = {};
      for (const h of classified.headers) row[h] = classified.getCell(h);
      return jsonToMDTable([row], cleanCellTransformer);
    }
    case "recordArray": {
      const rows: Record<string, any>[] = [];
      for (let i = 0; i < classified.rowCount; i++) {
        const row: Record<string, any> = {};
        for (const h of classified.headers) row[h] = classified.getCell(i, h);
        rows.push(row);
      }
      return jsonToMDTable(rows, cleanCellTransformer);
    }
    case "scalarArray":
      return classified.items.map(formatScalar).join("\n");
  }
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
  return items.map((item) => renderCellContent(item)).join("<br/>");
}

/**
 * Render a value as cell content. Used inside HTML contexts (table
 * cells, nested structures) where markdown block syntax won't be
 * parsed, so scalar arrays are joined with `<br/>` rather than newlines.
 */
function renderCellContent(v: any): string {
  const c = classifyResult(v);
  switch (c.kind) {
    case "nil":
      return "";
    case "scalar":
      return c.text;
    case "emptyTable":
      return emptyTable;
    case "record":
      return buildHtmlTable(c.headers, 1, (_i, h) => c.getCell(h));
    case "recordArray":
      return buildHtmlTable(c.headers, c.rowCount, c.getCell);
    case "scalarArray":
      return renderArrayToHtmlLines(c.items);
  }
}
