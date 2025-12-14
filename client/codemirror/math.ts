import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
  shouldRenderWidgets,
} from "./util.ts";
import type { Client } from "../client.ts";
import katex from "katex";

class MathWidget extends WidgetType {
  constructor(
    readonly content: string,
    readonly displayMode: boolean,
    readonly client: Client,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement(this.displayMode ? "div" : "span");
    wrapper.className = this.displayMode ? "sb-math-block-widget" : "sb-math-inline-widget";
    
    try {
      katex.render(this.content, wrapper, {
        displayMode: this.displayMode,
        throwOnError: false,
        output: "html",
      });
    } catch (e: any) {
      wrapper.className = "sb-math-error";
      wrapper.textContent = this.content;
    }

    return wrapper;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof MathWidget &&
      other.content === this.content &&
      other.displayMode === this.displayMode;
  }
}

/**
 * Plugin that renders inline math ($...$) and block math ($$...$$) 
 * with KaTeX in the CodeMirror editor.
 */
export function mathPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];

    syntaxTree(state).iterate({
      enter: ({ type, from, to, node }) => {
        // Handle InlineMath ($...$)
        if (type.name === "InlineMath") {
          if (isCursorInRange(state, [from, to])) {
            return;
          }

          const text = state.sliceDoc(from, to);
          // Remove the $
          let content = text.slice(1, -1);

          // When block math has no blank line before it, $$...$$ can be misparsed as inline math
          const charBefore = from > 0 ? state.sliceDoc(from - 1, from) : "";
          if (charBefore === "$" && content.endsWith("$")) {
            content = content.slice(0, -1);

            if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
              widgets.push(
                Decoration.replace({
                  widget: new MathWidget(content, true, client),
                  block: true,
                }).range(from - 1, to),
              );
            }
          } else {
            // Regular inline math $...$
            if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
              widgets.push(invisibleDecoration.range(from, to));
              widgets.push(
                Decoration.widget({
                  widget: new MathWidget(content, false, client),
                }).range(to),
              );
            }
          }
        }

        // Handle BlockMath ($$...$$)
        if (type.name === "BlockMath") {
          if (isCursorInRange(state, [from, to])) {
            return;
          }

          // Extract BlockMathContent
          let content = "";
          node.toTree().iterate({
            enter: (innerNode) => {
              if (innerNode.name === "BlockMathContent") {
                content = state.sliceDoc(from + innerNode.from, from + innerNode.to);
              }
            },
          });

          if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
            widgets.push(
              Decoration.replace({
                widget: new MathWidget(content.trim(), true, client),
                block: true,
              }).range(from, to),
            );
          }
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
