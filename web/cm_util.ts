import diff, { DELETE, INSERT } from "fast-diff";
import type { Text } from "@codemirror/state";

type PlainChange = {
  from: number;
  to?: number;
  insert?: string | Text;
};

export function diffAndPrepareChanges(
  oldString: string,
  newString: string,
): PlainChange[] {
  // Use the fast-diff library to compute the changes
  const diffs = diff(oldString, newString);

  // Convert the diffs to CodeMirror transactions
  let startIndex = 0;
  const changes: PlainChange[] = [];
  for (const part of diffs) {
    if (part[0] === INSERT) {
      changes.push({ from: startIndex, insert: part[1] });
    } else if (part[0] === DELETE) {
      changes.push({ from: startIndex, to: startIndex + part[1].length });
    }
    startIndex += part[1].length;
  }
  return changes;
}

export function mergeChanges(
  left: PlainChange[],
  right: PlainChange[],
): PlainChange[] {
  const changes: PlainChange[] = [...left];

  // Rebase right side changes over the left side changes.
  for (const change of right) {
    let { from, to } = change;
    const changeSelectionLength = to !== undefined ? to - from : undefined;

    if (change.to !== undefined) {
      // Handle selections.
    } else {
      // Handle plain inserts.
      for (const leftChange of left) {
        // We only really need to shift if it starts before the insertion point.
        if (leftChange.from <= from) {
          if (leftChange.to !== undefined && leftChange.to >= from) {
            // The insertion is within the selection. In this case, we'll
            from = leftChange.from + (leftChange.to - leftChange.from);
          } else {
            // The insertion is outside of the selection. In this case, we'll
            // shift it backwards.
            from = from - leftChange.from;
          }
        }
      }
    }

    changes.push({ from, to, insert: change.insert });
  }

  return changes;
}
