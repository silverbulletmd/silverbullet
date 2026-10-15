import type { LuaExpression, LuaTableField } from "./ast.ts";
import { isTaggedFloat } from "./numeric.ts";
import { extractDefinitions } from "./page_definitions.ts";
import { parseExpressionString } from "./parse.ts";
import { prettyPrintExpression } from "./pretty_print.ts";
import { LuaTable } from "./runtime.ts";

export type TextEdit = { from: number; to: number; insert: string };

const NOT_STORABLE =
  "pageVars.set: only numbers, strings, booleans, nil and tables of these can be stored";

/** `value` written as Lua source; throws for anything a cell can't hold. */
export function toLuaLiteral(value: unknown): string {
  return prettyPrintExpression(toLiteralExpression(value));
}

function toLiteralExpression(
  value: unknown,
  numericType?: "int" | "float",
  open = new Set<LuaTable>(),
): LuaExpression {
  const ctx = {};
  if (value === null || value === undefined) return { type: "Nil", ctx };
  if (typeof value === "boolean") return { type: "Boolean", value, ctx };
  if (isTaggedFloat(value)) {
    if (!Number.isFinite(value.value)) throw new Error(NOT_STORABLE);
    return { type: "Number", value: value.value, numericType: "float", ctx };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(NOT_STORABLE);
    return { type: "Number", value, numericType: numericType ?? "int", ctx };
  }
  if (typeof value === "string") return { type: "String", value, ctx };
  if (value instanceof LuaTable && !value.metatable) {
    return tableExpression(value, open);
  }
  throw new Error(NOT_STORABLE);
}

// List items first, so `{1, 2, x = 3}` reads like it was written
function tableExpression(t: LuaTable, open: Set<LuaTable>): LuaExpression {
  if (open.has(t))
    throw new Error("pageVars.set: a table can't contain itself");
  open.add(t);
  const entry = (key: unknown) =>
    toLiteralExpression(t.rawGet(key), t.getNumericType(key), open);
  const fields: LuaTableField[] = [];
  const n = t.length;
  for (let i = 1; i <= n; i++) {
    fields.push({ type: "ExpressionField", value: entry(i), ctx: {} });
  }
  for (const key of t.keys()) {
    if (
      typeof key === "number" &&
      Number.isInteger(key) &&
      key >= 1 &&
      key <= n
    ) {
      continue;
    }
    const value = entry(key);
    fields.push(
      typeof key === "string"
        ? { type: "PropField", key, value, ctx: {} }
        : {
            type: "DynamicField",
            key: toLiteralExpression(key, t.getNumericType(key), open),
            value,
            ctx: {},
          },
    );
  }
  open.delete(t);
  return { type: "TableConstructor", fields, ctx: {} };
}

function isLiteral(expr: LuaExpression): boolean {
  switch (expr.type) {
    case "Nil":
    case "Boolean":
    case "Number":
    case "String":
      return true;
    case "Unary":
      return expr.operator === "-" && expr.argument.type === "Number";
    case "TableConstructor":
      return expr.fields.every(
        (f) =>
          isLiteral(f.value) &&
          (f.type !== "DynamicField" ||
            (f.key.type !== "TableConstructor" && isLiteral(f.key))),
      );
    default:
      return false;
  }
}

/**
 * The edit that sets `name`'s `${name = …}` cell in `text` to `value`, or
 * null when it already holds that value. Only literal cells can be set:
 * a formula, a missing cell or a duplicated one is an error.
 */
export function planPageVarEdit(
  text: string,
  page: string,
  name: string,
  value: unknown,
): TextEdit | null {
  const insert = toLuaLiteral(value);
  const { cells } = extractDefinitions(text);
  const matching = cells.filter((c) => c.name === name);
  if (matching.length === 0) {
    throw new Error(`pageVars.set: ${page} has no \${${name} = …}`);
  }
  if (matching.length > 1) {
    throw new Error(
      `pageVars.set: ${name} is defined more than once on ${page}`,
    );
  }
  const cell = matching[0];
  let current: string | null = null;
  try {
    const expr = parseExpressionString(cell.exprSource);
    if (isLiteral(expr)) current = prettyPrintExpression(expr);
  } catch {
    // A cell that doesn't parse holds no value to replace
  }
  if (current === null) {
    throw new Error(`pageVars.set: ${name} is a formula, not a value`);
  }
  if (current === insert) return null;
  // Keep the cell's own spacing around the value
  const lead = cell.exprSource.length - cell.exprSource.trimStart().length;
  const trail = cell.exprSource.length - cell.exprSource.trimEnd().length;
  const lineStart = text.lastIndexOf("\n", cell.exprFrom - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  return {
    from: cell.exprFrom + lead,
    to: cell.exprTo - trail,
    insert: insert.replaceAll("\n", `\n${indent}`),
  };
}
