import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { decoratorStateField } from "./util.ts";

const PREFIX_NODES = new Set(["ListMark", "QuoteMark", "TaskState"]);

// Wraps the line-leading whitespace + structural marker (bullet,
// blockquote `>`, task `[ ]`, ...) + optional trailing space in
// `sb-layout-prefix`, so the prefix can be styled separately from the
// rest of the line.
export function layoutPrefixPlugin() {
  return decoratorStateField((state) => {
    const widgets: Range<Decoration>[] = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (PREFIX_NODES.has(type.name)) {
          const prefix = layoutPrefixMark(state, from, to);
          if (prefix) widgets.push(prefix);
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}

function layoutPrefixMark(
  state: EditorState,
  markerFrom: number,
  markerTo: number,
): Range<Decoration> | undefined {
  const line = state.doc.lineAt(markerFrom);
  const hasTrailingSpace =
    markerTo < state.doc.length &&
    state.sliceDoc(markerTo, markerTo + 1) === " ";
  const prefixEnd = hasTrailingSpace ? markerTo + 1 : markerTo;
  if (line.from >= prefixEnd) return undefined;
  return Decoration.mark({
    class: "sb-layout-prefix",
  }).range(line.from, prefixEnd);
}
