import type { SysCallMapping } from "../system.ts";
import { parse } from "../../markdown_parser/parse_tree.ts";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { expandMarkdown } from "../../markdown_renderer/inline.ts";
import type { Client } from "../../client.ts";
import { LuaEnv, LuaStackFrame } from "../../space_lua/runtime.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "../../markdown_renderer/markdown_render.ts";
import {
  jsonToMDTable,
  refCellTransformer,
} from "../../markdown_renderer/result_render.ts";

export function markdownSyscalls(client: Client): SysCallMapping {
  return {
    "markdown.parseMarkdown": (_ctx, text: string): ParseTree => {
      return parse(extendedMarkdownLanguage, text);
    },
    "markdown.renderParseTree": (_ctx, tree: ParseTree): string => {
      return renderToText(tree);
    },
    "markdown.expandMarkdown": (_ctx, tree: ParseTree): Promise<ParseTree> => {
      const globalEnv = client.clientSystem.spaceLuaEnv.env;
      const tl = new LuaEnv();
      tl.setLocal("_GLOBAL", globalEnv);
      const sf = new LuaStackFrame(tl, null);
      return expandMarkdown(
        client,
        tree,
        globalEnv,
        sf,
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
    "markdown.objectsToTable": (
      _ctx,
      data: any[],
      options: { renderCell?: (val: any, key) => Promise<any> | any } = {},
    ) => {
      return jsonToMDTable(data, options.renderCell || refCellTransformer);
    },
  };
}
