import diff, { DELETE, EQUAL, INSERT } from "fast-diff";
import type { ChangeSpec } from "@codemirror/state";

export function diffAndPrepareChanges(
  oldString: string,
  newString: string,
): ChangeSpec[] {
  const diffs = alignToLineStarts(diff(oldString, newString));

  let startIndex = 0;
  const changes: ChangeSpec[] = [];
  for (const part of diffs) {
    if (part[0] === INSERT) {
      changes.push({ from: startIndex, insert: part[1] });
    } else if (part[0] === EQUAL) {
      startIndex += part[1].length;
    } else if (part[0] === DELETE) {
      changes.push({ from: startIndex, to: startIndex + part[1].length });
      startIndex += part[1].length;
    }
  }
  return changes;
}

type Diff = [number, string];

/**
 * fast-diff places a pure insertion or deletion at an arbitrary one of its
 * equivalent positions, often splitting a whole-line edit across two lines
 * (`foo\n* [ ] ` instead of `* [ ] foo\n`). Slide each one to where it
 * starts and ends on line starts, the shape the line-based merge and the
 * external-presence hunks expect.
 */
function alignToLineStarts(raw: Diff[]): Diff[] {
  const diffs: Diff[] = [[EQUAL, ""], ...raw, [EQUAL, ""]];
  for (let i = 0; i < diffs.length; i++) {
    const [op, edit] = diffs[i];
    if (op === EQUAL) continue;
    const prev = diffs[i - 1];
    const next = diffs[i + 1];
    if (prev[0] !== EQUAL || next[0] !== EQUAL) continue;

    const left = prev[1];
    const text = left + edit + next[1];
    const len = edit.length;
    const score = (at: number) =>
      (at === 0 || text[at - 1] === "\n" ? 1 : 0) +
      (at + len === text.length || text[at + len - 1] === "\n" ? 1 : 0);

    let from = left.length;
    while (from > 0 && text[from - 1] === text[from + len - 1]) from--;
    let best = left.length;
    for (let at = from; ; at++) {
      if (score(at) > score(best)) best = at;
      if (at + len >= text.length || text[at] !== text[at + len]) break;
    }
    if (best === left.length) continue;

    prev[1] = text.slice(0, best);
    diffs[i] = [op, text.slice(best, best + len)];
    next[1] = text.slice(best + len);
  }
  return diffs.filter(([, text]) => text.length > 0);
}
