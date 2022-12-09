// Forked from https://codeberg.org/retronav/ixora
// Original author: Pranav Karawale
// License: Apache License 2.0.

import { Decoration, syntaxTree, WidgetType } from "../deps.ts";
import { decoratorStateField, isCursorInRange } from "./util.ts";

const bulletListMarkerRE = /^[-+*]/;

export function listBulletPlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (isCursorInRange(state, [from, to])) return;
        if (type.name === "ListMark") {
          const listMark = state.sliceDoc(from, to);
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
  });
}

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
