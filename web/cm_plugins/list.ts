// LISTS

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "../deps.ts";
import { isCursorInRange, iterateTreeInVisibleRanges } from "./util.ts";

const bulletListMarkerRE = /^[-+*]/;

/**
 * Plugin to add custom list bullet mark.
 */
class ListBulletPlugin {
  decorations: DecorationSet = Decoration.none;
  constructor(view: EditorView) {
    this.decorations = this.decorateLists(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.decorateLists(update.view);
    }
  }
  private decorateLists(view: EditorView) {
    const widgets: any[] = [];
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to }) => {
        if (isCursorInRange(view.state, [from, to])) return;
        if (type.name === "ListMark") {
          const listMark = view.state.sliceDoc(from, to);
          if (bulletListMarkerRE.test(listMark)) {
            const dec = Decoration.replace({
              widget: new ListBulletWidget(listMark),
            });
            widgets.push(dec.range(from, to));
          }
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}
export const listBulletPlugin = ViewPlugin.fromClass(ListBulletPlugin, {
  decorations: (v) => v.decorations,
});

/**
 * Widget to render list bullet mark.
 */
class ListBulletWidget extends WidgetType {
  constructor(readonly bullet: string) {
    super();
  }
  toDOM(): HTMLElement {
    const listBullet = document.createElement("span");
    listBullet.textContent = this.bullet;
    listBullet.className = "cm-list-bullet";
    return listBullet;
  }
}
