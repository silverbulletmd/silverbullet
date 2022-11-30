import { pageLinkRegex } from "../../common/parser.ts";
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
  LinkWidget,
} from "./util.ts";

/**
 * Plugin to hide path prefix when the cursor is not inside.
 */
export function cleanWikiLinkPlugin(editor: Editor) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.compute(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged || update.viewportChanged || update.selectionSet
        ) {
          this.decorations = this.compute(update.view);
        }
      }
      compute(view: EditorView): DecorationSet {
        const widgets: any[] = [];
        // let parentRange: [number, number];
        iterateTreeInVisibleRanges(view, {
          enter: ({ type, from, to }) => {
            if (type.name !== "WikiLink") {
              return;
            }

            const text = view.state.sliceDoc(from, to);
            const match = pageLinkRegex.exec(text);
            if (!match) return;
            const [_fullMatch, page, pipePart, alias] = match;

            const allPages = editor.space.listPages();
            let pageExists = false;
            let cleanPage = page;
            if (page.includes("@")) {
              cleanPage = page.split("@")[0];
            }
            for (const pageMeta of allPages) {
              if (pageMeta.name === cleanPage) {
                pageExists = true;
                break;
              }
            }

            if (isCursorInRange(view.state, [from, to])) {
              // Only attach a CSS class, then get out
              if (!pageExists) {
                widgets.push(
                  Decoration.mark({
                    class: "sb-wiki-link-page-missing",
                  }).range(from + 2, from + page.length + 2),
                );
              }
              return;
            }

            // Hide the whole thing
            widgets.push(
              invisibleDecoration.range(
                from,
                to,
              ),
            );

            let linkText = alias || page;
            if (!pipePart && text.indexOf("/") !== -1) {
              // Let's use the last part of the path as the link text
              linkText = page.split("/").pop()!;
            }

            // And replace it with a widget
            widgets.push(
              Decoration.widget({
                widget: new LinkWidget(
                  linkText,
                  pageExists ? `Navigate to ${page}` : `Create ${page}`,
                  pageExists
                    ? "sb-wiki-link-page"
                    : "sb-wiki-link-page-missing",
                  (e) => {
                    if (e.altKey) {
                      // Move cursor into the link
                      return view.dispatch({
                        selection: { anchor: from + 2 },
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
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
