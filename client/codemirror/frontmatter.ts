import type { EditorState } from "@codemirror/state";
import { foldedRanges, syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  HtmlWidget,
  isCursorInRange,
  LinkWidget,
} from "./util.ts";
import type { Client } from "../client.ts";
import {
  frontmatterQuotesRegex,
  frontmatterUrlRegex,
  frontmatterWikiLinkRegex,
} from "../markdown_parser/constants.ts";
import { processWikiLink, type WikiLinkMatch } from "./wiki_link_processor.ts";

export function frontmatterPlugin(client: Client) {
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];
      const foldRanges = foldedRanges(state);
      const shortWikiLinks = client.config.get("shortWikiLinks", true);

      syntaxTree(state).iterate({
        enter(node) {
          if (
            node.name === "FrontMatterMarker"
          ) {
            const parent = node.node.parent!;

            const folded = foldRanges.iter();
            let shouldShowFrontmatterBanner = false;
            while (folded.value) {
              // Check if cursor is in the folded range
              if (isCursorInRange(state, [folded.from, folded.to])) {
                // console.log("Cursor is in folded area, ");
                shouldShowFrontmatterBanner = true;
                break;
              }
              folded.next();
            }
            if (!isCursorInRange(state, [parent.from, parent.to])) {
              widgets.push(
                Decoration.line({
                  class: "sb-line-frontmatter-outside",
                }).range(node.from),
              );
              shouldShowFrontmatterBanner = true;
            }
            if (shouldShowFrontmatterBanner && parent.from === node.from) {
              // Only put this on the first line of the frontmatter
              widgets.push(
                Decoration.widget({
                  widget: new HtmlWidget(
                    `frontmatter`,
                    "sb-frontmatter-marker",
                  ),
                }).range(node.from),
              );
            }
          }

          // Render links inside frontmatter code as clickable anchors (external and wiki links)
          if (node.name === "FrontMatterCode") {
            const oFrom = node.from;
            const oTo = node.to;

            if (isCursorInRange(state, [oFrom, oTo])) {
              return;
            }

            const otext = state.sliceDoc(oFrom, oTo);

            let oMatch: RegExpExecArray | null;
            while ((oMatch = frontmatterQuotesRegex.exec(otext)) !== null) {
              const from = oFrom + (oMatch.index ?? 0);
              const to = from + oMatch[0].length;
              const text = state.sliceDoc(from, to);

              // 1) External links: http(s) URLs
              frontmatterUrlRegex.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = frontmatterUrlRegex.exec(text)) !== null) {
                const mFrom = from + (match.index ?? 0);
                const mTo = mFrom + match[0].length;
                const url = match[1];
                widgets.push(
                  Decoration.replace({
                    widget: new LinkWidget({
                      text: url,
                      title: `Open ${url}`,
                      href: url,
                      cssClass: "sb-external-link",
                      from: mFrom,
                      callback: (e) => {
                        if (e.altKey) {
                          // Move cursor into the link
                          client.editorView.dispatch({
                            selection: { anchor: mFrom },
                          });
                          client.focus();
                          return;
                        }
                        try {
                          globalThis.open(url, "_blank");
                        } catch (err) {
                          console.error("Failed to open external link", err);
                        }
                      },
                    }),
                  }).range(mFrom, mTo),
                );
              }

              // 2) Internal links: WikiLinks [[...]] (make navigable)
              frontmatterWikiLinkRegex.lastIndex = 0;
              let wMatch: RegExpExecArray | null;
              while ((wMatch = frontmatterWikiLinkRegex.exec(text)) !== null) {
                if (!wMatch || !wMatch.groups) {
                  return;
                }
                const mFrom = from + (wMatch.index ?? 0);
                const mTo = mFrom + wMatch[0].length;

                const wikiLinkMatch: WikiLinkMatch = {
                  leadingTrivia: wMatch.groups.leadingTrivia,
                  stringRef: wMatch.groups.stringRef,
                  alias: wMatch.groups.alias,
                  trailingTrivia: wMatch.groups.trailingTrivia,
                };

                const decorations = processWikiLink({
                  from,
                  to,
                  match: wikiLinkMatch,
                  matchFrom: mFrom,
                  matchTo: mTo,
                  client,
                  shortWikiLinks,
                  state,
                  callback: (e, ref) => {
                    if (e.altKey) {
                      // Move cursor into the link's content
                      client.editorView.dispatch({
                        selection: {
                          anchor: mFrom + wikiLinkMatch.leadingTrivia.length,
                        },
                      });
                      client.focus();
                      return;
                    }
                    client.navigate(
                      ref,
                      false,
                      e.ctrlKey || e.metaKey,
                    );
                  },
                });

                widgets.push(...decorations);
              }
            }
          }
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
