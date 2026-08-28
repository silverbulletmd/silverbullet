import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import * as sass from "sass";
import { expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { blockquotePlugin } from "./block_quote.ts";

/**
 * The columns each quoted line contributes, as `[indent, barOffset]` pairs —
 * read back from the declarations rather than the raw style string, so the
 * cases below state what a line reserves rather than how it is spelled.
 */
function lineColumnsFor(doc: string): [number, number][] {
  const field = blockquotePlugin();
  const state = EditorState.create({
    doc,
    // Cursor parked outside every quote so no marker is revealed.
    selection: { anchor: doc.length },
    extensions: [buildExtendedMarkdownLanguage(), field],
  });
  const columns = (style: string, name: string) => {
    const found = new RegExp(
      `${name}:calc\\((\\d+) \\* var\\(--editor-column\\)\\)`,
    ).exec(style);
    if (!found) throw new Error(`${name} missing from ${style}`);
    return Number(found[1]);
  };
  const out: [number, number][] = [];
  state.field(field).between(0, doc.length, (_from, _to, deco) => {
    const style = (deco.spec as any).attributes?.style;
    if (style) {
      out.push([
        columns(style, "--sb-quote-indent"),
        columns(style, "--sb-quote-bar-offset"),
      ]);
    }
  });
  return out;
}

test("a quoted line reserves the columns its markers occupy", () => {
  expect(lineColumnsFor("> one\n\nafter\n")).toEqual([[2, 0]]);
});

test("a nested quote reserves both levels", () => {
  expect(lineColumnsFor("> > one\n\nafter\n")).toEqual([[4, 0]]);
});

test("a marker without its trailing space reserves one column", () => {
  expect(lineColumnsFor(">one\n\nafter\n")).toEqual([[1, 0]]);
});

test("a lazy continuation reserves the markers it did not write", () => {
  // The stand-in spacer sits at the line start, so the bar starts there too.
  expect(lineColumnsFor("> one\ntwo\n\nafter\n")).toEqual([
    [2, 0],
    [2, 0],
  ]);
});

test("a quote nested in a list reserves only its own markers", () => {
  // The two leading spaces are the list item's indent, which listIndentPlugin
  // reserves; counting them here too would over-indent the wrapped rows. They
  // do count as bar offset, because the `>` starts two columns in.
  expect(lineColumnsFor("* a\n  > q\n\nafter\n")).toEqual([[2, 2]]);
});

test("a list nested in a quote puts the bar at the line start", () => {
  // The mirror case: here the `>` comes first and the item's marker follows,
  // so the bar offset is zero even though the line carries a list indent.
  expect(lineColumnsFor("> * q\n\nafter\n")).toEqual([[2, 0]]);
});

test("an admonition overrides the inline quote indent this plugin sets", () => {
  // Decoration.line writes --sb-quote-indent inline; only an important
  // declaration can give those columns back to a line the border speaks for.
  const css = sass.compileString(
    readFileSync("client/styles/editor.scss", "utf-8"),
    { loadPaths: ["client/styles"], style: "expanded" },
  ).css;
  const rule = css.match(/\.sb-admonition \{[^}]*\}/)?.[0] ?? "";
  expect(rule).toMatch(/--sb-quote-indent:\s*0px\s*!important/);
});
