// Typed narrowers for AST nodes to avoid `(node as any)` in consumers.

import type { ASTCtx, LuaExpression, LuaLValue, LuaStatement } from "./ast.ts";

// Extract by `type` discriminant
type NarrowByType<U, K extends U extends { type: infer T } ? T : never> =
  Extract<U, { type: K }>;

// Expressions
export const asStringExpr = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "String">;
export const asNumberExpr = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Number">;
export const asBooleanExpr = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Boolean">;
export const asNilExpr = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Nil">;
export const asUnary = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Unary">;
export const asBinary = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Binary">;
export const asVariable = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Variable">;
export const asFunctionCall = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "FunctionCall">;
export const asTableAccess = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "TableAccess">;
export const asPropertyAccess = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "PropertyAccess">;
export const asParenthesized = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Parenthesized">;
export const asTableConstructor = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "TableConstructor">;
export const asFunctionDef = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "FunctionDefinition">;
export const asQueryExpr = (e: LuaExpression) =>
  e as NarrowByType<LuaExpression, "Query">;

// L-values
export const asLValueVariable = (l: LuaLValue) =>
  l as Extract<LuaLValue, { type: "Variable" }>;
export const asLValueTableAccess = (l: LuaLValue) =>
  l as Extract<LuaLValue, { type: "TableAccess" }>;
export const asLValuePropertyAccess = (l: LuaLValue) =>
  l as Extract<LuaLValue, { type: "PropertyAccess" }>;

// Statements
export const asAssignment = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Assignment">;
export const asLocal = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Local">;
export const asBlock = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Block">;
export const asIf = (s: LuaStatement) => s as NarrowByType<LuaStatement, "If">;
export const asWhile = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "While">;
export const asRepeat = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Repeat">;
export const asBreak = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Break">;
export const asFunctionStmt = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Function">;
export const asLocalFunction = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "LocalFunction">;
export const asFunctionCallStmt = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "FunctionCallStatement">;
export const asReturn = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Return">;
export const asFor = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "For">;
export const asForIn = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "ForIn">;
export const asLabel = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Label">;
export const asGoto = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Goto">;
export const asSemicolon = (s: LuaStatement) =>
  s as NarrowByType<LuaStatement, "Semicolon">;

// Pull ctx with a single shape
export const ctxOf = (node: { ctx: ASTCtx }): ASTCtx => node.ctx;
