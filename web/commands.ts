import {
  EditorSelection,
  type StateCommand,
  Transaction,
} from "@codemirror/state";
import { Text } from "@codemirror/state";

export function insertMarker(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const isBoldBefore =
        state.sliceDoc(range.from - marker.length, range.from) === marker;
      const isBoldAfter =
        state.sliceDoc(range.to, range.to + marker.length) === marker;
      const changes = [];

      changes.push(
        isBoldBefore
          ? {
            from: range.from - marker.length,
            to: range.from,
            insert: Text.of([""]),
          }
          : {
            from: range.from,
            insert: Text.of([marker]),
          },
      );

      changes.push(
        isBoldAfter
          ? {
            from: range.to,
            to: range.to + marker.length,
            insert: Text.of([""]),
          }
          : {
            from: range.to,
            insert: Text.of([marker]),
          },
      );

      const extendBefore = isBoldBefore ? -marker.length : marker.length;
      const extendAfter = isBoldAfter ? -marker.length : marker.length;

      return {
        changes,
        range: EditorSelection.range(
          range.from + extendBefore,
          range.to + extendAfter,
        ),
      };
    });

    dispatch(
      state.update(changes, {
        scrollIntoView: true,
        annotations: Transaction.userEvent.of("input"),
      }),
    );

    return true;
  };
}
