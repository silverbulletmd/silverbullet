import {
  getPathExtension,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  nameFromTransclusion,
  parseTransclusion,
  type Transclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import mime from "mime";
import type { CustomSyntaxSpec } from "../markdown_parser/custom_syntax.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { createMediaElement as createNativeMediaElement } from "../media.ts";
import type { Space } from "../space.ts";
import { LUA_TIMEOUT_MESSAGE, LuaBudgetStopped } from "../space_lua/budget.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";
import { fsEndpoint } from "../spaces/constants.ts";
import { htmlEscape } from "./html_render.ts";

// Synthetic node type used to represent pre-resolved custom syntax HTML in the parse tree
export const CustomSyntaxRenderedHtmlType = "CustomSyntaxRenderedHtml";

export type CustomSyntaxHtmlRenderer = CustomSyntaxSpec & {
  renderHtml?: (
    body: string,
    pageName: string,
  ) => string | HTMLElement | Promise<string | HTMLElement>;
};

// A node whose children were re-parsed for display; `source` keeps its text.
export type SourcedNode = ParseTree & { source?: string };

/**
 * Where a task gets a `[[Page@pos]]` reference so it can be updated. A ref
 * needs a real source offset, so only text that is a page's source gets one:
 * - "page": the text is `pageName`'s source, and so is any page it transcludes
 * - "transcluded": the text is generated (by Lua); only transcluded pages are
 * - "none": no references at all
 */
export type TaskRefs = "page" | "transcluded" | "none";

export type MarkdownExpandOptions = {
  // Replace markdown transclusions with their content (default true)
  expandTransclusions?: boolean;
  // Which tasks without a reference get a `[[Page@pos]]` one
  taskRefs: TaskRefs;
  // Offset of the expanded text in `pageName`'s source (for task references)
  sourceOffset?: number;
  // Custom syntax extensions keyed by name, with optional renderHtml callbacks
  syntaxExtensions?: Record<string, CustomSyntaxHtmlRenderer>;
  // Resolve a wiki-link transclusion's target the way wiki links resolve
  // (see buildResolveTransclusion); fromPage is the page being expanded
  resolveTransclusion?: (t: Transclusion, fromPage: string) => void;
  // Replaces each Lua directive with the returned node (the slot renderer
  // evaluates and renders values itself); without it directives stay as is
  luaDirectiveHandler?: (
    exprText: string,
    sourcePage: string,
    inTableCell: boolean,
  ) => ParseTree;
};

/**
 * Expands custom markdown Lua directives and transclusions into plain markdown
 * @param mdTree parsed markdown tree
 * @returns modified mdTree
 */
export async function expandMarkdown(
  space: Space,
  pageName: string,
  mdTree: ParseTree,
  sle: SpaceLuaEnvironment,
  options: MarkdownExpandOptions,
  processedPages: Set<string> = new Set(),
): Promise<ParseTree> {
  const taskRefs = options.taskRefs;
  const mdLang = buildExtendedMarkdownLanguage(options.syntaxExtensions);
  addParentPointers(mdTree);
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (
      options.luaDirectiveHandler &&
      (n.type === "WikiLinkAlias" || n.type === "AttributeValue")
    ) {
      const source = renderToText(n);
      if (!source.includes("${")) return undefined;
      // Display-only: re-parse the text inline so its directives become slots
      const para = parse(mdLang, source).children?.find(
        (c) => c.type === "Paragraph",
      );
      if (para?.children) {
        (n as SourcedNode).source = source;
        n.children = para.children;
        addParentPointers(n);
      }
      return undefined;
    }
    if (n.type === "Image" && options.expandTransclusions !== false) {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const text = renderToText(n);

      const transclusion = parseTransclusion(text);
      if (!transclusion) {
        return n;
      }
      options.resolveTransclusion?.(transclusion, pageName);
      if (processedPages.has(transclusion.url)) {
        return n;
      }

      // Resolve local URLs (only for markdown links; wikilink targets were
      // resolved space-wide above)
      if (
        isLocalURL(transclusion.url) &&
        transclusion.linktype !== "wikilink"
      ) {
        transclusion.url = resolveMarkdownLink(
          pageName,
          decodeURI(transclusion.url),
        );
      }

      const mimeType = getMimeTypeFromUrl(
        transclusion.url,
        transclusion.linktype !== "wikilink",
      );
      if (mimeType && mimeType !== "text/markdown") {
        return n;
      }

      try {
        const result = await readTransclusionContent(space, transclusion);

        // We know it's a markdown page and we know we are transcluding it. "Mark"
        // it so we won't touch it down the line and cause endless recursion
        processedPages.add(transclusion.url);

        const tree = parse(mdLang, result.text);

        if (result.offset === 0 && tree.children) {
          tree.children = tree.children.filter((c) => c.type !== "FrontMatter");
        }

        return expandMarkdown(
          space,
          nameFromTransclusion(transclusion),
          tree,
          sle,
          {
            ...options,
            taskRefs: taskRefs === "none" ? "none" : "page",
            sourceOffset: result.offset,
          },
          processedPages,
        );
      } catch (e: any) {
        if (e instanceof LuaBudgetStopped) {
          return parse(mdLang, LUA_TIMEOUT_MESSAGE);
        }
        return parse(mdLang, `**Error:** ${e.message}`);
      }
    } else if (n.type === "LuaDirective" && options.luaDirectiveHandler) {
      const expr = findNodeOfType(n, "LuaExpressionDirective");
      if (!expr) {
        return;
      }
      return options.luaDirectiveHandler(
        renderToText(expr),
        pageName,
        !!findParentMatching(n, (p) => p.type === "TableCell"),
      );
    } else if (n.type === "Task" && taskRefs === "page") {
      const existingLink = findNodeOfType(n, "WikiLink");
      if (!existingLink) {
        n.children!.splice(
          1,
          0,
          {
            text: " ",
          },
          {
            type: "WikiLink",
            children: [
              {
                type: "WikiLinkMark",
                children: [{ text: "[[" }],
              },
              {
                type: "WikiLinkPage",
                children: [
                  {
                    text: `${pageName}@${(options.sourceOffset ?? 0) + n.parent!.from!}`,
                  },
                ],
              },
              {
                type: "WikiLinkMark",
                children: [{ text: "]]" }],
              },
            ],
          },
        );
      }
    } else if (n.type && options.syntaxExtensions) {
      const spec = options.syntaxExtensions[n.type];
      if (!spec?.renderHtml) return;

      const bodyNode = findNodeOfType(n, `${spec.name}Body`);
      const bodyText = bodyNode ? renderToText(bodyNode) : "";

      try {
        let result = await spec.renderHtml(bodyText, pageName);
        if (typeof result !== "string" && "outerHTML" in result) {
          result = result.outerHTML;
        }
        return {
          type: CustomSyntaxRenderedHtmlType,
          children: [{ text: result }],
        };
      } catch (e: any) {
        console.error(`Error in ${spec.name} renderHtml:`, e);
        return {
          type: CustomSyntaxRenderedHtmlType,
          children: [
            {
              text: `<span class="error">Error in ${htmlEscape(spec.name)} renderHtml: ${htmlEscape(e.message)}</span>`,
            },
          ],
        };
      }
    }
  });
  return mdTree;
}

