import {
  Decoration,
  EditorState,
  Range,
  syntaxTree,
  WidgetType,
} from "../deps.ts";
import { decoratorStateField } from "./util.ts";

import type { Space } from "../../common/spaces/space.ts";

class InlineImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly space: Space,
  ) {
    super();
  }

  eq(other: InlineImageWidget) {
    return other.url === this.url && other.title === this.title;
  }

  toDOM() {
    const img = document.createElement("img");
    if (this.url.startsWith("http")) {
      img.src = this.url;
    } else {
      // Specific to mobile
      this.space.readAttachment(decodeURI(this.url), "dataurl").then(
        ({ data }) => {
          img.src = data as string;
        },
      );
    }

    img.alt = this.title;
    img.title = this.title;
    img.style.display = "block";
    img.className = "sb-inline-img";

    return img;
  }
}

export function inlineImagesPlugin(space: Space) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    const imageRegex = /!\[(?<title>[^\]]*)\]\((?<url>.+)\)/;

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "Image") {
          return;
        }

        const imageRexexResult = imageRegex.exec(
          state.sliceDoc(node.from, node.to),
        );
        if (imageRexexResult === null || !imageRexexResult.groups) {
          return;
        }

        const url = imageRexexResult.groups.url;
        const title = imageRexexResult.groups.title;
        widgets.push(
          Decoration.widget({
            widget: new InlineImageWidget(url, title, space),
          }).range(node.to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
