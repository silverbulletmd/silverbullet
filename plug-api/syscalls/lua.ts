import { syscall } from "../syscall.ts";
import type { LuaBlock, LuaExpression } from "$common/space_lua/ast.ts";

export function parse(
  code: string,
): Promise<LuaBlock> {
  return syscall("lua.parse", code);
}

export function parseExpression(
  expression: string,
): Promise<LuaExpression> {
  return syscall("lua.parseExpression", expression);
}

export function evalExpression(
  expression: string,
): Promise<any> {
  return syscall("lua.evalExpression", expression);
}
