import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  getNameFromPath,
  getPathExtension,
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { LuaWidget } from "./lua_widget.ts";
import { mdLinkRegex, wikiLinkRegex } from "../markdown_parser/constants.ts";
import { mime } from "mimetypes";

type ContentDimensions = {
  width?: number;
  height?: number;
};

async function inlineHtmlFromURL(
  client: Client,
  url: string,
  alias: string,
  dimensions: ContentDimensions | undefined,
): Promise<HTMLElement | string> {
  let mimeType: string | null | undefined;
  if (!isLocalURL(url)) {
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
    if (!isLocalURL(url)) {
      const response = await fetch(url);
      if (!response.ok) {
        // This shouldn't really happen, but let's check anyways
        return `Couldn't transclude markdown from external source. Server responded with: ${response.status}`;
      }

      result = await response.text();
    } else {
      const ref = parseToRef(url);

      if (!ref || !isMarkdownPath(ref.path)) {
        // We can be fairly sure this can't happen, but just be sure
        return `Couldn't transclude markdown, invalid path`;
      }

      try {
        ({ text: result } = await client.space.readPage(
          getNameFromPath(ref.path),
        ));
      } catch {
        result = `Couldn't transclude markdown, page doesn't exist`;
      }
    }
  } else {
    result = `Server responded with unsupported mimeType: ${mimeType}`;
  }

  return result;
}

// Parse an alias, possibly containing dimensions into an object
// Formats supported: "alias", "alias|100", "alias|100x200", "100", "100x200"
function parseAlias(
  text: string,
): { alias: string; dim?: ContentDimensions } {
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

  return { alias, dim };
}

export function inlineContentPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      console.info("Not rendering widgets");
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Image") {
          return;
        }

        const text = state.sliceDoc(from, to);

        let url, alias = undefined;

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
        } else if ((match = wikiLinkRegex.exec(text)) && match.groups) {
          ({ stringRef: url, alias } = match.groups);
        } else {
          // We found no match
          return;
        }

        let dimension: ContentDimensions | undefined;
        if (alias) {
          ({ alias, dim: dimension } = parseAlias(alias));
        } else {
          alias = "";
        }

        if (!isCursorInRange(state, [from, to])) {
          widgets.push(invisibleDecoration.range(from, to));
        }

        widgets.push(
          Decoration.widget({
            widget: new LuaWidget(
              client,
              `widget:${client.currentPath()}:${text}`,
              text,
              async () => {
                const result = await inlineHtmlFromURL(
                  client,
                  url,
                  alias,
                  dimension,
                );
                const content = typeof result === "string"
                  ? { markdown: result }
                  : { html: result };

                return {
                  _isWidget: true,
                  display: "block",
                  cssClasses: ["sb-inline-content"],
                  ...content,
                };
              },
              true,
              true,
            ),
            block: true,
          }).range(to + 1),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
