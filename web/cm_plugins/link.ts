import { resolveAttachmentPath } from "$sb/lib/resolve.ts";
import { Client } from "../client.ts";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

export function linkPlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Link") {
          return;
        }
        // Adding 2 on each side due to [[ and ]] that are outside the WikiLinkPage node
        if (isCursorInRange(state, [from, to])) {
          return;
        }

        const text = state.sliceDoc(from, to);
        // Links are of the form [hell](https://example.com)
        const [anchorPart, linkPart] = text.split("]("); // Not pretty
        if (anchorPart.substring(1).trim() === "") {
          // Empty link text, let's not do live preview (because it would make it disappear)
          return;
        }
        if (!linkPart) {
          // Invalid link
          return;
        }
        const cleanAnchor = anchorPart.substring(1); // cut off the initial [
        let cleanLink = linkPart.substring(0, linkPart.length - 1); // cut off the final )

        if (!cleanLink.includes("://")) {
          cleanLink = resolveAttachmentPath(
            client.currentPage,
            decodeURI(cleanLink),
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
              href: cleanLink,
              title: `Click to visit ${cleanLink}`,
              contenteditable: "false",
            },
          }).range(from + 1, from + cleanAnchor.length + 1),
        );
        // Hide the tail end of the link
        widgets.push(
          invisibleDecoration.range(
            from + cleanAnchor.length + 1,
            to,
          ),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
