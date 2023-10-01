import { syscall } from "$sb/silverbullet-syscall/syscall.ts";

import type { ParseTree } from "$sb/lib/tree.ts";

export function parseLanguage(
  language: string,
  code: string,
): Promise<ParseTree> {
  return syscall("language.parseLanguage", language, code);
}
