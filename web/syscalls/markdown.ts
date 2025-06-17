import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { type ParseTree, renderToText } from "../../plug-api/lib/tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { expandMarkdown } from "../markdown.ts";
import type { Client } from "../client.ts";
import { LuaStackFrame } from "../../lib/space_lua/runtime.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "../markdown/markdown_render.ts";

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
    "markdown.markdownToHtml": (
      _ctx,
      text: string,
      options: MarkdownRenderOptions = {},
    ) => {
      const mdTree = parse(extendedMarkdownLanguage, text);
      return renderMarkdownToHtml(mdTree, options);
    },
  };
}
