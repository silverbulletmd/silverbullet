import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import type { Client } from "../client.ts";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import { mdLinkRegex } from "../markdown_parser/constants.ts";

export function linkPlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Link") {
          return;
        }
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

        let url = groups.url;

        if (isLocalURL(url)) {
          url = resolveMarkdownLink(
            client.currentName(),
            decodeURI(url),
          );
        }

        // Hide the start [
        widgets.push(
          invisibleDecoration.range(
            from,
            from + 1,
          ),
        );
        // Wrap the link in a href
        widgets.push(
          Decoration.mark({
            tagName: "a",
            class: "sb-link",
            attributes: {
              href: url,
              title: `Click to visit ${url}`,
            },
          }).range(from + 1, from + 1 + groups.title.length),
        );
        // Hide the tail end of the link
        widgets.push(
          invisibleDecoration.range(
            from + 1 + groups.title.length,
            to,
          ),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
