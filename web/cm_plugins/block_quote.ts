import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";

function decorateBlockQuote(state: EditorState) {
  const widgets: any[] = [];
  syntaxTree(state).iterate({
    enter: ({ type, from, to }) => {
      if (isCursorInRange(state, [from, to])) return;
      if (type.name === "QuoteMark") {
        widgets.push(invisibleDecoration.range(from, to));
        widgets.push(
          Decoration.line({ class: "sb-blockquote-outside" }).range(from),
        );
      }
    },
  });
  return Decoration.set(widgets, true);
}

export function blockquotePlugin() {
  return decoratorStateField(decorateBlockQuote);
}
