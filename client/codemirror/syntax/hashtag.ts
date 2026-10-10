import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { encodePageURI } from "@silverbulletmd/silverbullet/lib/ref";
import { extractHashtag } from "../../../plug-api/lib/tags.ts";
import * as Constants from "../../../plugs/index/constants.ts";
import type { Client } from "../../client.ts";
import { decoratorStateField } from "../util.ts";

export function hashtagPlugin(client: Client) {
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
        const tagPage = client.config.get<string | null>(
          ["tags", tagName, "tagPage"],
          null,
        );
        const target = tagPage ?? Constants.tagPrefix + tagName;

        widgets.push(
          Decoration.mark({
            tagName: "a",
            class: "sb-hashtag",
            attributes: {
              href: `/${encodePageURI(target)}`,
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
