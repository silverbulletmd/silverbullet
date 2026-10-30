import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { Client } from "../../client.ts";
import {
  frontmatterMailtoRegex,
  frontmatterQuotesRegex,
  frontmatterUrlRegex,
  frontmatterWikiLinkRegex,
} from "../../markdown_parser/constants.ts";
import {
  decoratorStateField,
  isCursorInRange,
  LinkWidget,
  revealSource,
} from "../util.ts";
import { processWikiLink, type WikiLinkMatch } from "./wiki_link_processor.ts";

/** "frontmatter", in the top-right corner of frontmatter shown as YAML */
class FrontmatterLabelWidget extends WidgetType {
  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "sb-frontmatter-marker";
    label.setAttribute("aria-hidden", "true");
    label.textContent = "frontmatter";
    return label;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof FrontmatterLabelWidget;
  }
}

const frontmatterLabel = Decoration.widget({
  widget: new FrontmatterLabelWidget(),
});

export function shouldRenderFrontmatterLivePreview({
  state,
  client,
  from,
  to,
}: {
  state: EditorState;
  client: Client;
  from: number;
  to: number;
}): boolean {
  return (
    !client.ui.viewState.uiOptions.markdownSyntaxRendering &&
    !isCursorInRange(state, [from, to])
  );
}

export function frontmatterPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    const shortWikiLinks = client.config.get("shortWikiLinks", true);

    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === "FrontMatterMarker") {
          const parent = node.node.parent!;
          if (!isCursorInRange(state, [parent.from, parent.to])) {
            widgets.push(
              Decoration.line({
                class: "sb-line-frontmatter-outside",
              }).range(node.from),
            );
          }
          if (parent.from === node.from) {
            widgets.push(frontmatterLabel.range(node.from));
          }
        }

        if (node.name === "FrontMatterCode") {
          const oFrom = node.from;
          const oTo = node.to;
          const otext = state.sliceDoc(oFrom, oTo);

          let oMatch: RegExpExecArray | null;
          while ((oMatch = frontmatterQuotesRegex.exec(otext)) !== null) {
            const from = oFrom + (oMatch.index ?? 0);
            const to = from + oMatch[0].length;
            const text = state.sliceDoc(from, to);

            frontmatterUrlRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = frontmatterUrlRegex.exec(text)) !== null) {
              const mFrom = from + (match.index ?? 0);
              const mTo = mFrom + match[0].length;
              const url = match[1];
              if (
                !shouldRenderFrontmatterLivePreview({
                  state,
                  client,
                  from: mFrom,
                  to: mTo,
                })
              ) {
                continue;
              }
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
                        revealSource(
                          client.editorView,
                          { anchor: mFrom },
                          { from: mFrom, to: mTo },
                        );
                        client.focus();
                        return;
                      }
                      try {
                        // Open http(s) links in a new window/tab, open
                        // alternate schemes in the same page, as they'll
                        // bounce to another application.
                        if (/^https?:\/\//i.test(url)) {
                          globalThis.open(url, "_blank");
                        } else {
                          globalThis.open(url, "_self");
                        }
                      } catch (err) {
                        console.error("Failed to open external link", err);
                      }
                    },
                  }),
                }).range(mFrom, mTo),
              );
            }

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
                from: mFrom,
                to: mTo,
                match: wikiLinkMatch,
                matchFrom: mFrom,
                matchTo: mTo,
                client,
                shortWikiLinks,
                state,
                callback: (e, ref) => {
                  if (e.altKey) {
                    revealSource(
                      client.editorView,
                      { anchor: mFrom + wikiLinkMatch.leadingTrivia.length },
                      { from: mFrom, to: mTo },
                    );
                    client.focus();
                    return;
                  }
                  void client.navigate(ref, false, e.ctrlKey || e.metaKey);
                },
              });

              widgets.push(...decorations);
            }

            frontmatterMailtoRegex.lastIndex = 0;
            let mMatch: RegExpExecArray | null;
            while ((mMatch = frontmatterMailtoRegex.exec(text)) !== null) {
              const mFrom = from + (mMatch.index ?? 0);
              const mTo = mFrom + mMatch[0].length;
              const url = mMatch[1];
              const address = url.slice(7);
              if (
                !shouldRenderFrontmatterLivePreview({
                  state,
                  client,
                  from: mFrom,
                  to: mTo,
                })
              ) {
                continue;
              }
              widgets.push(
                Decoration.replace({
                  widget: new LinkWidget({
                    text: url,
                    title: `Mail ${address}`,
                    href: url,
                    cssClass: "sb-external-link",
                    from: mFrom,
                    callback: (e) => {
                      if (e.altKey) {
                        revealSource(
                          client.editorView,
                          { anchor: mFrom },
                          { from: mFrom, to: mTo },
                        );
                        client.focus();
                        return;
                      }
                      try {
                        globalThis.open(url, "_self");
                      } catch (err) {
                        console.error("Failed to open external link", err);
                      }
                    },
                  }),
                }).range(mFrom, mTo),
              );
            }
          }
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}
