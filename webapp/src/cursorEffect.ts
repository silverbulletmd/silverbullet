import { StateEffect } from "@codemirror/state";
export type Cursor = {
  pos: number;
  userId: string;
  color: string;
};

export const cursorEffect = StateEffect.define<Cursor>({
  map({ pos, userId, color }, changes) {
    return { pos: changes.mapPos(pos), userId, color };
  },
});
