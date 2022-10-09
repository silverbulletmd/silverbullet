import { syscall } from "./syscall.ts";

import type { ParseTree } from "../../common/tree.ts";

export function parseMarkdown(text: string): Promise<ParseTree> {
  return syscall("markdown.parseMarkdown", text);
}
