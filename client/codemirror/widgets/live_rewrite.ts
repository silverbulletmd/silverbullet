import type { LuaExpression } from "../../space_lua/ast.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";

// parseExpressionString wraps the source as `_(<expr>)`, so AST offsets are shifted by 2
const WRAP = 2;

export function makeLiveSource(expr: string): string {
  const body = expr.trim();
  // A trailing line comment would swallow the closing paren
  return body.includes("--")
    ? `widget.live(${body}\n)`
    : `widget.live(${body})`;
}

/** The first argument of a top-level `widget.live(…)` call, or undefined when `expr` isn't one. */
export function makeStaticSource(expr: string): string | undefined {
  let ast: LuaExpression;
  try {
    ast = parseExpressionString(expr);
  } catch {
    return undefined;
  }
  if (ast.type !== "FunctionCall" || ast.name || ast.args.length < 1) {
    return undefined;
  }
  const p = ast.prefix;
  if (
    p.type !== "PropertyAccess" ||
    p.property !== "live" ||
    p.object.type !== "Variable" ||
    p.object.name !== "widget"
  ) {
    return undefined;
  }
  const { from, to } = ast.args[0].ctx;
  if (from === undefined || to === undefined) return undefined;
  // A lone argument runs to the closing paren, keeping any trailing comment
  const end =
    ast.args.length === 1 && ast.ctx.to !== undefined ? ast.ctx.to - 1 : to;
  const body = expr.slice(from - WRAP, end - WRAP).trim();
  return body.includes("--") ? `${body}\n` : body;
}
