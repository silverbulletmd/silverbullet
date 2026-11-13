// @vitest-environment happy-dom

import { describe, expect, test } from "vitest";
import { marginPlacement, showsWholeLineRendering } from "./line_geometry.ts";

describe("line geometry", () => {
  test("the handle sits left of the line's first row, or not at all", () => {
    const row = { top: 60, bottom: 90 };
    expect(
      marginPlacement({ row, paintedLeft: 124, bound: 104, width: 10 }),
    ).toEqual({ left: 110, top: 60, height: 30 });
    // Left of a heading marker hanging into the padding
    expect(
      marginPlacement({ row, paintedLeft: 92, bound: 0, width: 10 }),
    ).toEqual({ left: 78, top: 60, height: 30 });
    // Too narrow: hidden, never moved elsewhere
    expect(
      marginPlacement({ row, paintedLeft: 12, bound: 0, width: 10 }),
    ).toBeUndefined();
  });

  test("an indented line goes by its first content, others by what is painted", () => {
    const row = { top: 0, bottom: 20 };
    // A nested item: the bullet is right of the painted indentation
    expect(
      marginPlacement({
        row,
        paintedLeft: 100,
        contentLeft: 140,
        bound: 0,
        width: 10,
      })?.left,
    ).toBe(126);
    // Not measured on the handle's row (or not indented): the painted left
    expect(
      marginPlacement({ row, paintedLeft: 100, bound: 0, width: 10 })?.left,
    ).toBe(86);
  });

  test("a line of inline widgets is text; a hidden source or a block directive is a whole-line rendering", () => {
    const line = (html: string) => {
      const el = document.createElement("div");
      el.className = "cm-line";
      el.innerHTML = html;
      return el;
    };
    // A lone wiki link
    expect(
      showsWholeLineRendering(
        line(
          '<img class="cm-widgetBuffer"><a contenteditable="false" class="sb-wiki-link">Some Page</a><img class="cm-widgetBuffer">',
        ),
      ),
    ).toBe(false);
    expect(showsWholeLineRendering(line("Plain <b>text</b>"))).toBe(false);
    // A rendered query: an uneditable block directive
    expect(
      showsWholeLineRendering(
        line(
          '<div contenteditable="false" class="sb-lua-directive-block"><table><tr><td>row</td></tr></table></div>',
        ),
      ),
    ).toBe(true);
    // A table's or embed's source, hidden beside its block widget
    expect(showsWholeLineRendering(line('<img class="cm-widgetBuffer">'))).toBe(
      true,
    );
    expect(showsWholeLineRendering(line(""))).toBe(true);
  });
});
