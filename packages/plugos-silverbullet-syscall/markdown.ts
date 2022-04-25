import { syscall } from "./syscall";

import type { ParseTree } from "../common/tree";

export async function parseMarkdown(text: string): Promise<ParseTree> {
  return syscall("markdown.parseMarkdown", text);
}
