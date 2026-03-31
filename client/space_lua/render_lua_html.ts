import { luaFormatNumber, LuaTable } from "../space_lua/runtime.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";
import { isSqlNull } from "../space_lua/liq_null.ts";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Render inline Markdown to HTML (caller provides the implementation)
export type InlineRenderer = (text: string) => string | Promise<string>;

function defaultInlineRenderer(text: string): string {
  return escapeHtml(text);
}

function luaTypeName(
  v: any,
): "number" | "string" | "boolean" | "table" | "array" | undefined {
  if (v === undefined || v === null || isSqlNull(v)) return undefined;
  if (typeof v === "number" || isTaggedFloat(v)) return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof LuaTable) {
    return hasStringKeys(v) ? "table" : "array";
  }
  if (Array.isArray(v)) return "array";
  if (isPlainObject(v)) return "table";
  return "string";
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

function hasStringKeys(tbl: LuaTable): boolean {
  for (const k of tbl.keys()) {
    if (typeof k === "string") return true;
  }
  return false;
}

function formatScalar(v: any): string {
  if (isEmpty(v)) return "";
  if (isTaggedFloat(v)) return luaFormatNumber(v.value, "float");
  if (typeof v === "number") return luaFormatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `${v}`;
}

/**
 * Render any Lua/JS value to an HTML string with data attributes.
 * Also sets data-type and data-empty on the outermost element when
 * used for widget display.
 */
export async function renderResultToHtml(
  result: any,
  renderInline: InlineRenderer = defaultInlineRenderer,
): Promise<{
  html: string;
  dataType: string;
}> {
  if (isEmpty(result)) {
    return {
      html: `<span data-empty></span>`,
      dataType: "nil",
    };
  }
  if (typeof result === "string") {
    return {
      html: await renderInline(result),
      dataType: "string",
    };
  }
  if (isTaggedFloat(result)) {
    return {
      html: escapeHtml(luaFormatNumber(result.value, "float")),
      dataType: "number",
    };
  }
  if (typeof result === "number") {
    return {
      html: escapeHtml(luaFormatNumber(result)),
      dataType: "number",
    };
  }
  if (typeof result === "boolean") {
    return {
      html: result ? "true" : "false",
      dataType: "boolean",
    };
  }
  if (result instanceof LuaTable) {
    if (result.empty()) {
      return {
        html: `<table data-table-empty></table>`,
        dataType: "table",
      };
    }
    const html = await renderLuaTableToHtml(result, renderInline);
    const type = hasStringKeys(result) ? "table" : "list";
    return { html, dataType: type };
  }
  if (Array.isArray(result)) {
    if (result.length === 0) {
      return {
        html: `<table data-table-empty></table>`,
        dataType: "table",
      };
    }
    if (result.every(isPlainObject)) {
      return {
        html: await renderJsObjectArrayToHtml(result, renderInline),
        dataType: "table",
      };
    }
    return {
      html: await renderJsArrayToHtml(result, renderInline),
      dataType: "list",
    };
  }
  if (isPlainObject(result)) {
    if (Object.keys(result).length === 0) {
      return {
        html: `<table data-table-empty></table>`,
        dataType: "table",
      };
    }
    return {
      html: await renderJsObjectArrayToHtml([result], renderInline),
      dataType: "table",
    };
  }
  return {
    html: await renderInline(`${result}`),
    dataType: "string",
  };
}

async function renderLuaTableToHtml(
  tbl: LuaTable,
  renderInline: InlineRenderer,
): Promise<string> {
  const keys = tbl.keys();
  if (keys.length === 0) return `<table data-table-empty></table>`;

  const arrayLen = tbl.length;
  const stringKeys: string[] = [];
  for (const k of keys) {
    if (typeof k === "string") stringKeys.push(k);
  }

  const hasArrayPart = arrayLen > 0;
  const hasStrKeys = stringKeys.length > 0;

  // Pure array (render as `<ul>` or multi-row `<table>`)
  if (hasArrayPart && !hasStrKeys) {
    const elements: any[] = [];
    for (let i = 1; i <= arrayLen; i++) elements.push(tbl.rawGet(i));
    // If all elements are `LuaTables` then render as multi-row table
    if (elements.every((el) => el instanceof LuaTable)) {
      return renderLuaTableArrayToHtml(elements as LuaTable[], renderInline);
    }
    return renderArrayToHtml(elements, renderInline);
  }

  // Has string keys (record or mixed) - use `keys` order directly
  const lines: string[] = [];
  lines.push("<table>");
  lines.push("<thead><tr>");
  for (const k of keys) lines.push(`<th>${escapeHtml(String(k))}</th>`);
  lines.push("</tr></thead>");
  lines.push("<tbody><tr>");
  for (const k of keys) {
    const v = tbl.rawGet(k);
    lines.push(await renderTdHtml(v, renderInline));
  }
  lines.push("</tr></tbody>");
  lines.push("</table>");
  return lines.join("");
}

