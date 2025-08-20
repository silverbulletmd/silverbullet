import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField, isCursorInRange, LinkWidget } from "./util.ts";
import {
  fileName,
  isBuiltinPath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  encodePageURI,
  encodeRef,
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { ClickEvent } from "@silverbulletmd/silverbullet/type/client";
import { wikiLinkRegex } from "../markdown_parser/constants.ts";

/**
 * Plugin to hide path prefix when the cursor is not inside.
 */
export function cleanWikiLinkPlugin(client: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    // let parentRange: [number, number];
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

        const { leadingTrivia, stringRef, alias, trailingTrivia } =
          match.groups;

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

        if (isCursorInRange(state, [from, to])) {
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

        // And replace it with a widget
        widgets.push(
          Decoration.replace({
            widget: new LinkWidget({
              text: linkText,
              title: helpText,
              href: ref ? encodePageURI(encodeRef(ref)) : undefined,
              cssClass: "sb-wiki-link " + css,
              from,
              callback: (e) => {
                if (e.altKey) {
                  // Move cursor into the link
                  client.editorView.dispatch({
                    selection: { anchor: from + leadingTrivia.length },
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
            }),
          }).range(from, to),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
