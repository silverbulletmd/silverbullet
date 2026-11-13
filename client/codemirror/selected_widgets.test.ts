import { EditorSelection } from "@codemirror/state";
import { expect, test } from "vitest";
import { insideSelection } from "./selected_widgets.ts";

test("a widget counts as selected only inside a non-empty range", () => {
  const sel = EditorSelection.create([
    EditorSelection.range(0, 10),
    EditorSelection.cursor(15),
  ]);
  expect(insideSelection(sel, 2, 8)).toBe(true);
  expect(insideSelection(sel, 8, 12)).toBe(false);
  expect(insideSelection(sel, 15, 15)).toBe(false);
});
