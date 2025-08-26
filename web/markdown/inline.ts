import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  getNameFromPath,
  getPathExtension,
  isMarkdownPath,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { mime } from "mimetypes";
import type { Client } from "../client.ts";
import type { LuaEnv, LuaStackFrame } from "../../lib/space_lua/runtime.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderExpressionResult } from "./result_render.ts";
import { parseExpressionString } from "../../lib/space_lua/parse.ts";
import { evalExpression } from "../../lib/space_lua/eval.ts";
import type { LuaExpression } from "../../lib/space_lua/ast.ts";
import { mdLinkRegex, wikiLinkRegex } from "../markdown_parser/constants.ts";

/**
 * Describes the dimensions of a transclusion, if provided through the alias.
 * Can be parsed from the alias using {@link parseDimensionFromAlias}
 */
export type ContentDimensions = {
  width?: number;
  height?: number;
};

/**
 * Expands custom markdown Lua directives and transclusions into plain markdown
 * @param mdTree parsed markdown tree
 * @returns modified mdTree
 */
export async function expandMarkdown(
  client: Client,
  mdTree: ParseTree,
  env: LuaEnv,
  sf: LuaStackFrame,
  forbiddenPages: Set<string> = new Set(),
): Promise<ParseTree> {
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "Image") {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const text = renderToText(n);

      const transclusion = parseTransclusion(text);
      if (!transclusion || forbiddenPages.has(transclusion.url)) {
        return n;
      }

      const result = await inlineContentFromURL(
        client,
        transclusion.url,
        transclusion.alias,
        transclusion.dimension,
        transclusion.linktype !== "wikilink",
      );

      // We don't transclude anything that's not markdown
      if (typeof result !== "string") {
        return n;
      }

      // We know it's a markdown page and we know we are transcluding it. "Mark"
      // it so we won't touch it down the line and cause endless recursion
      forbiddenPages.add(transclusion.url);

      const tree = parseMarkdown(result);

      // Recursively process
      return expandMarkdown(
        client,
        tree,
        env,
        sf,
        forbiddenPages,
      );
    } else if (n.type === "LuaDirective") {
      const expr = findNodeOfType(n, "LuaExpressionDirective") as
        | LuaExpression
        | null;
      if (!expr) {
        return;
      }
      const exprText = renderToText(expr);

      try {
        let result = await evalExpression(
          parseExpressionString(exprText),
          env,
          sf,
        );

        if (result?.markdown) {
          result = result.markdown;
        }
        const markdown = await renderExpressionResult(result);
        return parseMarkdown(markdown);
      } catch (e: any) {
        // Reduce blast radius and give useful error message
        console.error("Error evaluating Lua directive", exprText, e);
        return parseMarkdown(`**Error:** ${e.message}`);
      }
    }
  });
  return mdTree;
}

/**
 * Extracts the transclusion from a markdown tree. Right now this is only
 * supported for headers, in which case the Function will extract the header
 * plus all text till the next header
 * @returns Returns null if the header isn't found
 */
export function extractTransclusion(
  markdown: string,
  details: Ref["details"],
): string | null {
  if (!details) {
    return markdown;
  } else if (details.type !== "header") {
    return null;
  }

  const parseTree = parseMarkdown(markdown);

  let from: undefined | number = undefined, to: undefined | number = undefined;
  traverseTree(parseTree, (subTree) => {
    // We are done, but we can't properly cancel the traversal
    if (from !== undefined && to !== undefined) {
      return true;
    }

    if (!subTree.type || !subTree.type.startsWith("ATXHeading")) {
      return false;
    }

    // We already found the first header
    if (from !== undefined) {
      to = subTree.from;
      return true;
    }

    const mark = findNodeOfType(subTree, "HeaderMark");
    if (!mark || mark.from === undefined || mark.to === undefined) {
      return true;
    }

    if (
      renderToText(subTree)
        .slice(mark.to - mark.from)
        .trimStart() === details.header.trim()
    ) {
      from = subTree.from;
    }

    // No need to continue into a header
    return true;
  });

  // Go till end of file if we can't find a second header
  to ??= parseTree.to;

  if (from === undefined) {
    return null;
  }

  return markdown.slice(from, to);
}

/**
 * Function to generate HTML or markdown for a ![[<link>]] type transclusion.
 * @param allowExternal In SB currently, wikilinks don't allow external links
 * and markdown links do
 * @returns a string for a markdown transclusion or html for everything else
 */
