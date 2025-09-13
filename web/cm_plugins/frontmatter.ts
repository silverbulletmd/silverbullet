import type {EditorState} from "@codemirror/state";
import {foldedRanges, syntaxTree} from "@codemirror/language";
import {Decoration} from "@codemirror/view";
import {decoratorStateField, HtmlWidget, isCursorInRange, LinkWidget} from "./util.ts";
import type {Client} from "../client.ts";
import {
  fileName,
  isBuiltinPath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {wikiLinkRegex} from "../markdown_parser/constants.ts";
import {encodePageURI, encodeRef, parseToRef, getNameFromPath} from "@silverbulletmd/silverbullet/lib/ref";
import type {ClickEvent} from "@silverbulletmd/silverbullet/type/client";

export function frontmatterPlugin(client: Client) {
  return decoratorStateField(
    (state: EditorState) => {
      const widgets: any[] = [];
      const foldRanges = foldedRanges(state);

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
            const from = node.from;
            const to = node.to;
            const text = state.sliceDoc(from, to);

            // 1) External links: http(s) URLs
            const urlRegex = /(https?:\/\/[^\s"']+)/g;
            let match: RegExpExecArray | null;
            while ((match = urlRegex.exec(text)) !== null) {
              const mFrom = from + (match.index ?? 0);
              const mTo = mFrom + match[0].length;
              if (isCursorInRange(state, [mFrom, mTo])) {
                continue;
              }
              const url = match[0];
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
            wikiLinkRegex.lastIndex = 0;
            let wMatch: RegExpExecArray | null;
            while ((wMatch = wikiLinkRegex.exec(text)) !== null) {
              if (!wMatch || !wMatch.groups) {
                return;
              }
              const mFrom = from + (wMatch.index ?? 0);
              const mTo = mFrom + wMatch[0].length;
              if (isCursorInRange(state, [mFrom, mTo])) {
                continue;
              }

              const {leadingTrivia, stringRef, alias, trailingTrivia} =
                wMatch.groups;

              const ref = parseToRef(stringRef);
              let linkStatus: "file-missing" | "default" | "invalid" = "default";
              if (!ref) {
                linkStatus = "invalid";
              } else if (ref.path === "" || isBuiltinPath(ref.path)) {
                linkStatus = "default";
              } else if (
                Array.from(client.clientSystem.allKnownFiles)
                  .some((file) => file === ref.path)
              ) {
                linkStatus = "default";
              } else if (client.fullSyncCompleted) {
                linkStatus = "file-missing";
              }
              let css = {
                "file-missing": "sb-wiki-link-missing",
                "invalid": "sb-wiki-link-invalid",
                "default": "",
              }[linkStatus];

              const renderingSyntax =
                client.ui.viewState.uiOptions.markdownSyntaxRendering;
              if (isCursorInRange(state, [from, to]) || renderingSyntax) {
                // Only attach a CSS class, then get out
                if (linkStatus !== "default") {
                  widgets.push(
                    Decoration.mark({
                      class: css,
                    }).range(from + leadingTrivia.length, to - trailingTrivia.length),
                  );
                }

                return;
              }
              const cleanedPath = ref ? getNameFromPath(ref.path) : stringRef;
              const helpText = {
                "default": `Navigate to ${cleanedPath}`,
                "file-missing": `Create ${cleanedPath}`,
                "invalid": `Cannot create invalid file ${cleanedPath}`,
              }[linkStatus];

              let linkText = alias || stringRef;

              // The `&& ref` is only there to make typescript happy
              if (linkStatus === "default" && ref) {
                const meta = client.ui.viewState.allPages.find((p) =>
                  parseToRef(p.ref)?.path === ref.path
                );

                const renderedRef = structuredClone(ref);

                // We don't want to render the meta
                renderedRef.meta = false;
                // We also don't want to rendered the prefix of the path
                renderedRef.path = fileName(renderedRef.path);

                const prefix = (ref.details?.type === "position" ||
                  ref.details?.type === "linecolumn")
                  ? ""
                  : (meta?.pageDecoration?.prefix ?? "");

                linkText = alias || (prefix + encodeRef(renderedRef));

                if (meta?.pageDecoration?.cssClasses) {
                  css += " sb-decorated-object " +
                    meta.pageDecoration.cssClasses
                      .join(" ")
                      .replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
                }
              }

              widgets.push(
                Decoration.replace({
                  widget: new LinkWidget({
                    text: linkText,
                    title: helpText,
                    href: ref ? encodePageURI(encodeRef(ref)) : undefined,
                    cssClass: "sb-wiki-link " + css,
                    from: mFrom,
                    callback: (e) => {
                      if (e.altKey) {
                        // Move cursor into the link's content
                        client.editorView.dispatch({
                          selection: {anchor: mFrom + leadingTrivia.length},
                        });
                        client.focus();
                        return;
                      }
                      const clickEvent: ClickEvent = {
                        page: client.currentName(),
                        ctrlKey: e.ctrlKey,
                        metaKey: e.metaKey,
                        altKey: e.altKey,
                        pos: mFrom,
                      };
                      client.dispatchClickEvent(clickEvent).catch(console.error);
                    },
                  }),
                }).range(mFrom, mTo),
              );
            }
          }
        },
      });
      return Decoration.set(widgets, true);
    },
  );
}
