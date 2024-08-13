import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { MarkdownWidget } from "./markdown_widget.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import {
  isFederationPath,
  isLocalPath,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { parsePageRef } from "@silverbulletmd/silverbullet/lib/page_ref";
import { mime } from "mimetypes";

type ContentDimensions = {
  width?: number;
  height?: number;
};

class InlineContentWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly dim: ContentDimensions | undefined,
    readonly client: Client,
  ) {
    super();
  }

  eq(other: InlineContentWidget) {
    return other.url === this.url && other.title === this.title &&
      JSON.stringify(other.dim) === JSON.stringify(this.dim);
  }

  get estimatedHeight(): number {
    const cachedHeight = this.client.getCachedWidgetHeight(
      `content:${this.url}`,
    );
    return cachedHeight;
  }

  toDOM() {
    const div = document.createElement("div");
    div.className = "sb-inline-content";
    div.style.display = "block";
    const mimeType = mime.getType(
      this.url.substring(this.url.lastIndexOf(".") + 1),
    );

    if (!mimeType) {
      return div;
    }

    if (mimeType.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = this.url;
      img.alt = this.title;
      this.setDim(img, "load");
      div.appendChild(img);
    } else if (mimeType.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = this.url;
      video.title = this.title;
      video.controls = true;
      video.autoplay = false;
      this.setDim(video, "loadeddata");
      div.appendChild(video);
    } else if (mimeType.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.src = this.url;
      audio.title = this.title;
      audio.controls = true;
      audio.autoplay = false;
      this.setDim(audio, "loadeddata");
      div.appendChild(audio);
    } else if (mimeType === "application/pdf") {
      const embed = document.createElement("object");
      embed.type = mimeType;
      embed.data = this.url;
      embed.style.width = "100%";
      embed.style.height = "20em";
      this.setDim(embed, "load");
      div.appendChild(embed);
    }

    return div;
  }

  setDim(el: HTMLElement, event: string) {
    const cachedContentHeight = this.client.getCachedWidgetHeight(
      `content:${this.url}`,
    );

    el.addEventListener(event, () => {
      if (el.clientHeight !== cachedContentHeight) {
        this.client.setCachedWidgetHeight(
          `content:${this.url}`,
          el.clientHeight,
        );
      }
    });

    el.style.maxWidth = "100%";

    if (this.dim) {
      if (this.dim.height) {
        el.style.height = `${this.dim.height}px`;
      }
      if (this.dim.width) {
        el.style.width = `${this.dim.width}px`;
      }
    } else if (cachedContentHeight > 0) {
      el.style.height = cachedContentHeight.toString();
    }
  }
}

// Parse an alias, possibly containing dimensions into an object
// Formats supported: "alias", "alias|100", "alias|100x200", "100", "100x200"
function parseAlias(
  text: string,
): { alias?: string; dim?: ContentDimensions } {
  let alias: string | undefined;
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
  } else {
    alias = text;
  }

  return { alias, dim };
}

export function inlineContentPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "Image") {
          return;
        }

        const text = state.sliceDoc(node.from, node.to);
        let [url, alias]: (string | undefined)[] = [undefined, undefined];
        let match: RegExpExecArray | null;
        if ((match = /!?\[([^\]]*)\]\((.+)\)/g.exec(text))) {
          [/* fullMatch */, alias, url] = match;
        } else if (
          (match = /(!?\[\[)([^\]\|]+)(?:\|([^\]]+))?(\]\])/g.exec(text))
        ) {
          [/* fullMatch */, /* firstMark */ , url, alias] = match;
          if (!isFederationPath(url)) {
            url = "/" + url;
          }
        }
        if (!url) {
          return;
        }

        let dim: ContentDimensions | undefined;
        if (alias) {
          const { alias: parsedAlias, dim: parsedDim } = parseAlias(alias);
          if (parsedAlias) {
            alias = parsedAlias;
          }
          dim = parsedDim;
        } else {
          alias = "";
        }

        if (isLocalPath(url)) {
          url = resolvePath(
            client.currentPage,
            decodeURI(url),
            true,
          );
          const pageRef = parsePageRef(url);
          if (
            isFederationPath(pageRef.page) ||
            client.clientSystem.allKnownFiles.has(pageRef.page + ".md")
          ) {
            // This is a page reference, let's inline the content
            const codeWidgetCallback = client.clientSystem.codeWidgetHook
              .codeWidgetCallbacks.get("transclusion");

            if (!codeWidgetCallback) {
              return;
            }

            widgets.push(
              Decoration.widget({
                widget: new MarkdownWidget(
                  node.from,
                  client,
                  `widget:${client.currentPage}:${text}`,
                  text,
                  codeWidgetCallback,
                  "sb-markdown-widget sb-markdown-widget-inline",
                ),
                block: true,
              }).range(node.to + 1),
            );
            return;
          }
        }

        widgets.push(
          Decoration.widget({
            widget: new InlineContentWidget(
              url,
              alias,
              dim,
              client,
            ),
            block: true,
          }).range(node.to),
        );

        if (!isCursorInRange(state, [node.from, node.to])) {
          widgets.push(invisibleDecoration.range(node.from, node.to));
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