// Array of record-like LuaTables to multi-row `<table>`
async function renderLuaTableArrayToHtml(
  tables: LuaTable[],
  renderInline: InlineRenderer,
): Promise<string> {
  const headerSet = new Set<string>();
  for (const tbl of tables) {
    for (const k of tbl.keys()) headerSet.add(String(k));
  }
  if (headerSet.size === 0) return `<table data-table-empty></table>`;
  const headers = [...headerSet];

  const lines: string[] = [];
  lines.push("<table>");
  lines.push("<thead><tr>");
  for (const h of headers) lines.push(`<th>${escapeHtml(h)}</th>`);
  lines.push("</tr></thead>");
  lines.push("<tbody>");
  for (const tbl of tables) {
    lines.push("<tr>");
    for (const h of headers) {
      const key = /^\d+$/.test(h) ? Number(h) : h;
      const v = tbl.rawGet(key);
      lines.push(await renderTdHtml(v, renderInline));
    }
    lines.push("</tr>");
  }
  lines.push("</tbody>");
  lines.push("</table>");
  return lines.join("");
}

async function renderJsObjectArrayToHtml(
  jsonArray: Record<string, any>[],
  renderInline: InlineRenderer,
): Promise<string> {
  const headerSet = new Set<string>();
  for (const entry of jsonArray) {
    for (const k of Object.keys(entry)) headerSet.add(k);
  }
  if (headerSet.size === 0) return `<table data-table-empty></table>`;
  const headers = [...headerSet];

  const lines: string[] = [];
  lines.push("<table>");
  lines.push("<thead><tr>");
  for (const h of headers) lines.push(`<th>${escapeHtml(h)}</th>`);
  lines.push("</tr></thead>");
  lines.push("<tbody>");
  for (const row of jsonArray) {
    lines.push("<tr>");
    for (const h of headers) {
      lines.push(await renderTdHtml(row[h], renderInline));
    }
    lines.push("</tr>");
  }
  lines.push("</tbody>");
  lines.push("</table>");
  return lines.join("");
}

async function renderArrayToHtml(
  items: any[],
  renderInline: InlineRenderer,
): Promise<string> {
  const lines: string[] = [];
  lines.push("<ul>");
  for (const item of items) {
    lines.push(await renderLiHtml(item, renderInline));
  }
  lines.push("</ul>");
  return lines.join("");
}

function renderJsArrayToHtml(
  items: any[],
  renderInline: InlineRenderer,
): Promise<string> {
  return renderArrayToHtml(items, renderInline);
}

async function renderTdHtml(
  v: any,
  renderInline: InlineRenderer,
): Promise<string> {
  const type = luaTypeName(v);
  const attrs: string[] = [];
  if (type) {
    attrs.push(`data-table-cell-type="${type}"`);
  }
  if (isEmpty(v)) {
    attrs.push("data-table-cell-empty");
  }
  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  const content = await renderCellContent(v, renderInline);
  return `<td${attrStr}>${content}</td>`;
}

async function renderLiHtml(
  v: any,
  renderInline: InlineRenderer,
): Promise<string> {
  const type = luaTypeName(v);
  const attrs: string[] = [];
  if (type) {
    attrs.push(`data-list-item-type="${type}"`);
  }
  if (isEmpty(v)) {
    attrs.push("data-list-item-empty");
  }
  const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  const content = await renderCellContent(v, renderInline);
  return `<li${attrStr}>${content}</li>`;
}

// Render a value content (recurse for nested tables/arrays)
async function renderCellContent(
  v: any,
  renderInline: InlineRenderer,
): Promise<string> {
  if (isEmpty(v)) return Promise.resolve("");
  if (isTaggedFloat(v)) {
    return renderInline(luaFormatNumber(v.value, "float"));
  }
  if (v instanceof LuaTable) {
    if (v.empty()) return Promise.resolve(`<table data-table-empty></table>`);
    return renderLuaTableToHtml(v, renderInline);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) {
      return Promise.resolve(`<table data-table-empty></table>`);
    }
    if (v.every(isPlainObject)) {
      return renderJsObjectArrayToHtml(v, renderInline);
    }
    return renderArrayToHtml(v, renderInline);
  }
  if (isPlainObject(v)) {
    if (Object.keys(v).length === 0) {
      return Promise.resolve(`<table data-table-empty></table>`);
    }
    return renderJsObjectArrayToHtml([v], renderInline);
  }
  return renderInline(formatScalar(v));
}
