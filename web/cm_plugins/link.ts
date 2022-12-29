import { ClickEvent } from "../../plug-api/app_event.ts";
import { Decoration, syntaxTree } from "../deps.ts";
import { Editor } from "../editor.tsx";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import { LinkWidget } from "./util.ts";

export function linkPlugin(editor: Editor) {
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
        const cleanLink = linkPart.substring(0, linkPart.length - 1); // cut off the final )

        // Hide the whole thing
        widgets.push(
          invisibleDecoration.range(
            from,
            to,
          ),
        );

        widgets.push(
          Decoration.widget({
            widget: new LinkWidget(
              {
                text: cleanAnchor,
                title: `Click to visit ${cleanLink}`,
                cssClass: "sb-link",
                href: cleanLink,
                callback: (e) => {
                  if (e.altKey) {
                    // Move cursor into the link, approximate location
                    return editor.editorView!.dispatch({
                      selection: { anchor: from + 1 },
                    });
                  }
                  // Dispatch click event to navigate there without moving the cursor
                  const clickEvent: ClickEvent = {
                    page: editor.currentPage!,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    altKey: e.altKey,
                    pos: from,
                  };
                  editor.dispatchAppEvent("page:click", clickEvent).catch(
                    console.error,
                  );
                },
              },
            ),
          }).range(from),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
