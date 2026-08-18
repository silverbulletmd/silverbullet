import { readFileSync } from "node:fs";
import { EditorState } from "@codemirror/state";
import * as sass from "sass";
import { describe, expect, test } from "vitest";
import type { Client } from "../client.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { commentRegionPlugin, resolveRange } from "./comment_region.ts";

type Deco = { from: number; to: number; spec: any };

function stateFor(doc: string, cursor = 0, extensions: any[] = []) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [buildExtendedMarkdownLanguage(), ...extensions],
  });
}

function decorationsFor(doc: string, cursor = 0) {
  const field = commentRegionPlugin({} as Client);
  const state = stateFor(doc, cursor, [field]);
  const found: Deco[] = [];
  state.field(field).between(0, doc.length, (from, to, deco) => {
    found.push({ from, to, spec: deco.spec });
  });
  return {
    lineClasses: found
      .filter((d) => d.spec.class !== undefined)
      .map((d) => d.spec.class as string),
    replaced: found
      .filter((d) => d.from < d.to && d.spec.widget === undefined)
      .map((d) => doc.slice(d.from, d.to)),
    widgets: found.filter((d) => d.spec.widget !== undefined),
  };
}

function applyResolve(doc: string) {
  const state = stateFor(doc);
  const range: [number, number] = [doc.indexOf("<!--"), doc.indexOf("-->") + 3];
  const { from, to } = resolveRange(state, range);
  return doc.slice(0, from) + doc.slice(to);
}

const closedComment = `Before.

<!--

* [ ] Hello

-->

After.
`;

describe("comment region decorations", () => {
  test("hides delimiters that own their line and offers Resolve", () => {
    const { lineClasses, replaced, widgets } = decorationsFor(closedComment);
    expect(replaced).toEqual(["<!--", "-->"]);
    // The `comment` label standing in for the hidden `<!--`, and Resolve.
    expect(widgets).toHaveLength(2);
    expect(lineClasses).toHaveLength(5);
  });

  test("reveals delimiters while the cursor is inside", () => {
    const { replaced, widgets } = decorationsFor(
      closedComment,
      closedComment.indexOf("Hello"),
    );
    expect(replaced).toEqual([]);
    // Resolve stays put while the markers are revealed: it floats, so it needs
    // no per-state class and does not move with them.
    expect(widgets).toHaveLength(1);
  });

  test("an unclosed comment hides nothing and offers no Resolve", () => {
    const doc = "Before.\n\n<!--\n\nStill typing\n";
    const { lineClasses, replaced, widgets } = decorationsFor(doc);
    // The cursor sits before the block, so a closed comment here would have
    // hidden its delimiters; an unclosed one must keep the `<!--` visible.
    expect(decorationsFor(`${doc}\n-->\n`).replaced).toEqual(["<!--", "-->"]);
    expect(replaced).toEqual([]);
    expect(widgets).toEqual([]);
    expect(lineClasses.length).toBeGreaterThan(0);
  });

  test("keeps inline delimiters of a one-liner visible, without Resolve", () => {
    // Prefixed so the comment does not start at offset 0, where the cursor
    // would overlap it and suppress every replacement anyway.
    const { replaced, widgets } = decorationsFor(
      "Before.\n<!-- TODO: fix this -->\n",
    );
    expect(replaced).toEqual([]);
    expect(widgets).toEqual([]);
  });

  test("leaves marker comments alone", () => {
    const { lineClasses, replaced, widgets } = decorationsFor(
      "Before.\n<!--#lua x -->\nhi\n<!--/lua-->\n",
    );
    expect(lineClasses).toEqual([]);
    expect(replaced).toEqual([]);
    expect(widgets).toEqual([]);
  });
});

describe("resolveRange", () => {
  test("removes the block's own lines and nothing of its neighbours", () => {
    // Both blank lines are separators the author wrote, one on each side of
    // the block, so both survive.
    expect(applyResolve(closedComment)).toBe("Before.\n\n\nAfter.\n");
  });

  test("removes a tightly packed block", () => {
    expect(applyResolve("Before.\n<!--\nx\n-->\nAfter.\n")).toBe(
      "Before.\nAfter.\n",
    );
  });

  test("leaves no blank line when the block starts the document", () => {
    expect(applyResolve("<!--\nx\n-->\nAfter.\n")).toBe("After.\n");
  });

  test("clamps at the end of the document", () => {
    expect(applyResolve("Before.\n<!--\nx\n-->")).toBe("Before.\n");
  });
});

describe("comment region styling", () => {
  test("indents with a border so list padding composes instead of losing", () => {
    const scss = readFileSync("client/styles/editor.scss", "utf-8");
    const css = sass.compileString(scss, {
      loadPaths: ["client/styles"],
      style: "expanded",
    }).css;
    const rule = css.match(/\.sb-comment-block \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/border-left-width:\s*var\(--blockquote-step\)/);
    expect(rule).toMatch(/border-left-style:\s*solid/);
    // listIndentPlugin sets `padding-left` inline on every list line inside the
    // comment, and inline styles win: the region indent must not use it.
    expect(rule).not.toMatch(/padding-left/);
    // An inset box-shadow would be clipped to the padding box, i.e. drawn
    // a step in rather than at the region's edge.
    expect(rule).not.toMatch(/box-shadow/);
    // A `border-left` shorthand would also set a colour, outranking the
    // `.sb-admonition` colour in colors.scss on a line carrying both.
    expect(rule).not.toMatch(/border-left:/);
  });

  test("the transparent border colour is pinned, not left to currentColor", () => {
    // Both region indents are colourless longhands, so without an explicit
    // colour they would inherit `currentColor` and paint a solid text-coloured
    // slab a step wide.
    const css = sass.compileString(
      readFileSync("client/styles/colors.scss", "utf-8"),
      { loadPaths: ["client/styles"], style: "expanded" },
    ).css;
    // Only the comment region still carries a border; a quote's indent is the
    // marker spacer in the text flow.
    const rule = css.match(/\.sb-comment-block \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/border-left-color:\s*transparent/);
  });
});
