import { expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { atMentionPlugin } from "./at_mention.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";

function pillCount(doc: string): number {
  const plugin = atMentionPlugin();
  const state = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage, plugin],
  });
  return (state.field(plugin) as DecorationSet).size;
}

test("recipient mention gets a pill, signature-nested mention does not", () => {
  // one ordinary mention -> one pill
  expect(pillCount("Ask @ada please")).toBe(1);
  // a signature: @zef is nested in AtMentionSignature -> NO pill
  expect(pillCount("Because reasons -- @zef")).toBe(0);
});
