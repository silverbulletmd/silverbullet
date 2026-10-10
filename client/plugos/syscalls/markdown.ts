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
  type TaskRefs,
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
import {
  applyChrome,
  expandMarkdownStatic,
  portableMarkdown,
  renderMarkdownStatic,
  renderValue,
} from "../../markdown_renderer/compose.ts";
import { isWidgetValue } from "../../space_lua/fragment.ts";
import {
  liveContextForClient,
  staticContextForClient,
} from "../../markdown_renderer/compose_client.ts";

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
        options: SyscallExpandOptions = {},
      ): Promise<ParseTree | string> => {
        const outputString = typeof treeOrText === "string";
        if (typeof treeOrText === "string") {
          treeOrText = parse(
            markdownLanguageWithUserExtensions(client),
            treeOrText,
          );
        }
        const { rewriteTasks, expandLuaDirectives, ...switches } = options;
        // The caller's text is the open page's source
        const taskRefs: TaskRefs = rewriteTasks === false ? "none" : "page";
        const result =
          expandLuaDirectives === false
            ? await expandMarkdownWithClient(client, treeOrText, {
                ...switches,
                taskRefs,
              })
            : await expandMarkdownStatic(
                treeOrText,
                staticContextForClient(client, {}, taskRefs),
                switches,
              );
        if (outputString) {
          return renderToText(result);
        } else {
          return result;
        }
      },
      description:
        "Expands Markdown transclusions, Lua directives, and task references. Directive results are written as Markdown, or as HTML for widgets without Markdown (event handlers are dropped).",
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
    "lua:widget.toMarkdown": {
      callback: async (ctx, w: unknown): Promise<string> => {
        if (typeof w !== "string" && !isWidgetValue(w)) return "";
        const render = liveContextForClient(client);
        // Called while rendering: nest inside that render, so a widget that
        // converts itself stops at the depth limit and shares the Lua budget
        const thread = ctx.sf?.threadState;
        const result = await portableMarkdown(
          w,
          thread?.renderDepth === undefined
            ? render
            : {
                ...render,
                depth: thread.renderDepth + 1,
                budget: thread.budget ?? render.budget,
              },
        );
        return result.ok ? result.markdown : "";
      },
      description:
        'Returns a widget\'s Markdown: the text Copy as Markdown and Bake into page use. HTML-only widgets give "".',
      parameters: [
        { name: "w", type: "any", description: "A widget or string." },
      ],
      returns: [{ type: "string" }],
    },
    "markdown.renderToDom": {
      callback: async (_ctx, value: unknown): Promise<HTMLElement> => {
        const rendered = await renderValue(value, liveContextForClient(client));
        applyChrome(rendered.node, rendered.chrome);
        return rendered.node;
      },
      description:
        "Renders a Markdown string or a widget to a live DOM node (Space Lua only).",
      parameters: [
        {
          name: "value",
          type: "any",
          description: "Markdown string or widget.",
        },
      ],
      returns: [{ type: "any", description: "DOM node." }],
    },
    "markdown.markdownToHtml": {
      callback: async (
        _ctx,
        text: string,
        options: MarkdownRenderOptions = {},
      ) => {
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
        if (options.expand) {
          const ctx = staticContextForClient(client, options, "page");
          return renderMarkdownStatic(text, ctx);
        }
        return renderMarkdownToHtml(
          parse(markdownLanguageWithUserExtensions(client), text),
          options,
        );
      },
      description: "Renders Markdown text to HTML.",
      parameters: [
        { name: "text", type: "string", description: "Markdown source." },
        {
          name: "options",
          type: "table",
          description:
            "HTML rendering options; `expand = true` first expands transclusions and Lua directives, as `markdown.expandMarkdown` does.",
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

// The documented syscall options; `rewriteTasks` maps to `TaskRefs`
type SyscallExpandOptions = {
  expandTransclusions?: boolean;
  expandLuaDirectives?: boolean;
  rewriteTasks?: boolean;
};

function expandMarkdownWithClient(
  client: Client,
  tree: ParseTree,
  options: MarkdownExpandOptions,
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
