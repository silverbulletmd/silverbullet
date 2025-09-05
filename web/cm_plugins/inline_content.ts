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
import { inlineContentFromURL, parseTransclusion } from "../markdown/inline.ts";

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

        if (!isCursorInRange(state, [from, to])) {
          widgets.push(invisibleDecoration.range(from, to));
        }

        widgets.push(
          Decoration.widget({
            widget: new LuaWidget(
              client,
              `widget:${client.currentPath()}:${text}`,
              text,
              async () => {
                const result = await inlineContentFromURL(
                  client,
                  transclusion.url,
                  transclusion.alias,
                  transclusion.dimension,
                  transclusion.linktype !== "wikilink",
                );
                const content = typeof result === "string"
                  ? { markdown: result }
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
          }).range(to + 1),
        );
      },
    });

    return Decoration.set(widgets, true);
  });
}
