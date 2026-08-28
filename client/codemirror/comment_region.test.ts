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
    expect(lineClasses.filter((c) => c.includes("-first"))).toHaveLength(1);
    expect(lineClasses.filter((c) => c.includes("-last"))).toHaveLength(1);
    expect(lineClasses[0]).toContain("sb-comment-block-first");
    expect(lineClasses.slice(1, -1).join(" ")).not.toContain(
      "sb-comment-block-first",
    );
    expect(lineClasses.slice(1, -1).join(" ")).not.toContain(
      "sb-comment-block-last",
    );
    expect(lineClasses.at(-1)).toContain("sb-comment-block-last");
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

  test("hides delimiters indented into a list item", () => {
    const doc = "* one\n  <!--\n  > one\n\n\n  -->\n* two\n";
    const { replaced, widgets } = decorationsFor(doc);
    expect(replaced).toEqual(["<!--", "-->"]);
    // The `comment` label standing in for the hidden `<!--`, and Resolve.
    expect(widgets).toHaveLength(2);
  });

  test("an indented one-liner inside a list item keeps its markers", () => {
    // The opener fails the "reaches the line end" half of markerOwnsLine
    // (the closer shares its line), and the closer fails the whitespace
    // half (the opener and text share its line) — so neither hides.
    const doc = "* item\n  <!-- note -->\n";
    const { replaced, widgets } = decorationsFor(doc);
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
  const editorCss = sass.compileString(
    readFileSync("client/styles/editor.scss", "utf-8"),
    { loadPaths: ["client/styles"], style: "expanded" },
  ).css;
  const colorsCss = sass.compileString(
    readFileSync("client/styles/colors.scss", "utf-8"),
    { loadPaths: ["client/styles"], style: "expanded" },
  ).css;

  test("the region has no horizontal gutter of its own", () => {
    const rule = editorCss.match(/\.sb-comment-block \{[^}]*\}/)?.[0] ?? "";
    // A hairline, not the two-column indent the region used to carry.
    expect(rule).toMatch(/border-left-width:\s*1px/);
    // The bar was painted as a background gradient over the border box.
    expect(rule).not.toMatch(/linear-gradient/);
    // The box reaches outward and gives those pixels straight back, so the
    // region adds no net indent: a negative margin alone drags the content
    // with the border, leaving comment text left of the text around it. The
    // hairline is drawn *within* the inset, so it is the border and padding
    // together that have to add back up to it — padding the full inset would
    // push every line in the region a border-width right of its surroundings.
    const inset = Number(rule.match(/margin-left:\s*-(\d+)px/)?.[1]);
    const border = Number(rule.match(/border-left-width:\s*(\d+)px/)?.[1]);
    expect(inset).toBeGreaterThan(0);
    expect(border).toBeGreaterThan(0);
    expect(rule).toMatch(new RegExp(`margin-right:\\s*-${inset}px`));
    expect(rule).toMatch(
      new RegExp(
        `padding-left:\\s*calc\\(var\\(--sb-indent\\) \\+ ${
          inset - border
        }px\\)`,
      ),
    );
    expect(rule).toMatch(new RegExp(`padding-right:\\s*${inset - border}px`));
    // A `border-left` shorthand would also set a colour, outranking the
    // `.sb-admonition` colour in colors.scss on a line carrying both.
    expect(rule).not.toMatch(/border-left:/);
  });

  test("the box closes at the first and last line of the region", () => {
    expect(editorCss).toMatch(
      /\.sb-comment-block-first \{[^}]*border-top-width:\s*1px/,
    );
    expect(editorCss).toMatch(
      /\.sb-comment-block-last \{[^}]*border-bottom-width:\s*1px/,
    );
  });

  test("the combined comment/quote gutter override is gone", () => {
    expect(editorCss).not.toMatch(/\.sb-comment-block\.sb-line-blockquote/);
  });

  test("the border colour is pinned, not left to currentColor", () => {
    // The colourless longhands would otherwise inherit `currentColor` and
    // paint a text-coloured hairline.
    const rule = colorsCss.match(/\.sb-comment-block \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/border-left-color:/);
    expect(rule).toMatch(/border-right-color:/);
    expect(rule).toMatch(/border-top-color:/);
    expect(rule).toMatch(/border-bottom-color:/);
    expect(rule).not.toMatch(/transparent/);
  });

  test("an admonition inside a comment keeps its own accent bar", () => {
    // Both rules set border-left-color on the same line; the later one wins.
    expect(colorsCss.indexOf(".sb-admonition {")).toBeGreaterThan(
      colorsCss.indexOf(".sb-comment-block {"),
    );
  });
});
