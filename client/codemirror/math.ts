import type { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import { decoratorStateField, isCursorInRange } from "./util.ts";
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

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement(this.displayMode ? "div" : "span");
    wrapper.className = this.displayMode
      ? "sb-math-block-widget"
      : "sb-math-inline-widget";

    try {
      katex.render(this.content, wrapper, {
        displayMode: this.displayMode,
        throwOnError: false,
        output: "html",
      });
    } catch (_e: any) {
      wrapper.className = "sb-math-error";
      wrapper.textContent = this.content;
    }

    // Make MathWidget editable on click
    wrapper.addEventListener("click", () => {
      const pos = view.posAtDOM(wrapper);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    });

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
      enter: ({ type, from, to, node: _node }) => {
        // Handle InlineMath ($...$)
        if (type.name === "InlineMath") {
          if (isCursorInRange(state, [from, to])) {
            return;
          }

          const text = state.sliceDoc(from, to);
          // Remove the $
          const content = text.slice(1, -1);

          if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
            widgets.push(
              Decoration.replace({
                widget: new MathWidget(content, false, client),
              }).range(from, to),
            );
          }
        }

        // Handle BlockMath ($$...$$)
        if (type.name === "BlockMath" || type.name === "InlineBlockMath") {
          if (isCursorInRange(state, [from, to])) {
            return;
          }

          const text = state.sliceDoc(from, to);
          // Remove the $$
          const content = text.slice(2, -2);

          if (!client.ui.viewState.uiOptions.markdownSyntaxRendering) {
            widgets.push(
              Decoration.replace({
                widget: new MathWidget(content, true, client),
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
