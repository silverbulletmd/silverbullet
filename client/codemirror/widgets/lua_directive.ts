import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  isLocalURL,
  resolveMarkdownLink,
} from "@silverbulletmd/silverbullet/lib/resolve";
import type { Client } from "../../client.ts";
import { mdLinkRegex } from "../../markdown_parser/constants.ts";
import { renderLuaExpression } from "../../space_lua/render_widget.ts";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
  widgetRenderMode,
} from "../util.ts";
import { directiveCacheKey } from "./directive_actions.ts";
import { directiveExpr } from "./directive_at.ts";
import { LoadingWidget } from "./loading_widget.ts";
import { type InlineWrapper, LuaWidget } from "./lua_widget.ts";

/** The inline formatting and link a directive sits in, outermost first. */
export function directiveWrappers(
  node: SyntaxNode,
  state: EditorState,
  currentPage: string,
): InlineWrapper[] {
  const out: InlineWrapper[] = [];
  for (let p = node.parent; p; p = p.parent) {
    switch (p.name) {
      case "StrongEmphasis":
        out.unshift({ tag: "strong" });
        break;
      case "Emphasis":
        out.unshift({ tag: "em" });
        break;
      case "Strikethrough":
        out.unshift({ tag: "del" });
        break;
      case "Highlight":
        out.unshift({ tag: "span", attrs: { class: "sb-highlight" } });
        break;
      case "Link": {
        mdLinkRegex.lastIndex = 0;
        const url = mdLinkRegex.exec(state.sliceDoc(p.from, p.to))?.groups?.url;
        if (!url) break;
        out.unshift({
          tag: "a",
          attrs: isLocalURL(url)
            ? {
                class: "sb-link",
                href: "#",
                "data-ref": resolveMarkdownLink(currentPage, decodeURI(url)),
              }
            : {
                class: "sb-link",
                href: url,
                target: "_blank",
                rel: "noopener",
              },
        });
        break;
      }
    }
  }
  return out;
}

export function luaDirectivePlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    let shouldRender = true;

    const renderMode = widgetRenderMode(client);
    if (renderMode === "disabled") {
      return Decoration.none;
    }

    syntaxTree(state).iterate({
      enter: (node) => {
        // Disable rendering of Lua directives in #meta/template pages
        if (node.name === "FrontMatterCode") {
          const text = state.sliceDoc(node.from, node.to);
          try {
            if (/tags:.*meta\/template/s.exec(text)) {
              shouldRender = false;
              return;
            }
          } catch {
            // Ignore
          }
        }
        if (node.name === "Hashtag") {
          const text = state.sliceDoc(node.from, node.to);
          if (text.startsWith("#meta/template")) {
            shouldRender = false;
            return;
          }
        }

        if (node.name !== "LuaDirective") {
          return;
        }

        if (isCursorInRange(state, [node.from, node.to])) {
          return;
        }

        const hideSource = () => {
          if (client.ui.viewState.uiOptions.markdownSyntaxRendering) return;
          hideBlockSource(widgets, state, node.from, node.to, "start");
        };

        if (renderMode === "loading") {
          widgets.push(
            Decoration.widget({
              widget: new LoadingWidget(false),
            }).range(node.from),
          );
          hideSource();
          return;
        }

        const expressionText = directiveExpr(
          state.sliceDoc(node.from, node.to),
        );
        const currentPageMeta = client.currentPageMeta();
        widgets.push(
          Decoration.widget({
            widget: new LuaWidget({
              client,
              cacheKey: directiveCacheKey(
                expressionText,
                currentPageMeta?.name,
              ),
              expressionText,
              callback: (bodyText) =>
                renderLuaExpression(client, bodyText, currentPageMeta),
              host: {
                kind: "directive",
                wrappers: directiveWrappers(
                  node.node,
                  state,
                  client.currentName(),
                ),
              },
            }),
          }).range(node.from),
        );

        hideSource();
      },
    });

    if (!shouldRender) {
      return Decoration.set([]);
    }

    return Decoration.set(widgets, true);
  });
}
