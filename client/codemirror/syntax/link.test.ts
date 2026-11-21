import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { linkPlugin } from "./link.ts";

test.each([
  ["https://example.com", "https://example.com"],
  ["<https://example.com>", "https://example.com"],
  [
    "<zotero://select/library/items/ABC123>",
    "zotero://select/library/items/ABC123",
  ],
  ["<Local note>", "Notes/Local note"],
  ["<../Local note>", "Local note"],
])("live preview uses the destination of %s", (destination, expected) => {
  const plugin = linkPlugin({ currentName: () => "Notes/Source" } as Client);
  const state = EditorState.create({
    doc: `\n[link](${destination})`,
    extensions: [extendedMarkdownLanguage, plugin],
  });
  const links: string[] = [];
  state.field(plugin).between(0, state.doc.length, (_from, _to, decoration) => {
    if (decoration.spec.tagName === "a") {
      links.push(decoration.spec.attributes.href);
    }
  });
  expect(links).toEqual([expected]);
});
