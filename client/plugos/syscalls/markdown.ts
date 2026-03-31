import type { SysCallMapping } from "../system.ts";
import { parse } from "../../markdown_parser/parse_tree.ts";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  expandMarkdown,
  type MarkdownExpandOptions,
} from "../../markdown_renderer/inline.ts";
import type { Client } from "../../client.ts";
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
      return parse(markdownLanguageWithUserExtensions(client), text);
    },
    "markdown.renderParseTree": (_ctx, tree: ParseTree): string => {
      return renderToText(tree);
    },
    "markdown.expandMarkdown": async (
      _ctx,
      treeOrText: ParseTree | string,
      options?: MarkdownExpandOptions,
    ): Promise<ParseTree | string> => {
      const outputString = typeof treeOrText === "string";
      if (typeof treeOrText === "string") {
        treeOrText = parse(
          markdownLanguageWithUserExtensions(client),
          treeOrText,
        );
      }
      const result = await expandMarkdownWithClient(
        client,
        treeOrText,
        options,
      );
      if (outputString) {
        return renderToText(result);
      } else {
        return result;
      }
    },
    "markdown.markdownToHtml": async (
      _ctx,
      text: string,
      options: MarkdownRenderOptions = {},
    ) => {
      let mdTree = parse(markdownLanguageWithUserExtensions(client), text);
      if (options.expand) {
        mdTree = await expandMarkdownWithClient(client, mdTree);
      }
      return renderMarkdownToHtml(mdTree, options);
    },
    "markdown.objectsToTable": (
      _ctx,
      data: any[],
      options: {
        renderCell?: (val: any, key: string) => Promise<any> | any;
      } = {},
    ) => {
      return jsonToMDTable(data, options.renderCell || refCellTransformer);
    },
  };
}

function markdownLanguageWithUserExtensions(client: Client) {
  return buildExtendedMarkdownLanguage(
    client.config.get("syntaxExtensions", {}),
  );
}

function expandMarkdownWithClient(
  client: Client,
  tree: ParseTree,
  options?: MarkdownExpandOptions,
) {
  return expandMarkdown(
    client.space,
    client.currentName(),
    tree,
    client.clientSystem.spaceLuaEnv,
    {
      ...options,
      syntaxExtensions: client.config.get("syntaxExtensions", {}),
    },
  );
}
