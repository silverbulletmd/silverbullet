// Gives every line its own text direction, so right-to-left scripts such as
// Arabic, Hebrew or Persian read and align correctly next to left-to-right
// text on the same page.
//
// Each rendered line gets `dir="auto"`: the browser picks the direction from
// the first strong character of the line, skipping markup like `#`, `-` or
// `>`. CodeMirror then reads that direction per line (perLineTextDirection),
// so cursor movement, selection and bidi-aware keys follow it too.
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

const autoDirection = Decoration.line({ attributes: { dir: "auto" } });

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);
    while (true) {
      // Visible ranges may share a line at their edges
      if (line.number > lastLine) {
        builder.add(line.from, line.from, autoDirection);
        lastLine = line.number;
      }
      if (line.to >= to || line.number === doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const autoDirectionPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function textDirection(): Extension {
  return [EditorView.perLineTextDirection.of(true), autoDirectionPlugin];
}
