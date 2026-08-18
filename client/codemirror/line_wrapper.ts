import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { decoratorStateField } from "./util.ts";

interface WrapElement {
  selector: string;
  class: string;
  nesting?: boolean;
}

export function lineWrapper(wrapElements: WrapElement[]) {
  return decoratorStateField((state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    const depths = new Map<string, number>();
    const doc = state.doc;
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        for (const wrapElement of wrapElements) {
          if (type.name !== wrapElement.selector) {
            continue;
          }
          let cls = wrapElement.class;
          if (wrapElement.nesting) {
            const depth = (depths.get(wrapElement.selector) ?? 0) + 1;
            depths.set(wrapElement.selector, depth);
            cls = `${cls} ${cls}-${depth}`;
          }
          const bodyText = doc.sliceString(from, to);
          let idx = from;
          for (const line of bodyText.split("\n")) {
            widgets.push(
              Decoration.line({ class: cls }).range(doc.lineAt(idx).from),
            );
            idx += line.length + 1;
          }
        }
      },
      leave({ type }) {
        for (const wrapElement of wrapElements) {
          if (type.name === wrapElement.selector && wrapElement.nesting) {
            depths.set(
              wrapElement.selector,
              (depths.get(wrapElement.selector) ?? 1) - 1,
            );
          }
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