export type OffsetText = {
  text: string;
  offset: number;
};

/**
 * Determine the MIME type for a transclusion URL.
 */
export function getMimeTypeFromUrl(
  url: string,
  allowExternal: boolean,
): string | null {
  if (!isLocalURL(url) && allowExternal) {
    const extension = URL.parse(url)?.pathname.split(".").pop();
    if (extension) {
      return mime.getType(extension);
    }
    return null;
  }

  const ref = parseToRef(url);
  if (!ref) {
    throw Error(`Failed to parse url: ${url}`);
  }

  return mime.getType(getPathExtension(ref.path));
}

/**
 * Sanitize a transclusion URL for use in HTML elements.
 * Local URLs get prefixed with the fs endpoint.
 */
function sanitizeTransclusionUrl(url: string, allowExternal: boolean): string {
  return !allowExternal || isLocalURL(url)
    ? `${fsEndpoint.slice(1)}/${url.replace(":", "%3A")}`
    : url;
}

/**
 * Create an HTML element for media transclusions (image/video/audio/pdf).
 * Returns null for markdown content or unknown MIME types.
 */
export function createMediaElement(
  transclusion: Transclusion,
): HTMLElement | null {
  const allowExternal = transclusion.linktype !== "wikilink";
  const mimeType = getMimeTypeFromUrl(transclusion.url, allowExternal);

  if (!mimeType) {
    return null;
  }

  return createNativeMediaElement({
    url: sanitizeTransclusionUrl(transclusion.url, allowExternal),
    contentType: mimeType,
    title: transclusion.alias,
    dimensions: transclusion.dimension,
  });
}

/**
 * Read markdown transclusion content from space.
 * Throws for non-markdown MIME types or invalid paths.
 */
export async function readTransclusionContent(
  space: Space,
  transclusion: Transclusion,
): Promise<OffsetText> {
  const allowExternal = transclusion.linktype !== "wikilink";
  const mimeType = getMimeTypeFromUrl(transclusion.url, allowExternal);

  if (!mimeType) {
    throw Error(`Failed to determine mime type for ${transclusion.url}`);
  }

  if (mimeType !== "text/markdown") {
    throw Error(`File has unsupported mimeType: ${mimeType}`);
  }

  if (!isLocalURL(transclusion.url) && allowExternal) {
    throw Error(`Transcluding markdown from external sources is not allowed`);
  }

  const ref = parseToRef(transclusion.url);
  // Anchor refs (e.g. $name or Page$name) have an empty or page-only path;
  // allow them through since readRef handles them via the anchorResolver.
  if (!ref || (ref.details?.type !== "anchor" && !isMarkdownPath(ref.path))) {
    throw Error(
      `Couldn't transclude markdown, invalid path: ${transclusion.url}`,
    );
  }

  return space.readRef(ref);
}
