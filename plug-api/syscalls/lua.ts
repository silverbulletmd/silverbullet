import { syscall } from "../syscall.ts";
import type { ParseTree } from "../lib/tree.ts";

export function parse(
  code: string,
): Promise<ParseTree> {
  return syscall("lua.parse", code);
}
