import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import { LuaWidget } from "./lua_widget.ts";
import {
  expandMarkdown,
  inlineContentFromURL,
} from "../markdown_renderer/inline.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import {
  nameFromTransclusion,
  parseTransclusion,
} from "@silverbulletmd/silverbullet/lib/transclusion";

export function inlineContentPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    if (!shouldRenderWidgets(client)) {
      // console.info("Not rendering widgets");
      return Decoration.set([]);
    }

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "Image") {
          return;
        }

        const text = state.sliceDoc(from, to);

        const transclusion = parseTransclusion(text);
        if (!transclusion) {
          return;
        }

        const renderingSyntax = client.ui.viewState.uiOptions
          .markdownSyntaxRendering;
        const cursorIsInRange = isCursorInRange(state, [from, to]);
        if (cursorIsInRange) {
          return;
        }
        if (!renderingSyntax && !cursorIsInRange) {
          widgets.push(invisibleDecoration.range(from, to));
        }

        widgets.push(
          Decoration.widget({
            widget: new LuaWidget(
              client,
              `widget:${client.currentPath()}:${text}`,
              text,
              text,
              async () => {
                const result = await inlineContentFromURL(
                  client.space,
                  transclusion,
                );
                const content = typeof result === "string"
                  ? {
                    markdown: renderToText(
                      await expandMarkdown(
                        client.space,
                        nameFromTransclusion(transclusion),
                        parseMarkdown(result),
                        client.clientSystem.spaceLuaEnv,
                      ),
                    ),
                  }
                  : { html: result };

                return {
                  _isWidget: true,
                  display: "block",
                  cssClasses: ["sb-inline-content"],
                  ...content,
                };
              },
              true,
              true,
            ),
            block: true,
          }).range(from),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
