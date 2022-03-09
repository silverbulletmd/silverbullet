import { StateEffect } from "@codemirror/state";

export const cursorEffect = StateEffect.define<{
  pos: number;
  userId: string;
  color: string;
}>({
  map({ pos, userId, color }, changes) {
    return { pos: changes.mapPos(pos), userId, color };
  },
});
