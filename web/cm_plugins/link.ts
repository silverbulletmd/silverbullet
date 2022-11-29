import { ClickEvent } from "../../plug-api/app_event.ts";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "../deps.ts";
import { Editor } from "../editor.tsx";
import {
  invisibleDecoration,
  isCursorInRange,
  iterateTreeInVisibleRanges,
} from "./util.ts";
import { LinkWidget } from "./util.ts";

export function linkPlugin(editor: Editor) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      constructor(readonly view: EditorView) {
        this.decorations = this.calculateDecorations();
      }
      calculateDecorations() {
        const widgets: any[] = [];
        const view = this.view;

        iterateTreeInVisibleRanges(this.view, {
          enter: ({ type, from, to }) => {
            if (type.name !== "Link") {
              return;
            }
            // Adding 2 on each side due to [[ and ]] that are outside the WikiLinkPage node
            if (isCursorInRange(view.state, [from, to])) {
              return;
            }

            const text = view.state.sliceDoc(from, to);
            // Links are of the form [hell](https://example.com)
            const [anchorPart, linkPart] = text.split("]("); // Not pretty
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
                  cleanAnchor,
                  `Click to visit ${cleanLink}`,
                  "sb-link",
                  (e) => {
                    if (e.altKey) {
                      // Move cursor into the link, approximate location
                      return view.dispatch({
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
                ),
              }).range(from),
            );
          },
        });

        return Decoration.set(widgets, true);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet
        ) {
          this.decorations = this.calculateDecorations();
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
