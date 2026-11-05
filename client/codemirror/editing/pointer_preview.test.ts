import { EditorState, StateEffect } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { expect, test } from "vitest";
import { decoratorStateField } from "../util.ts";
import { pointerPreview, pointerPreviewHeld } from "./pointer_preview.ts";

test("explicit preview effects are delivered while cursor movement is settling", () => {
  const refresh = StateEffect.define<null>();
  const decorations = decoratorStateField((_state, tr) =>
    Decoration.set([
      Decoration.mark({
        class: tr?.effects.some((effect) => effect.is(refresh))
          ? "refreshed"
          : "initial",
      }).range(0, 1),
    ]),
  );
  let state = EditorState.create({
    doc: "abc",
    extensions: [pointerPreview, decorations],
  });
  state = state.update({ selection: { anchor: 2 }, userEvent: "select" }).state;
  expect(state.field(pointerPreviewHeld)).toBe(true);
  state = state.update({ effects: refresh.of(null) }).state;
  expect(state.field(decorations).iter().value?.spec.class).toBe("refreshed");
});
