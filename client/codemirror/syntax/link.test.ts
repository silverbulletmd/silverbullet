import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { linkPlugin } from "./link.ts";

function previewHrefs(doc: string): string[] {
  const field = linkPlugin({
    currentName: () => "Folder/Current",
  } as Client);
  const state = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage, field],
  });
  const hrefs: string[] = [];
  state.field(field).between(0, doc.length, (_from, _to, deco) => {
    const href = deco.spec.attributes?.href;
    if (typeof href === "string") hrefs.push(href);
  });
  return hrefs;
}

test("live preview unwraps angle-bracket link destinations", () => {
  expect(
    previewHrefs(
      "see [title](<https://github.com/silverbulletmd/silverbullet>)",
    ),
  ).toEqual(["https://github.com/silverbulletmd/silverbullet"]);
  expect(
    previewHrefs("see [cite](<zotero://select/library/items/ABC>)"),
  ).toEqual(["zotero://select/library/items/ABC"]);
  expect(previewHrefs("see [notes](<My Page>)")).toEqual(["Folder/My Page"]);
  expect(previewHrefs("see [title](https://example.com)")).toEqual([
    "https://example.com",
  ]);
  expect(previewHrefs('see [title](<https://example.com/a> "docs")')).toEqual([
    "https://example.com/a",
  ]);
});
