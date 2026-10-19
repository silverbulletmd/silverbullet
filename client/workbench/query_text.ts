/**
 * Generates `${query[[…]]}` text from a builder model: what the query bar
 * shows is exactly what Copy and Insert produce.
 */

import { parseExpressionString } from "../space_lua/parse.ts";
import { type FieldInfo, tableKey } from "./query_fields.ts";
import { sourceLua } from "./query_from.ts";
import {
  fieldAccess,
  fieldType,
  type GroupColumn,
  objectVar,
  type QueryModel,
  type Sort,
  type TableColumn,
} from "./query_model.ts";
import { filterLua, luaString } from "./query_ops.ts";

/** Whether `cond` is an `or` at its top level, which `and` would bind into */
function isOr(cond: string): boolean {
  try {
    const e = parseExpressionString(cond);
    return e.type === "Binary" && e.operator === "or";
  } catch {
    // An invalid expression is kept as typed
    return false;
  }
}

function columnLua(c: TableColumn, v: string): string {
  switch (c.kind) {
    case "expr":
      return c.value || "nil";
    case "link":
      return `"[[" .. ${fieldAccess(v, c.value)} .. "]]"`;
    default:
      return fieldAccess(v, c.value);
  }
}

function keyLua(m: QueryModel, field: string): string | null {
  const i = m.group.indexOf(field);
  if (i < 0) return null;
  return m.group.length > 1 ? `key[${i + 1}]` : "key";
}

function groupColumnLua(c: GroupColumn, m: QueryModel, v: string): string {
  if (c.kind === "key") return keyLua(m, c.field) ?? "nil";
  const access = fieldAccess(v, c.field);
  const call =
    c.agg === "array_agg" && c.sorted
      ? `array_agg(${access} order by ${access})`
      : `${c.agg}(${access})`;
  return c.where ? `${call} filter(where ${c.where})` : call;
}

/** A sort's Lua, or null when what it refers to is gone */
function sortLua(
  { by, desc, nulls }: Sort,
  m: QueryModel,
  v: string,
): string | null {
  const grouped = m.group.length > 0;
  let key: string | null;
  switch (by.kind) {
    case "expr":
      key = by.lua;
      break;
    case "field":
      key = grouped ? null : fieldAccess(v, by.field);
      break;
    case "groupKey":
      key = keyLua(m, by.field);
      break;
    case "column": {
      const c = m.groupColumns.find((x) => x.id === by.id);
      key = c && grouped ? groupColumnLua(c, m, v) : null;
      break;
    }
  }
  if (key === null) return null;
  return `${key}${desc ? " desc" : ""}${nulls ? ` nulls ${nulls}` : ""}`;
}

/**
 * The custom template as a Lua string literal: a long bracket when one holds
 * the text (the grammar has levels 0–2, with stricter content rules than
 * Lua's, so each is checked with the parser), otherwise a quoted string.
 */
function templateLiteral(text: string): string {
  for (const eq of ["==", "=", ""]) {
    const literal = `[${eq}[\n    ${text}\n  ]${eq}]`;
    try {
      parseExpressionString(literal);
      return literal;
    } catch {
      // try the next level
    }
  }
  return luaString(text);
}

function block(entries: string[]): string {
  return `{\n    ${entries.join(",\n    ")}\n  }`;
}

function selectLua(m: QueryModel, v: string): string | null {
  if (m.group.length) {
    if (!m.groupColumns.length) return null;
    return block(
      m.groupColumns.map(
        (c) =>
          `${tableKey(c.header || (c.kind === "key" ? c.field : c.agg))} = ${groupColumnLua(c, m, v)}`,
      ),
    );
  }
  if (m.select.mode === "table") {
    if (!m.select.columns.length) return null;
    return block(
      m.select.columns.map(
        (c) => `${tableKey(c.header || c.value)} = ${columnLua(c, v)}`,
      ),
    );
  }
  const list = m.select.list;
  if ("template" in list) return `${list.template}(${v})`;
  const literal = templateLiteral(list.custom);
  return literal.startsWith('"')
    ? `template.new(${literal})(${v})`
    : `template.new${literal}(${v})`;
}

export function generateQuery(
  m: QueryModel,
  fields: FieldInfo[],
  opts: { wrap?: boolean } = {},
): string {
  const v = objectVar(m);
  const source = sourceLua(m.source);
  const lines = [
    m.binding ? `from ${m.binding} = ${source}` : `from ${source}`,
  ];
  if (m.filters.length) {
    const conds = m.filters.map((f) => {
      const cond = filterLua(
        f,
        f.kind === "field" ? fieldAccess(v, f.field) : "",
        f.kind === "field" ? fieldType(m, fields, f.field) : "text",
      );
      // `and` binds tighter than `or`: keep each filter's meaning
      return m.filters.length > 1 && isOr(cond) ? `(${cond})` : cond;
    });
    lines.push(`where ${conds.join("\n    and ")}`);
  }
  if (m.group.length) {
    lines.push(`group by ${m.group.map((g) => fieldAccess(v, g)).join(", ")}`);
  }
  const sorts = m.sorts
    .map((s) => sortLua(s, m, v))
    .filter((s): s is string => s !== null);
  if (sorts.length) lines.push(`order by ${sorts.join(", ")}`);
  if (m.limit !== null) lines.push(`limit ${m.limit}`);
  const select = selectLua(m, v);
  if (select) lines.push(`select ${select}`);

  const body = lines.map((l) => `  ${l}`).join("\n");
  const query = `query[[\n${body}\n]]`;
  return opts.wrap === false ? query : `\${${query}}`;
}
