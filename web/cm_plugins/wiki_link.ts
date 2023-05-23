import { pageLinkRegex } from "../../common/markdown_parser/parser.ts";
import { ClickEvent } from "../../plug-api/app_event.ts";
import { Decoration, syntaxTree } from "../deps.ts";
import { Editor } from "../editor.tsx";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  LinkWidget,
} from "./util.ts";

/**
 * Plugin to hide path prefix when the cursor is not inside.
 */
export function cleanWikiLinkPlugin(editor: Editor) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    // let parentRange: [number, number];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "WikiLink") {
          return;
        }

        const text = state.sliceDoc(from, to);
        const match = pageLinkRegex.exec(text);
        if (!match) return;
        const [_fullMatch, page, pipePart, alias] = match;

        const allPages = editor.space.listPages();
        let pageExists = !editor.fullSyncCompleted;
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
        if (cleanPage === "" || cleanPage.startsWith("💭")) {
          // Empty page name, or local @anchor use
          pageExists = true;
        }

        if (isCursorInRange(state, [from, to])) {
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
              {
                text: linkText,
                title: pageExists ? `Navigate to ${page}` : `Create ${page}`,
                href: `/${page}`,
                cssClass: pageExists
                  ? "sb-wiki-link-page"
                  : "sb-wiki-link-page-missing",
                callback: (e) => {
                  if (e.altKey) {
                    // Move cursor into the link
                    return editor.editorView!.dispatch({
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
              },
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