export function inlineContentFromURL(
  client: Client,
  url: string,
  alias: string,
  dimension: ContentDimensions | undefined,
  allowExternal: boolean = true,
): string | HTMLElement | Promise<HTMLElement | string> {
  let mimeType: string | null | undefined;
  if (!isLocalURL(url) && allowExternal) {
    // TODO
    // Realistically we should dertermine the mine type by sending a HEAD
    // request, this poses multiple problems
    // 1. This makes `async` a hard requirement here
    // 2. We would need to proxy the request (because of CORS)
    // 3. It won't work "offline" (i.e. away from the SB instance, because it
    //    can't proxy the request anymore)
    // 4. It can be pretty heavy. If your internet connection is bad you will
    //    have to wait for all HEAD request, for your `markdownToHtml` to
    //    complete. This could take a noticeable amount of time.
    // For this reason we will stick to doing it the `dumb` way by just getting
    // it from the URL extension
    const extension = URL.parse(url)?.pathname.split(".").pop();
    if (extension) {
      mimeType = mime.getType(extension);
    }
  } else {
    const ref = parseToRef(url);
    if (!ref) {
      return `Failed to parse url`;
    }

    mimeType = mime.getType(getPathExtension(ref.path));
  }

  if (!mimeType) {
    return `Failed to determine mime type`;
  }

  const style = `max-width: 100%;` +
    (dimension?.width ? `width: ${dimension.width}px;` : "") +
    (dimension?.height ? `height: ${dimension.height}px;` : "");

  // If the URL is a local, encode the : so that it's not interpreted as a protocol
  const sanitizedURL = isLocalURL(url) ? url.replace(":", "%3A") : url;

  let result: HTMLElement | string | Promise<string | HTMLElement>;
  if (mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = sanitizedURL;
    img.alt = alias;
    img.style = style;
    result = img;
  } else if (mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = sanitizedURL;
    video.title = alias;
    video.controls = true;
    video.autoplay = false;
    video.style = style;
    result = video;
  } else if (mimeType.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.src = sanitizedURL;
    audio.title = alias;
    audio.controls = true;
    audio.autoplay = false;
    audio.style = style;
    result = audio;
  } else if (mimeType === "application/pdf") {
    const embed = document.createElement("object");
    embed.type = mimeType;
    embed.data = sanitizedURL;
    embed.style.width = "100%";
    embed.style.height = "20em";
    embed.style = style;
    result = embed;
  } else if (mimeType === "text/markdown") {
    if (!isLocalURL(url) && allowExternal) {
      return `Transcluding markdown from external sources is not supported`;
    }

    const ref = parseToRef(url);

    if (!ref || !isMarkdownPath(ref.path)) {
      // We can be fairly sure this can't happen, but just be sure
      return `Couldn't transclude markdown, invalid path`;
    }

    // Do a pre-check, because `readPage` is quiete heavy
    if (!client.clientSystem.allKnownFiles.has(ref.path)) {
      return `Couldn't transclude markdown, page doesn't exist`;
    }

    result = (async () => {
      // Don't try catch, we just checked the existence
      const { text: markdown } = await client.space.readPage(
        getNameFromPath(ref.path),
      );

      const transclusion = extractTransclusion(markdown, ref.details);
      if (!transclusion) {
        return `Couldn't extract transclusion from markdown, try removing any headers '\\#' or positions '@' from your link`;
      }

      return transclusion;
    })();
  } else {
    result = `File has unsupported mimeType: ${mimeType}`;
  }

  return result;
}

/**
 * Parse an alias, possibly containing dimensions into an object
 * @example "alias", "alias|100", "alias|100x200", "100", "100x200"
 */
export function parseDimensionFromAlias(
  text: string,
): { alias: string; dimension?: ContentDimensions } {
  let alias: string;
  let dim: ContentDimensions | undefined;
  if (text.includes("|")) {
    const [aliasPart, dimPart] = text.split("|");
    alias = aliasPart;
    const [width, height] = dimPart.split("x");
    dim = {};
    if (width) {
      dim.width = parseInt(width);
    }
    if (height) {
      dim.height = parseInt(height);
    }
  } else if (/^[x\d]/.test(text)) {
    const [width, height] = text.split("x");
    dim = {};
    if (width) {
      dim.width = parseInt(width);
    }
    if (height) {
      dim.height = parseInt(height);
    }
    alias = "";
  } else {
    alias = text;
  }

  return { alias, dimension: dim };
}

/**
 * Parses a transclusion of the type `![[]]` or `![]()`
 * @param text
 */
export function parseTransclusion(
  text: string,
): {
  url: string;
  alias: string;
  dimension?: ContentDimensions;
  linktype: "wikilink" | "markdown";
} | null {
  let url, alias = undefined;
  let linktype: "wikilink" | "markdown" = "markdown";
  // TODO: Take in the tree and use tree nodes to get url and alias (Applies to all regex uses)
  mdLinkRegex.lastIndex = 0;
  wikiLinkRegex.lastIndex = 0;
  let match: RegExpMatchArray | null = null;
  if ((match = mdLinkRegex.exec(text)) && match.groups) {
    ({ url, title: alias } = match.groups);

    if (isLocalURL(url)) {
      url = resolveMarkdownLink(
        client.currentName(),
        decodeURI(url),
      );
    }
    linktype = "markdown";
  } else if ((match = wikiLinkRegex.exec(text)) && match.groups) {
    ({ stringRef: url, alias } = match.groups);
    linktype = "wikilink";
  } else {
    // We found no match
    return null;
  }

  let dimension: ContentDimensions | undefined;
  if (alias) {
    ({ alias, dimension: dimension } = parseDimensionFromAlias(alias));
  } else {
    alias = "";
  }

  return {
    url,
    alias,
    dimension,
    linktype,
  };
}
