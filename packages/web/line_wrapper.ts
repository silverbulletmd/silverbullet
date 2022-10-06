import { syntaxTree } from "../../mod.ts";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "../../mod.ts";

import { Range } from "../../mod.ts";

interface WrapElement {
  selector: string;
  class: string;
  nesting?: boolean;
}

function wrapLines(view: EditorView, wrapElements: WrapElement[]) {
  let widgets: Range<Decoration>[] = [];
  let elementStack: string[] = [];
  const doc = view.state.doc;
  // Disabling the visible ranges for now, because it may be a bit buggy.
  // RISK: this may actually become slow for large documents.
  for (let { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: ({ type, from, to }) => {
        for (let wrapElement of wrapElements) {
          if (type.name == wrapElement.selector) {
            if (wrapElement.nesting) {
              elementStack.push(type.name);
            }
            const bodyText = doc.sliceString(from, to);
            let idx = from;
            for (let line of bodyText.split("\n")) {
              let cls = wrapElement.class;
              if (wrapElement.nesting) {
                cls = `${cls} ${cls}-${elementStack.length}`;
              }
              widgets.push(
                Decoration.line({
                  class: cls,
                }).range(doc.lineAt(idx).from),
              );
              idx += line.length + 1;
            }
          }
        }
      },
      leave({ type }) {
        for (let wrapElement of wrapElements) {
          if (type.name == wrapElement.selector && wrapElement.nesting) {
            elementStack.pop();
          }
        }
      },
    });
  }
  // Widgets have to be sorted by `from` in ascending order
  widgets = widgets.sort((a, b) => {
    return a.from < b.from ? -1 : 1;
  });
  return Decoration.set(widgets);
}

export const lineWrapper = (wrapElements: WrapElement[]) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = wrapLines(view, wrapElements);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = wrapLines(update.view, wrapElements);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
