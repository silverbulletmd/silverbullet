import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import type { Client } from "../../client.ts";
import { markdownLinkPartsOfNode } from "../../markdown_parser/markdown_link.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "../util.ts";

export function linkPlugin(client: Client) {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter: ({ type, from, to, node }) => {
        if (type.name !== "Link") {
          return;
        }
        if (isCursorInRange(state, [from, to])) {
          return;
        }

        const parts = markdownLinkPartsOfNode(node);
        if (!parts) {
          return;
        }

        if (parts.textFrom === parts.textTo) {
          // Empty link text, let's not do live preview (because it would make it disappear)
          return;
        }

        let url = state.sliceDoc(parts.destinationFrom, parts.destinationTo);

        if (isLocalURL(url)) {
          url = resolveMarkdownLink(client.currentName(), decodeURI(url));
        }

        widgets.push(invisibleDecoration.range(from, parts.textFrom));
        widgets.push(
          Decoration.mark({
            tagName: "a",
            class: "sb-link",
            attributes: {
              href: url,
              title: `Click to visit ${url}`,
            },
          }).range(parts.textFrom, parts.textTo),
        );
        widgets.push(invisibleDecoration.range(parts.textTo, to));
      },
    });

    return Decoration.set(widgets, true);
  }, {});
}
