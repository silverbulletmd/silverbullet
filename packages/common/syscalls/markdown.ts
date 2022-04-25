import { SysCallMapping } from "@plugos/plugos/system";
import { parse } from "../parse_tree";
import { Language } from "@codemirror/language";
import type { ParseTree } from "../tree";

export function markdownSyscalls(lang: Language): SysCallMapping {
  return {
    "markdown.parseMarkdown": (ctx, text: string): ParseTree => {
      return parse(lang, text);
    },
  };
}
