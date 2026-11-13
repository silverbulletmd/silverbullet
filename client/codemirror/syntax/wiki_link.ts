import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import type { Client } from "../../client.ts";
import { wikiLinkRegex } from "../../markdown_parser/constants.ts";
import { decoratorStateField, revealSource } from "../util.ts";
import { processWikiLink, type WikiLinkMatch } from "./wiki_link_processor.ts";

/**
 * Plugin to hide path prefix when the cursor is not inside.
 */
export function cleanWikiLinkPlugin(client: Client) {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const widgets: any[] = [];
    const shortWikiLinks = client.config.get("shortWikiLinks", true);

    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
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
          shortWikiLinks,
          state,
          callback: (e, _ref, shift) => {
            if (e.altKey) {
              revealSource(
                client.editorView,
                {
                  anchor: from + shift + wikiLinkMatch.leadingTrivia.length,
                },
                { from: from + shift, to: to + shift },
              );
              client.focus();
              return;
            }
            // Dispatch click event to navigate there without moving the cursor
            const clickEvent: ClickEvent = {
              page: client.currentName(),
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              altKey: e.altKey,
              pos: from + shift,
            };
            client.dispatchClickEvent(clickEvent).catch(console.error);
          },
        });

        widgets.push(...decorations);
      },
    });
    return Decoration.set(widgets, true);
  }, {});
}
