// @vitest-environment happy-dom

import { EditorState, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import { System } from "../system.ts";
import { editorSyscalls } from "./editor.ts";

function posAtDOMFor(client: Partial<Client>) {
  const system = new System();
  system.registerSyscalls([], editorSyscalls(client as Client));
  return (node: unknown) => system.localSyscall("editor.posAtDOM", [node]);
}

test("editor.posAtDOM tracks widgets moved by edits", async () => {
  let drawn = 0;
  class EmbedWidget extends WidgetType {
    toDOM(): HTMLElement {
      drawn++;
      const div = document.createElement("div");
      div.className = "embed";
      return div;
    }
  }
  const doc = "Intro\n![[a.png]]\n![[a.png]]\n";
  const first = doc.indexOf("![[a.png]]");
  const second = doc.lastIndexOf("![[a.png]]");
  // Mapped, not rebuilt, like embeds outside the edited block
  const embeds = StateField.define({
    create: () =>
      Decoration.set([
        Decoration.widget({ widget: new EmbedWidget(), block: true }).range(
          first,
        ),
        Decoration.widget({ widget: new EmbedWidget(), block: true }).range(
          second,
        ),
      ]),
    update: (value, tr) => value.map(tr.changes),
    provide: (f) => EditorView.decorations.from(f),
  });
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [embeds] }),
  });
  const posAt = posAtDOMFor({ editorView: view });
  try {
    const [a, b] = view.contentDOM.querySelectorAll<HTMLElement>(".embed");
    await expect(posAt(a)).resolves.toBe(first);
    await expect(posAt(b)).resolves.toBe(second);

    view.dispatch({ changes: { from: 0, insert: "More text\n" } });
    const text = view.state.doc.toString();
    await expect(posAt(a)).resolves.toBe(text.indexOf("![[a.png]]"));
    await expect(posAt(b)).resolves.toBe(text.lastIndexOf("![[a.png]]"));
    expect(drawn).toBe(2);

    await expect(posAt(document.createElement("div"))).resolves.toBe(undefined);
    await expect(posAt("not a node")).resolves.toBe(undefined);
  } finally {
    view.destroy();
  }
});

test("editor.posAtDOM returns undefined during boot", async () => {
  const posAt = posAtDOMFor({});
  await expect(posAt(document.createElement("div"))).resolves.toBe(undefined);
});
