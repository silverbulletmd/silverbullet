import { SysCallMapping } from "../../plugos/system.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { Language } from "../../web/deps.ts";
import type { ParseTree } from "$sb/lib/tree.ts";

export function markdownSyscalls(lang: Language): SysCallMapping {
  return {
    "markdown.parseMarkdown": (_ctx, text: string): ParseTree => {
      return parse(lang, text);
    },
  };
}
