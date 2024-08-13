import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { type ParseTree, renderToText } from "../../plug-api/lib/tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";

export function markdownSyscalls(): SysCallMapping {
  return {
    "markdown.parseMarkdown": (_ctx, text: string): ParseTree => {
      return parse(extendedMarkdownLanguage, text);
    },
    "markdown.renderParseTree": (_ctx, tree: ParseTree): string => {
      return renderToText(tree);
    },
  };
}
