import { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { decoratorStateField } from "./util.ts";
import type { Client } from "../client.ts";
import { isLocalPath, resolvePath } from "$sb/lib/resolve.ts";
import { mdLinkRegex, wikiLinkRegex } from "$common/markdown_parser/parser.ts";

class InlineImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly dim: string | null,
    readonly client: Client,
  ) {
    super();
    // console.log("Creating widget", url);
  }

  eq(other: InlineImageWidget) {
    return other.url === this.url && other.title === this.title &&
      other.dim === this.dim;
  }

  get estimatedHeight(): number {
    const cachedHeight = this.client.getCachedWidgetHeight(`image:${this.url}`);
    // console.log("Estimated height requested", this.url, cachedHeight);
    return cachedHeight;
  }

  private getDimensions(dimensionsToParse: string) {
    const [, width, widthUnit = "px", height, heightUnit = "px"] =
      dimensionsToParse.match(/(\d*)(\S*?x?)??[xX](\d*)(.*)?/) ?? [];
    return { width, widthUnit, height, heightUnit };
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
      const { width, widthUnit, height, heightUnit } = this.getDimensions(
        this.dim,
      );
      img.style.height = height ? `${height}${heightUnit}` : "";
      img.style.width = width ? `${width}${widthUnit}` : "";
    } else if (cachedImageHeight > 0) {
      img.height = cachedImageHeight;
    }

    return img;
  }
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
        let [url, alias, dim]: (string | null)[] = [null, null, null];
        let match: RegExpExecArray | null;
        if ((match = /!?\[([^\]]*)\]\((.+)\)/g.exec(text))) {
          [/* fullMatch */, alias, url] = match;
        } else if (
          (match = /(!?\[\[)([^\]\|]+)(?:\|([^\]]+))?(\]\])/g.exec(text))
        ) {
          [/* fullMatch */, /* firstMark */ , url, alias] = match;
          url = "/" + url;
        } else {
          return;
        }

        if (alias) {
          const dimReg = /\d*[^\|\s]*?[xX]\d*[^\|\s]*/.exec(alias);
          if (dimReg) {
            dim = dimReg[0];
            alias = alias.replace(dim, "").replace("|", "");
          }
        } else {
          alias = "";
        }

        if (isLocalPath(url)) {
          url = resolvePath(client.currentPage, decodeURI(url), true);
        }

        widgets.push(
          Decoration.widget({
            widget: new InlineImageWidget(url, alias, dim, client),
            block: true,
          }).range(node.to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
