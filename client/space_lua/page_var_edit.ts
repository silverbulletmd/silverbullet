import type { LuaExpression } from "./ast.ts";
import { isTaggedFloat } from "./numeric.ts";
import { extractDefinitions } from "./page_definitions.ts";
import { parseExpressionString } from "./parse.ts";
import { luaFormatNumber } from "./runtime.ts";

export type TextEdit = { from: number; to: number; insert: string };

const NOT_STORABLE =
  "pageVars.set: only numbers, strings, booleans and nil can be stored";

/** `value` written as Lua source; throws for anything a cell can't hold. */
export function toLuaLiteral(value: unknown): string {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "boolean") return String(value);
  if (isTaggedFloat(value)) {
    if (!Number.isFinite(value.value)) throw new Error(NOT_STORABLE);
    return luaFormatNumber(value.value, "float");
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(NOT_STORABLE);
    return luaFormatNumber(value);
  }
  if (typeof value === "string") return luaStringLiteral(value);
  throw new Error(NOT_STORABLE);
}

function luaStringLiteral(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      out += `\\${String(code).padStart(3, "0")}`;
    } else out += ch;
  }
  return `${out}"`;
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
    default:
      return false;
  }
}

/**
 * The edit that sets `name`'s `${name = …}` cell in `text` to `value`, or
 * null when it already holds that literal. Only literal cells can be set:
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
  let literal = false;
  try {
    literal = isLiteral(parseExpressionString(cell.exprSource));
  } catch {
    // A cell that doesn't parse holds no value to replace
  }
  if (!literal) {
    throw new Error(`pageVars.set: ${name} is a formula, not a value`);
  }
  const current = cell.exprSource.trim();
  if (current === insert) return null;
  // Keep the cell's own spacing around the value
  const lead = cell.exprSource.length - cell.exprSource.trimStart().length;
  const trail = cell.exprSource.length - cell.exprSource.trimEnd().length;
  return { from: cell.exprFrom + lead, to: cell.exprTo - trail, insert };
}
