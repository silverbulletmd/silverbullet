import {
  addParentPointers,
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  getPathExtension,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { isLocalURL } from "@silverbulletmd/silverbullet/lib/resolve";
import { mime } from "mimetypes";
import { LuaStackFrame, LuaTable } from "../space_lua/runtime.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
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

export type MarkdownExpandOptions = {
  // all options default to true, set to false to explicitly disable
  // Replace (markdown transclusions) with their content
  expandTransclusions?: boolean;
  // Replace Lua directives with their evaluated values
  expandLuaDirectives?: boolean;
  // Rewrite tasks to include references so that they can be updated
  rewriteTasks?: boolean;
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
  addParentPointers(mdTree);
  await replaceNodesMatchingAsync(mdTree, async (n) => {
    if (n.type === "Image" && options.expandTransclusions !== false) {
      // Let's scan for ![[embeds]] that are codified as Images, confusingly
      const text = renderToText(n);

      const transclusion = parseTransclusion(text);
      if (!transclusion || processedPages.has(transclusion.url)) {
        return n;
      }

      try {
        const result = await inlineContentFromURL(space, transclusion);

        // We don't transclude anything that's not markdown
        if (typeof result !== "string") {
          return n;
        }

        // We know it's a markdown page and we know we are transcluding it. "Mark"
        // it so we won't touch it down the line and cause endless recursion
        processedPages.add(transclusion.url);

        const tree = parseMarkdown(result);

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
        return parseMarkdown(`**Error:** ${e.message}`);
      }
    } else if (
      n.type === "LuaDirective" && options.expandLuaDirectives !== false
    ) {
      const expr = findNodeOfType(n, "LuaExpressionDirective") as
        | LuaExpression
        | null;
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
        return parseMarkdown(await renderExpressionResult(result));
      } catch (e: any) {
        // Reduce blast radius and give useful error message
        console.error("Error evaluating Lua directive", exprText, e);
        return parseMarkdown(`**Error:** ${e.message}`);
      }
    } else if (n.type === "Task" && options.rewriteTasks !== false) {
      // Add a task reference to this based on the current page name if there's not one already
      const existingLink = findNodeOfType(n, "WikiLink");
      if (!existingLink) {
        n.children!.splice(1, 0, {
          "text": " ",
        }, {
          "type": "WikiLink",
          "children": [
            {
              "type": "WikiLinkMark",
              "children": [{ "text": "[[" }],
            },
            {
              "type": "WikiLinkPage",
              "children": [{ "text": `${pageName}@${n.parent!.from!}` }],
            },
            {
              "type": "WikiLinkMark",
              "children": [{ "text": "]]" }],
            },
          ],
        });
      }
    }
  });
  return mdTree;
}

type OffsetText = {
  text: string;
  offset: number;
};

/**
 * Function to generate HTML or markdown for a ![[<link>]] type transclusion.
 * @param space space object to use to retrieve content (readRef)
 * @param transclusion transclusion object to process
 * @returns a string for a markdown transclusion, or html for everything else
 */
export function inlineContentFromURL(
  space: Space,
  transclusion: Transclusion,
): HTMLElement | OffsetText | Promise<HTMLElement | OffsetText> {
  const allowExternal = transclusion.linktype !== "wikilink";
  if (!client) {
    return { text: "", offset: 0 };
  }
  let mimeType: string | null | undefined;
  if (!isLocalURL(transclusion.url) && allowExternal) {
    // Remote URL
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
    const extension = URL.parse(transclusion.url)?.pathname.split(".").pop();
    if (extension) {
      mimeType = mime.getType(extension);
    }
  } else {
    const ref = parseToRef(transclusion.url);
    if (!ref) {
      throw Error(`Failed to parse url: ${transclusion.url}`);
    }

    mimeType = mime.getType(getPathExtension(ref.path));
  }

  if (!mimeType) {
    throw Error(`Failed to determine mime type for ${transclusion.url}`);
  }

  const style = `max-width: 100%;` +
    (transclusion.dimension?.width
      ? `width: ${transclusion.dimension.width}px;`
      : "") +
    (transclusion.dimension?.height
      ? `height: ${transclusion.dimension.height}px;`
      : "");

  // If the URL is a local, prefix it with /.fs and encode the : so that it's not interpreted as a protocol
  const sanitizedFsUrl = isLocalURL(transclusion.url)
    ? fsEndpoint.slice(1) + "/" + transclusion.url.replace(":", "%3A")
    : transclusion.url;

  if (mimeType.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = sanitizedFsUrl;
    img.alt = transclusion.alias;
    img.style = style;
    return img;
  } else if (mimeType.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = sanitizedFsUrl;
    video.title = transclusion.alias;
    video.controls = true;
    video.autoplay = false;
    video.style = style;
    return video;
  } else if (mimeType.startsWith("audio/")) {
    const audio = document.createElement("audio");
    audio.src = sanitizedFsUrl;
    audio.title = transclusion.alias;
    audio.controls = true;
    audio.autoplay = false;
    audio.style = style;
    return audio;
  } else if (mimeType === "application/pdf") {
    const embed = document.createElement("object");
    embed.type = mimeType;
    embed.data = sanitizedFsUrl;
    embed.style.width = "100%";
    embed.style.height = "20em";
    embed.style = style;
    return embed;
  } else if (mimeType === "text/markdown") {
    if (!isLocalURL(transclusion.url) && allowExternal) {
      throw Error(`Transcluding markdown from external sources is not allowed`);
    }

    const ref = parseToRef(transclusion.url);
    if (!ref || !isMarkdownPath(ref.path)) {
      // We can be fairly sure this can't happen, but just be sure
      throw Error(
        `Couldn't transclude markdown, invalid path: ${transclusion.url}`,
      );
    }

    return space.readRef(ref);
  } else {
    return { text: `File has unsupported mimeType: ${mimeType}`, offset: 0 };
  }
}
