import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  isLocalURL,
  resolveMarkdownLink,
  unwrapLinkDestination,
} from "@silverbulletmd/silverbullet/lib/resolve";
import type { Client } from "../../client.ts";
import { mdLinkRegex } from "../../markdown_parser/constants.ts";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  isReadOnlyCursorAt,
} from "../util.ts";

export function linkPlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "Link") {
          return;
        }
        const { from, to } = node;
        if (isCursorInRange(state, [from, to])) {
          return;
        }

        const text = state.sliceDoc(from, to);

        mdLinkRegex.lastIndex = 0;
        const match = mdLinkRegex.exec(text);
        if (!match || !match.groups) {
          return;
        }

        const groups = match.groups;

        if (groups.title === "") {
          // Empty link text, let's not do live preview (because it would make it disappear)
          return;
        }

        // The regex capture runs through a following title (`"…"`). The URL
        // node is the destination itself, including any `<...>` delimiters.
        const urlChild = node.node.getChild("URL");
        let url = unwrapLinkDestination(
          urlChild ? state.sliceDoc(urlChild.from, urlChild.to) : groups.url,
        );

        if (isLocalURL(url)) {
          url = resolveMarkdownLink(client.currentName(), decodeURI(url));
        }

        widgets.push(invisibleDecoration.range(from, from + 1));
        widgets.push(
          Decoration.mark({
            tagName: "a",
            class: isReadOnlyCursorAt(state, from, to)
              ? "sb-link sb-link-cursor"
              : "sb-link",
            attributes: {
              href: url,
              title: `Click to visit ${url}`,
            },
          }).range(from + 1, from + 1 + groups.title.length),
        );
        widgets.push(
          invisibleDecoration.range(from + 1 + groups.title.length, to),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
