import { syscall } from "./syscall.ts";

import type { ParseTree } from "../common/tree.ts";

export async function parseMarkdown(text: string): Promise<ParseTree> {
  return syscall("markdown.parseMarkdown", text);
}
