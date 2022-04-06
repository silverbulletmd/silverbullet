import { SysCallMapping } from "../../plugos/system";
import { MarkdownTree, parse } from "../tree";

export function markdownSyscalls(): SysCallMapping {
  return {
    "markdown.parseMarkdown": (ctx, text: string): MarkdownTree => {
      return parse(text);
    },
  };
}
