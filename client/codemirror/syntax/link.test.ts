import { EditorSelection, EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { linkPlugin } from "./link.ts";

type Deco = { from: number; to: number; href?: string };

function decorations(doc: string): Deco[] {
  const plugin = linkPlugin({ currentName: () => "Notes" } as Client);
  const state = EditorState.create({
    doc: `${doc}\n`,
    // Keep the cursor off the link, so it renders
    selection: EditorSelection.cursor(doc.length + 1),
    extensions: [extendedMarkdownLanguage, plugin],
  });
  const out: Deco[] = [];
  (state.field(plugin) as DecorationSet).between(
    0,
    doc.length,
    (from, to, d) => {
      out.push({ from, to, href: d.spec.attributes?.href });
    },
  );
  return out;
}

test("a link around an image marks the whole image with the link target", () => {
  const doc = "[![Report|300](/preview.png)](/Report.pdf)";
  const imageEnd = doc.indexOf("](/Report");
  expect(decorations(doc)).toEqual([
    { from: 0, to: 1, href: undefined },
    { from: 1, to: imageEnd, href: "Report.pdf" },
    { from: imageEnd, to: doc.length, href: undefined },
  ]);
});

test("plain links keep their mark and hidden syntax", () => {
  expect(decorations("[text](Page.md)")).toEqual([
    { from: 0, to: 1, href: undefined },
    { from: 1, to: 5, href: "Page.md" },
    { from: 5, to: 15, href: undefined },
  ]);
  expect(decorations(String.raw`[a \] b](https://example.com)`)).toEqual([
    { from: 0, to: 1, href: undefined },
    { from: 1, to: 7, href: "https://example.com" },
    { from: 7, to: 29, href: undefined },
  ]);
  expect(decorations("[a](url(x).md)")[1]).toEqual({
    from: 1,
    to: 2,
    href: "url(x).md",
  });
});

test("a link with empty text gets no live preview", () => {
  expect(decorations("[](Page.md)")).toEqual([]);
});
