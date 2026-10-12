// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { unbakeChange } from "../../baked_sections/regions.ts";
import type { Client } from "../../client.ts";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  bakedMenuEntries,
  bakedSectionPlugin,
  bakedSectionsInTree,
} from "./baked_section.ts";

type Deco = { from: number; to: number; spec: any };

function stateFor(doc: string, cursor = 0, extensions: any[] = []) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [buildExtendedMarkdownLanguage(), ...extensions],
  });
}

function decorationsFor(doc: string, cursor = 0) {
  const field = bakedSectionPlugin({} as Client);
  const state = stateFor(doc, cursor, [field]);
  const found: Deco[] = [];
  state.field(field).between(0, doc.length, (from, to, deco) => {
    found.push({ from, to, spec: deco.spec });
  });
  const lines = (d: Deco) => state.doc.lineAt(d.from).number;
  return {
    lineClasses: found
      .filter((d) => d.spec.class !== undefined)
      .map((d) => [lines(d), d.spec.class as string] as const)
      .sort((a, b) => a[0] - b[0]),
    replaced: found
      .filter((d) => d.from < d.to)
      .map((d) => [doc.slice(d.from, d.to), d.spec.widget !== undefined]),
  };
}

const opener = "<!--#lua query[[\n  from p = recentPages\n]] -->";
const baked = `Intro\n\n${opener}\n* [[A]]\n* [[B]]\n<!--/lua-->\n\nAfter\n`;

describe("baked section decorations", () => {
  test("finds sections from the syntax tree", () => {
    const [section, ...rest] = bakedSectionsInTree(stateFor(baked));
    expect(rest).toEqual([]);
    expect(section.expr).toBe("query[[\n  from p = recentPages\n]]");
    expect(baked.slice(section.start, section.end)).toBe(
      `${opener}\n* [[A]]\n* [[B]]\n<!--/lua-->`,
    );
  });

  test("ignores markers inside fenced code, and unclosed openers", () => {
    expect(
      bakedSectionsInTree(
        stateFor("```md\n<!--#lua 1 -->\nx\n<!--/lua-->\n```\n"),
      ),
    ).toEqual([]);
    expect(
      bakedSectionsInTree(stateFor("x\n<!--#lua 1 -->\nstill typing\n")),
    ).toEqual([]);
  });

  test("outside the section: a header and an end line replace the markers", () => {
    const { lineClasses, replaced } = decorationsFor(baked);
    // The end line keeps the closer's own line, so nothing below moves when
    // the cursor walks in and reveals it
    expect(replaced).toEqual([
      [opener, true],
      ["<!--/lua-->", true],
    ]);
    // No frame: the body is styled like any other Markdown
    expect(lineClasses).toEqual([]);
  });

  test("inside the section: raw markers", () => {
    const { lineClasses, replaced } = decorationsFor(
      baked,
      baked.indexOf("[[B]]"),
    );
    expect(replaced).toEqual([]);
    expect(lineClasses).toEqual([]);
  });
});

describe("baked section menu", () => {
  const ids = (readOnly: boolean) =>
    bakedMenuEntries(readOnly).flatMap((e) =>
      e.kind === "item" ? [e.id] : [],
    );

  test("offers every action on an editable page", () => {
    expect(ids(false)).toEqual(["update", "edit", "copy", "unbake"]);
  });

  test("only copies on a read-only page", () => {
    expect(ids(true)).toEqual(["copy"]);
  });
});

test("unbakeChange puts back the ${…} expression", () => {
  const [section] = bakedSectionsInTree(stateFor(baked));
  const { changes, selection } = unbakeChange(section);
  const out =
    baked.slice(0, changes.from) + changes.insert + baked.slice(changes.to);
  expect(out).toBe(
    "Intro\n\n${query[[\n  from p = recentPages\n]]}\n\nAfter\n",
  );
  expect(selection.anchor).toBe(changes.from + changes.insert.length);
});
