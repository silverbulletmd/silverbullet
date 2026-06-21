import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
  widgetRenderMode,
} from "./util.ts";
import type { Client } from "../client.ts";
import { renderLuaExpression } from "../space_lua/render_widget.ts";
import { LuaWidget } from "./lua_widget.ts";
import { LoadingWidget } from "./loading_widget.ts";

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
        // Either in frontmatter
        if (node.name === "FrontMatterCode") {
          const text = state.sliceDoc(node.from, node.to);
          try {
            // Very ad-hoc regex to detect if meta/template appears in the tag list
            if (/tags:.*meta\/template/s.exec(text)) {
              shouldRender = false;
              return;
            }
          } catch {
            // Ignore
          }
        }
        // Or with a hash tag
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

        const codeText = state.sliceDoc(node.from, node.to);
        const expressionText = codeText.slice(2, -1);
        const currentPageMeta = client.currentPageMeta();
        widgets.push(
          Decoration.widget({
            widget: new LuaWidget({
              client,
              cacheKey: `lua:${expressionText}:${currentPageMeta?.name}`,
              expressionText,
              codeText,
              callback: (bodyText) =>
                renderLuaExpression(client, bodyText, currentPageMeta),
              renderEmpty: true,
              inPage: true,
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
