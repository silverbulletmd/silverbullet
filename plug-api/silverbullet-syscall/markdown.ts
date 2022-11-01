import { syscall } from "$sb/silverbullet-syscall/syscall.ts";

import type { ParseTree } from "$sb/lib/tree.ts";

export function parseMarkdown(text: string): Promise<ParseTree> {
  return syscall("markdown.parseMarkdown", text);
}
