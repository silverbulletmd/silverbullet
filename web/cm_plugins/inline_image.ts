import {
  Decoration,
  EditorState,
  Range,
  syntaxTree,
  WidgetType,
} from "../deps.ts";
import { decoratorStateField } from "./util.ts";

import { Capacitor, Directory, Filesystem } from "../deps.ts";

class InlineImageWidget extends WidgetType {
  constructor(readonly url: string, readonly title: string) {
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
      if (Capacitor.isNativePlatform()) {
        Filesystem.getUri({
          path: this.url,
          directory: Directory.Documents,
        }).then((uri) => {
          img.src = Capacitor.convertFileSrc(uri.uri);
        });
      } else {
        img.src = `fs/${this.url}`;
      }
    }

    img.alt = this.title;
    img.title = this.title;
    img.style.display = "block";
    img.className = "sb-inline-img";

    return img;
  }
}

export function inlineImagesPlugin() {
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
            widget: new InlineImageWidget(url, title),
          }).range(node.to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
