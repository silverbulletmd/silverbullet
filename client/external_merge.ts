import { ChangeSet, Text } from "@codemirror/state";
import { diffAndPrepareChanges } from "./codemirror/cm_util.ts";
import { findConflictHunks } from "./codemirror/conflict_markers.ts";

export type ExternalMerge = {
  /** Applies to `current`. Empty when there is nothing to do *or* when the
   * update was deferred — the flag below is what distinguishes those. */
  changes: ChangeSet;
  /**
   * The external update was withheld because both sides rewrote the same base
   * line: the buffer still descends from `base`, not from `disk`. Distinct
   * from an empty `changes`, which also covers having nothing to do.
   */
  deferred: boolean;
};

/**
 * Three-way merge for externally-changed page content.
 *
 * `base` is the last known on-disk text (tracked by ContentManager), `disk`
 * is the new on-disk text, and `current` is the editor doc (possibly holding
 * unsaved local edits relative to base). Both diffs are taken against base;
 * the external change set is mapped through the local one so local edits are
 * preserved.
 */
export function computeExternalChanges(
  base: string,
  disk: string,
  current: string,
): ExternalMerge {
  if (disk === current) {
    return { changes: ChangeSet.empty(current.length), deferred: false };
  }
  const external = ChangeSet.of(diffAndPrepareChanges(base, disk), base.length);
  if (current === base) {
    return { changes: external, deferred: false };
  }
  if (!external.empty && hasConflictMarkers(disk)) {
    return {
      changes: ChangeSet.of(
        diffAndPrepareChanges(current, disk),
        current.length,
      ),
      deferred: false,
    };
  }
  const local = ChangeSet.of(diffAndPrepareChanges(base, current), base.length);
  if (rewritesSameLine(external, local, base)) {
    return { changes: ChangeSet.empty(current.length), deferred: true };
  }
  // before: true keeps a local insertion on the user's side of the merge
  // when it sits at the same position as an external edit.
  return { changes: external.map(local, true), deferred: false };
}

function rewritesSameLine(
  external: ChangeSet,
  local: ChangeSet,
  base: string,
): boolean {
  const lineAt = lineIndexer(base);
  const localLines = rewrittenLines(local, lineAt);
  if (localLines.size === 0) {
    return false;
  }
  for (const line of rewrittenLines(external, lineAt)) {
    if (localLines.has(line)) {
      return true;
    }
  }
  return false;
}

/**
 * Base lines a change set replaces or deletes text on. Pure insertions are
 * excluded deliberately: they destroy nothing, so they still merge cleanly
 * against the other side's rewrite of the same line.
 */
function rewrittenLines(
  changes: ChangeSet,
  lineAt: (pos: number) => number,
): Set<number> {
  const lines = new Set<number>();
  changes.iterChanges((from, to) => {
    if (from === to) {
      return;
    }
    for (let line = lineAt(from); line <= lineAt(to - 1); line++) {
      lines.add(line);
    }
  });
  return lines;
}

function lineIndexer(base: string): (pos: number) => number {
  const starts = [0];
  for (let i = base.indexOf("\n"); i !== -1; i = base.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  return (pos) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= pos) low = mid;
      else high = mid - 1;
    }
    return low;
  };
}

// Only SB's own marker grammar is the merge kernel's authoritative output —
// a git-style hunk in disk content is just ordinary text (e.g. a pasted
// example) and must go through the normal 3-way merge/defer path instead
// of triggering a wholesale replace.
function hasConflictMarkers(text: string): boolean {
  return findConflictHunks(Text.of(text.split("\n"))).some(
    (hunk) => hunk.kind === "sb",
  );
}
