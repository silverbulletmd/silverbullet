import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField } from "./util.ts";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import { wikiLinkRegex } from "../markdown_parser/constants.ts";
import { processWikiLink, type WikiLinkMatch } from "./wiki_link_processor.ts";

/**
 * Plugin to hide path prefix when the cursor is not inside.
 */
export function cleanWikiLinkPlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "WikiLink") {
          return;
        }

        const text = state.sliceDoc(from, to);

        wikiLinkRegex.lastIndex = 0;
        const match = wikiLinkRegex.exec(text);
        if (!match || !match.groups) {
          return;
        }

        const wikiLinkMatch: WikiLinkMatch = {
          leadingTrivia: match.groups.leadingTrivia,
          stringRef: match.groups.stringRef,
          alias: match.groups.alias,
          trailingTrivia: match.groups.trailingTrivia,
        };

        const decorations = processWikiLink({
          from,
          to,
          match: wikiLinkMatch,
          matchFrom: from,
          matchTo: to,
          client,
          state,
          callback: (e) => {
            if (e.altKey) {
              // Move cursor into the link
              client.editorView.dispatch({
                selection: { anchor: from + wikiLinkMatch.leadingTrivia.length },
              });
              client.focus();
              return;
            }
            // Dispatch click event to navigate there without moving the cursor
            const clickEvent: ClickEvent = {
              page: client.currentName(),
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              altKey: e.altKey,
              pos: from,
            };
            client.dispatchClickEvent(clickEvent).catch(
              console.error,
            );
          },
        });

        widgets.push(...decorations);
      },
    });
    return Decoration.set(widgets, true);
  });
}
