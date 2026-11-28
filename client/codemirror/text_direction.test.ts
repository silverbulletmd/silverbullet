// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { textDirection } from "./text_direction.ts";

function editor(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [textDirection()] }),
  });
}

test("every rendered line picks its own text direction", () => {
  const view = editor("# مرحبا بالعالم\nHello world\n- عنصر في القائمة\n");
  const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
  expect(lines).toHaveLength(4);
  for (const line of lines) {
    expect(line.getAttribute("dir")).toBe("auto");
  }
  expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true);
  view.destroy();
});

test("lines added later get a direction too", () => {
  const view = editor("Hello");
  view.dispatch({ changes: { from: 5, insert: "\nשלום\nسلام" } });
  const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
  expect(lines).toHaveLength(3);
  expect(lines.every((line) => line.getAttribute("dir") === "auto")).toBe(true);
  view.destroy();
});
