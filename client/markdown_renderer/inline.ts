import {
  addParentPointers,
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { htmlEscape } from "./html_render.ts";
import {
  getPathExtension,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import mime from "mime";
import { LuaStackFrame, LuaTable } from "../space_lua/runtime.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import type { CustomSyntaxSpec } from "../markdown_parser/custom_syntax.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { renderExpressionResult } from "./result_render.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { evalExpression } from "../space_lua/eval.ts";
import type { LuaExpression } from "../space_lua/ast.ts";

import { fsEndpoint } from "../spaces/constants.ts";
import {
  nameFromTransclusion,
  parseTransclusion,
  type Transclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";
import type { Space } from "../space.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";

// Synthetic node type used to represent pre-resolved custom syntax HTML in the parse tree
export const CustomSyntaxRenderedHtmlType = "CustomSyntaxRenderedHtml";

// Extends the parser spec with an optional renderHtml callback for HTML rendering
export type CustomSyntaxHtmlRenderer = CustomSyntaxSpec & {
  renderHtml?: (
    body: string,
    pageName: string,
  ) => string | HTMLElement | Promise<string | HTMLElement>;
};

export type MarkdownExpandOptions = {
  // all options default to true, set to false to explicitly disable
  // Replace (markdown transclusions) with their content
  expandTransclusions?: boolean;
  // Replace Lua directives with their evaluated values
  expandLuaDirectives?: boolean;
  // Rewrite tasks to include references so that they can be updated
  rewriteTasks?: boolean;
  // Custom syntax extensions keyed by name, with optional renderHtml callbacks
  syntaxExtensions?: Record<string, CustomSyntaxHtmlRenderer>;
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
  options: MarkdownExpandOptions = {},
  processedPages: Set<string> = new Set(),
): Promise<ParseTree> {
  const mdLang = buildExtendedMarkdownLanguage(options.syntaxExtensions);
  addParentPointers(mdTree);
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "Image" && options.expandTransclusions !== false) {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const text = renderToText(n);

      const transclusion = parseTransclusion(text);
      if (!transclusion || processedPages.has(transclusion.url)) {
        return n;
      }

      // Resolve local URLs (only for markdown links, wikilinks are absolute)
      if (isLocalURL(transclusion.url) && transclusion.linktype !== "wikilink") {
        transclusion.url = resolveMarkdownLink(
          pageName,
          decodeURI(transclusion.url),
        );
      }

      // We don't transclude anything that's not markdown
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

        // Recursively process
        return expandMarkdown(
          space,
          nameFromTransclusion(transclusion),
          tree,
          sle,
          options,
          processedPages,
        );
      } catch (e: any) {
        return parse(mdLang, `**Error:** ${e.message}`);
      }
    } else if (
      n.type === "LuaDirective" &&
      options.expandLuaDirectives !== false
    ) {
      const expr = findNodeOfType(
        n,
        "LuaExpressionDirective",
      ) as LuaExpression | null;
      if (!expr) {
        return;
      }
      const exprText = renderToText(expr);

      try {
        const sf = LuaStackFrame.createWithGlobalEnv(sle.env);

        let result = await evalExpression(
          parseExpressionString(exprText),
          sle.env,
          sf,
        );

        if (result?.markdown) {
          result = result.markdown;
        } else if (result instanceof LuaTable && result.has("markdown")) {
          result = result.get("markdown");
        }
        return parse(mdLang, await renderExpressionResult(result));
      } catch (e: any) {
        // Reduce blast radius and give useful error message
        console.error("Error evaluating Lua directive", exprText, e);
        return parse(mdLang, `**Error:** ${e.message}`);
      }
    } else if (n.type === "Task" && options.rewriteTasks !== false) {
      // Add a task reference to this based on the current page name if there's not one already
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
                children: [{ text: `${pageName}@${n.parent!.from!}` }],
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
      // Resolve custom syntax renderHtml callbacks
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
          children: [{ text: `<span class="error">Error in ${htmlEscape(spec.name)} renderHtml: ${htmlEscape(e.message)}</span>` }],
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
    // Remote URL: determine mime type from the URL extension
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
function sanitizeTransclusionUrl(url: string): string {
  return isLocalURL(url)
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

  const style =
    `max-width: 100%;` +
    (transclusion.dimension?.width
      ? `width: ${transclusion.dimension.width}px;`
      : "") +
    (transclusion.dimension?.height
      ? `height: ${transclusion.dimension.height}px;`
      : "");

  const sanitizedUrl = sanitizeTransclusionUrl(transclusion.url);

  if (mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = sanitizedUrl;
    img.alt = transclusion.alias;
    img.style = style;
    return img;
  } else if (mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = sanitizedUrl;
    video.title = transclusion.alias;
    video.controls = true;
    video.autoplay = false;
    video.style = style;
    return video;
  } else if (mimeType.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.src = sanitizedUrl;
    audio.title = transclusion.alias;
    audio.controls = true;
    audio.autoplay = false;
    audio.style = style;
    return audio;
  } else if (mimeType === "application/pdf") {
    const embed = document.createElement("object");
    embed.type = mimeType;
    embed.data = sanitizedUrl;
    embed.style.width = "100%";
    embed.style.height = "20em";
    embed.style = style;
    return embed;
  }

  return null;
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
  if (!ref || !isMarkdownPath(ref.path)) {
    throw Error(
      `Couldn't transclude markdown, invalid path: ${transclusion.url}`,
    );
  }

  return space.readRef(ref);
}
