import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { decoratorStateField } from "./util.ts";
import * as Constants from "../../plugs/index/constants.ts";
import { extractHashtag } from "../../plug-api/lib/tags.ts";

export function hashtagPlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Hashtag") {
          return;
        }

        const tag = state.sliceDoc(from, to);

        if (tag.length === 1) {
          // Invalid Hashtag, a length of 1 means its just #
          return;
        }

        const tagName = extractHashtag(tag);

        // Wrap the tag in html anchor element
        widgets.push(
          Decoration.mark({
            tagName: "a",
            class: "sb-hashtag",
            attributes: {
              href: `/${Constants.tagPrefix}${tagName}`,
              rel: "tag",
              "data-tag-name": tagName,
            },
          }).range(from, to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
