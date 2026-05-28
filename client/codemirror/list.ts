// Forked from https://codeberg.org/retronav/ixora
// Original author: Pranav Karawale
// License: Apache License 2.0.

import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { decoratorStateField, isCursorInRange } from "./util.ts";

const bulletListMarkerRE = /^[-+*]/;

export function listBulletPlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name === "ListMark") {
          if (isCursorInRange(state, [from, to])) {
            // Cursor is in the list mark
            widgets.push(
              Decoration.mark({
                class: "sb-li-cursor",
              }).range(from, to),
            );
          } else {
            // Cursor is outside the list mark, render as a (silver) bullet
            const listMark = state.sliceDoc(from, to);
            if (bulletListMarkerRE.test(listMark)) {
              const dec = Decoration.replace({
                widget: new ListBulletWidget(),
              });
              widgets.push(dec.range(from, to));
            } else {
              // Ordered list, no special rendering
              widgets.push(
                Decoration.mark({
                  class: "sb-li-cursor",
                }).range(from, to),
              );
            }
          }
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}

/**
 * Widget that renders the bullet glyph (`•`) inline at the source position of
 * the markdown list marker (`*`, `-`, `+`). Uses no positioning tricks — the
 * widget sits exactly where the source char would, so nested-list bullets
 * step right naturally with their leading whitespace.
 */
class ListBulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const listBullet = document.createElement("span");
    listBullet.textContent = "•"; // U+2022 BULLET
    listBullet.className = "cm-list-bullet";
    return listBullet;
  }
}
