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
import { isLocalURL } from "@silverbulletmd/silverbullet/lib/resolve";
import { mime } from "mimetypes";
import type { Client } from "../client.ts";
import type { LuaEnv, LuaStackFrame } from "../../lib/space_lua/runtime.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderExpressionResult } from "./result_render.ts";
import { parseExpressionString } from "../../lib/space_lua/parse.ts";
import { evalExpression } from "../../lib/space_lua/eval.ts";
import type { LuaExpression } from "../../lib/space_lua/ast.ts";

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
): Promise<ParseTree> {
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "Image") {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const wikiLinkMark = findNodeOfType(n, "WikiLinkMark");
      if (!wikiLinkMark) {
        return;
      }
      const wikiLinkPage = findNodeOfType(n, "WikiLinkPage");
      if (!wikiLinkPage) {
        return;
      }

      const page = wikiLinkPage.children![0].text!;

      const ref = parseToRef(page);

      if (!ref || !isMarkdownPath(ref.path)) {
        return;
      }

      // Read the page
      const { text } = await client.space.readPage(getNameFromPath(ref.path));
      const parsedBody = parseMarkdown(text);
      // Recursively process
      return expandMarkdown(
        client,
        parsedBody,
        env,
        sf,
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
 * Function to generate HTML or markdown for a ![[<link>]] type transclusion
 * @returns a string for a markdown transclusion or html for everything else
 */
export async function inlineHtmlFromURL(
  client: Client,
  url: string,
  alias: string,
  dimensions: ContentDimensions | undefined,
  allowExternal: boolean = true,
): Promise<HTMLElement | string> {
  let mimeType: string | null | undefined;
  if (!isLocalURL(url) && allowExternal) {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return `Failed to fetch resource, server responded with status code: ${response.status}`;
    }

    mimeType = response.headers.get("Content-Type");
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

  const setDimension = (element: HTMLElement, event: string) => {
    const cachedContentHeight = client.getCachedWidgetHeight(
      `content:${url}`,
    );

    element.addEventListener(event, () => {
      if (element.clientHeight !== cachedContentHeight) {
        client.setCachedWidgetHeight(
          `content:${url}`,
          element.clientHeight,
        );
      }
    });

    element.style.maxWidth = "100%";

    if (dimensions) {
      if (dimensions.height) {
        element.style.height = `${dimensions.height}px`;
      }
      if (dimensions.width) {
        element.style.width = `${dimensions.width}px`;
      }
    } else if (cachedContentHeight > 0) {
      element.style.height = cachedContentHeight.toString();
    }
  };

  // If the URL is a local, encode the : so that it's not interpreted as a protocol
  const sanitizedURL = isLocalURL(url) ? url.replace(":", "%3A") : url;

  let result: HTMLElement | string;
  if (mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = sanitizedURL;
    img.alt = alias;
    setDimension(img, "load");
    result = img;
  } else if (mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = sanitizedURL;
    video.title = alias;
    video.controls = true;
    video.autoplay = false;
    setDimension(video, "loadeddata");
    result = video;
  } else if (mimeType.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.src = sanitizedURL;
    audio.title = alias;
    audio.controls = true;
    audio.autoplay = false;
    setDimension(audio, "loadeddata");
    result = audio;
  } else if (mimeType === "application/pdf") {
    const embed = document.createElement("object");
    embed.type = mimeType;
    embed.data = sanitizedURL;
    embed.style.width = "100%";
    embed.style.height = "20em";
    setDimension(embed, "load");
    result = embed;
  } else if (mimeType === "text/markdown") {
    let details: Ref["details"], markdown: string;

    if (!isLocalURL(url) && allowExternal) {
      const response = await fetch(url);
      if (!response.ok) {
        // This shouldn't really happen, but let's check anyways
        return `Couldn't transclude markdown from external source. Server responded with: ${response.status}`;
      }

      markdown = await response.text();

      const parsedURL = new URL(url);
      if (parsedURL.hash) {
        details = {
          type: "header",
          header: parsedURL.hash,
        };
      }
    } else {
      const ref = parseToRef(url);

      if (!ref || !isMarkdownPath(ref.path)) {
        // We can be fairly sure this can't happen, but just be sure
        return `Couldn't transclude markdown, invalid path`;
      }

      details = ref.details;

      // Do a pre-check, because `readPage` is quiete heavy
      if (!client.clientSystem.allKnownFiles.has(ref.path)) {
        return `Couldn't transclude markdown, page doesn't exist`;
      }

      // Don't try catch, we just checked the existence
      ({ text: markdown } = await client.space.readPage(
        getNameFromPath(ref.path),
      ));
    }

    const transclusion = extractTransclusion(markdown, details);
    if (!transclusion) {
      return `Couldn't extract translcusion from markdown, try removing any headers '\\#' or positions '@' from your link`;
    }

    result = transclusion;
  } else {
    result = `Server responded with unsupported mimeType: ${mimeType}`;
  }

  return result;
}

// Parse an alias, possibly containing dimensions into an object
// Formats supported: "alias", "alias|100", "alias|100x200", "100", "100x200"
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
