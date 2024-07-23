import { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { MarkdownWidget } from "./markdown_widget.ts";
import { decoratorStateField } from "./util.ts";
import type { Client } from "../client.ts";
import { isFederationPath, isLocalPath, resolvePath } from "$sb/lib/resolve.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";

type ImageDimensions = {
  width?: number;
  height?: number;
};

class InlineContentWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly dim: ImageDimensions | undefined,
    readonly client: Client,
  ) {
    super();
  }

  eq(other: InlineContentWidget) {
    return other.url === this.url && other.title === this.title &&
      JSON.stringify(other.dim) === JSON.stringify(this.dim);
  }

  get estimatedHeight(): number {
    const cachedHeight = this.client.getCachedWidgetHeight(`image:${this.url}`);
    return cachedHeight;
  }

  toDOM() {
    const img = document.createElement("img");
    // console.log("Creating DOM", this.url);
    const cachedImageHeight = this.client.getCachedWidgetHeight(
      `image:${this.url}`,
    );
    img.onload = () => {
      // console.log("Loaded", this.url, "with height", img.height);
      if (img.height !== cachedImageHeight) {
        this.client.setCachedWidgetHeight(`image:${this.url}`, img.height);
      }
    };
    img.src = this.url;
    img.alt = this.title;
    img.title = this.title;
    img.style.display = "block";
    img.className = "sb-inline-img";
    if (this.dim) {
      img.style.height = this.dim.height ? `${this.dim.height}px` : "";
      img.style.width = this.dim.width ? `${this.dim.width}px` : "";
    } else if (cachedImageHeight > 0) {
      img.height = cachedImageHeight;
    }

    return img;
  }
}

// Parse an alias, possibly containing image dimensions into an object
// Formats supported: "alias", "alias|100", "alias|100x200", "100", "100x200"
function parseAlias(
  text: string,
): { alias?: string; dim?: ImageDimensions } {
  let alias: string | undefined;
  let dim: ImageDimensions | undefined;
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

export function inlineImagesPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "Image") {
          return;
        }

        const text = state.sliceDoc(node.from, node.to);
        let [url, alias]: (string | null)[] = [null, null];
        let dim: ImageDimensions | undefined;
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
        } else {
          return;
        }

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
          url = resolvePath(client.currentPage, decodeURI(url), true);
          const pageRef = parsePageRef(url);
          if (
            isFederationPath(pageRef.page) ||
            client.clientSystem.allKnownFiles.has(pageRef.page + ".md")
          ) {
            // This is a page reference, let's inline the content
            const codeWidgetCallback = client.clientSystem.codeWidgetHook
              .codeWidgetCallbacks.get("template");

            if (!codeWidgetCallback) {
              return;
            }

            widgets.push(
              Decoration.line({
                class: "sb-fenced-code-iframe",
              }).range(node.to),
            );

            widgets.push(
              Decoration.widget({
                widget: new MarkdownWidget(
                  node.from,
                  client,
                  `widget:${client.currentPage}:${text}`,
                  `{{rewriteRefsAndFederationLinks([[${url}]], "${url}")}}`,
                  codeWidgetCallback,
                  "sb-markdown-widget sb-markdown-widget-inline",
                ),
                block: true,
              }).range(node.to),
            );
            return;
          }
        }

        widgets.push(
          Decoration.widget({
            widget: new InlineContentWidget(url, alias, dim, client),
            block: true,
          }).range(node.to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
