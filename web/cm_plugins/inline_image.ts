import { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { decoratorStateField } from "./util.ts";
import type { Client } from "../client.ts";
import { resolveAttachmentPath, resolvePath } from "$sb/lib/resolve.ts";

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
      dimensionsToParse.match(/(\d*)(%)?x(\d*)(%)?/) ?? [];
    return { width, widthUnit, height, heightUnit };
  }

  toDOM() {
    const img = document.createElement("img");
    let url = this.url;
    url = resolvePath(this.client.currentPage, url, true);
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
    img.src = url;
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
    const imageRegex =
      /!\[(?<title>[^\]]*)\]\((?<url>\S+)(?:\s+=(?<dim>\d*%?x\d+%?|\d+%?x\d*%?))?\)/;

    syntaxTree(state).iterate({
      enter: (node) => {
        if (!["Image", "ImageWithSize"].includes(node.name)) {
          return;
        }

        const imageRexexResult = imageRegex.exec(
          state.sliceDoc(node.from, node.to),
        );
        if (imageRexexResult === null || !imageRexexResult.groups) {
          return;
        }

        let url = imageRexexResult.groups.url;
        const { title, dim } = imageRexexResult.groups;

        if (url.indexOf("://") === -1 && !url.startsWith("/")) {
          url = resolveAttachmentPath(client.currentPage, decodeURI(url));
        }
        widgets.push(
          Decoration.widget({
            widget: new InlineImageWidget(url, title, dim, client),
            block: true,
          }).range(node.to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
