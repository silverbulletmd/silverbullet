import { syscall } from "../syscall.ts";
import type { LuaBlock, LuaExpression } from "../../client/space_lua/ast.ts";
import type { PrintOptions } from "../../client/space_lua/pretty_print.ts";
import type { LuaValueInspection } from "../types/index.ts";

export function parseBlock(code: string): Promise<LuaBlock> {
  return syscall("lua.parseBlock", code);
}

/** @deprecated use {@link parseBlock} instead */
export function parse(code: string): Promise<LuaBlock> {
  return syscall("lua.parseBlock", code);
}

export function parseExpression(expression: string): Promise<LuaExpression> {
  return syscall("lua.parseExpression", expression);
}

export function evalExpression(expression: string): Promise<any> {
  return syscall("lua.evalExpression", expression);
}

export function prettyPrintBlock(
  block: LuaBlock,
  opts?: PrintOptions,
): Promise<string> {
  return syscall("lua.prettyPrintBlock", block, opts);
}

export function prettyPrintExpression(
  expression: LuaExpression,
  opts?: PrintOptions,
): Promise<string> {
  return syscall("lua.prettyPrintExpression", expression, opts);
}

export function inspect(
  path: string[] = [],
): Promise<LuaValueInspection | null> {
  return syscall("lua.inspect", path);
}
