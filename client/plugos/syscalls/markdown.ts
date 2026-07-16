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
import { bakeSectionsInText } from "../../baked_sections/bake.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "../../markdown_renderer/markdown_render.ts";
import {
  jsonToMDTable,
  refCellTransformer,
} from "../../markdown_renderer/result_render.ts";
import * as TagConstants from "../../../plugs/index/constants.ts";

export function markdownSyscalls(client: Client): SysCallMapping {
  return {
    "markdown.parseMarkdown": {
      callback: (_ctx, text: string): ParseTree => {
        return parse(markdownLanguageWithUserExtensions(client), text);
      },
      description: "Parses Markdown text into a syntax tree.",
      parameters: [
        { name: "text", type: "string", description: "Markdown source." },
      ],
      returns: [{ type: "table", description: "Parsed Markdown tree." }],
      examples: [{ code: 'local tree = markdown.parseMarkdown("# Title")' }],
    },
    "markdown.renderParseTree": {
      callback: (_ctx, tree: ParseTree): string => {
        return renderToText(tree);
      },
      description: "Renders a Markdown syntax tree back to source text.",
      parameters: [
        { name: "tree", type: "table", description: "Markdown syntax tree." },
      ],
      returns: [{ type: "string", description: "Rendered Markdown." }],
      examples: [
        {
          code: 'local tree = markdown.parseMarkdown("# Title")\nprint(markdown.renderParseTree(tree))',
        },
      ],
    },
    "markdown.expandMarkdown": {
      callback: async (
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
      description:
        "Expands Markdown transclusions, Lua directives, and task references.",
      signatures: [
        "markdown.expandMarkdown(text, options?)",
        "markdown.expandMarkdown(tree, options?)",
      ],
      parameters: [
        { name: "textOrTree", description: "Markdown text or parsed tree." },
        {
          name: "options",
          type: "table",
          description:
            "Expansion switches: expandTransclusions, expandLuaDirectives, and rewriteTasks; all default to true.",
          optional: true,
        },
      ],
      returns: [
        { description: "Expanded text or tree, matching the input form." },
      ],
      examples: [
        {
          code: 'local expanded = markdown.expandMarkdown("This is some Lua: ${1 + 2}")',
        },
      ],
    },
    "markdown.markdownToHtml": {
      callback: async (
        _ctx,
        text: string,
        options: MarkdownRenderOptions = {},
      ) => {
        let mdTree = parse(markdownLanguageWithUserExtensions(client), text);
        if (options.expand) {
          mdTree = await expandMarkdownWithClient(client, mdTree);
        }
        if (!options.resolveTagHref) {
          options.resolveTagHref = (tagName: string) => {
            return (
              client.config.get<string | null>(
                ["tags", tagName, "tagPage"],
                null,
              ) ?? TagConstants.tagPrefix + tagName
            );
          };
        }
        return renderMarkdownToHtml(mdTree, options);
      },
      description: "Renders Markdown text to HTML.",
      parameters: [
        { name: "text", type: "string", description: "Markdown source." },
        {
          name: "options",
          type: "table",
          description: "HTML rendering options.",
          optional: true,
        },
      ],
      returns: [{ type: "string", description: "Rendered HTML." }],
      examples: [{ code: 'local html = markdown.markdownToHtml("# Title")' }],
    },
    // Re-bake every baked section (`<!--#lua EXPR -->` … `<!--/lua-->`) in
    // `text` and return the updated markdown. Pure transform (no editor) — the
    // text-level counterpart of the "Baked Sections: Update" command. `pageName`
    // sets the `currentPage` context for the evaluated expressions.
    "markdown.bakeSections": {
      callback: (_ctx, text: string, pageName?: string): Promise<string> => {
        return bakeSectionsInText(client, text, pageName);
      },
      description:
        "Re-evaluates all baked Lua sections in Markdown text; sections that error or only render as HTML are left unchanged.",
      parameters: [
        {
          name: "text",
          type: "string",
          description: "Markdown containing baked sections.",
        },
        {
          name: "pageName",
          type: "string",
          description: "Page used as currentPage during evaluation.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "string",
          description: "Markdown with updated baked section bodies.",
        },
      ],
      examples: [
        {
          code: 'local text = "Total: <!--#lua 1 + 2 -->\\nold\\n<!--/lua-->"\nprint(markdown.bakeSections(text))',
        },
      ],
    },
    "markdown.objectsToTable": {
      callback: (
        _ctx,
        data: any[],
        options: {
          renderCell?: (val: any, key: string) => Promise<any> | any;
        } = {},
      ) => {
        return jsonToMDTable(data, options.renderCell || refCellTransformer);
      },
      description: "Formats a list of objects as a Markdown table.",
      parameters: [
        { name: "data", type: "table", description: "Rows to render." },
        {
          name: "options",
          type: "table",
          description: "Optional renderCell callback.",
          optional: true,
        },
      ],
      returns: [{ type: "string", description: "Markdown table." }],
      examples: [
        {
          code: 'local tableText = markdown.objectsToTable({{name = "Pete", age = 20}})',
        },
      ],
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
