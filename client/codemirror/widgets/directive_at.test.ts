import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { directiveAt } from "./directive_at.ts";

function state(doc: string) {
  const s = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

test("finds the ${…} around or right next to the cursor", () => {
  const doc = 'Open: ${#query[[from index.tag "task"]]} items';
  const s = state(doc);
  const inside = doc.indexOf("#query");
  const expected = {
    from: 6,
    to: doc.indexOf(" items"),
    expr: '#query[[from index.tag "task"]]',
  };
  expect(directiveAt(s, inside)).toEqual(expected);
  expect(directiveAt(s, doc.indexOf(" items"))?.expr).toBe(expected.expr);
  expect(directiveAt(s, 2)).toBeUndefined();
});
