import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { type ParseTree, renderToText } from "../../plug-api/lib/tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { expandMarkdown } from "$common/markdown.ts";
import type { Client } from "../../web/client.ts";
import { LuaStackFrame } from "$common/space_lua/runtime.ts";

export function markdownSyscalls(client: Client): SysCallMapping {
  return {
    "markdown.parseMarkdown": (_ctx, text: string): ParseTree => {
      return parse(extendedMarkdownLanguage, text);
    },
    "markdown.renderParseTree": (_ctx, tree: ParseTree): string => {
      return renderToText(tree);
    },
    "markdown.expandMarkdown": (_ctx, tree: ParseTree): Promise<ParseTree> => {
      return expandMarkdown(
        client,
        tree,
        client.clientSystem.spaceLuaEnv.env,
        LuaStackFrame.lostFrame,
      );
    },
  };
}
