import diff, { DELETE, INSERT } from "fast-diff";
import type { ChangeSpec } from "@codemirror/state";

export function diffAndPrepareChanges(
  oldString: string,
  newString: string,
): ChangeSpec[] {
  // Use the fast-diff library to compute the changes
  const diffs = diff(oldString, newString);

  // Convert the diffs to CodeMirror transactions
  let startIndex = 0;
  const changes: ChangeSpec[] = [];
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
