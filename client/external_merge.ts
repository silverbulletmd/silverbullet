import { ChangeSet, Text } from "@codemirror/state";
import { diffAndPrepareChanges } from "./codemirror/cm_util.ts";
import { findConflictHunks } from "./codemirror/conflict_markers.ts";

export type ExternalMerge = {
  /** Applies to `current`. Empty when there is nothing to do *or* when the
   * update was deferred — the flag below is what distinguishes those. */
  changes: ChangeSet;
  /**
   * The external update was withheld because both sides edited the same chunk
   * of the server's three-way merge: the buffer still descends from `base`,
   * not from `disk`. Distinct from an empty `changes`, which also covers
   * having nothing to do.
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
  options: { canDefer?: boolean } = {},
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
  if (
    options.canDefer !== false &&
    collidesInSameChunk(external, local, base)
  ) {
    return { changes: ChangeSet.empty(current.length), deferred: true };
  }
  // before: true keeps a local insertion on the user's side of the merge
  // when it sits at the same position as an external edit.
  return { changes: external.map(local, true), deferred: false };
}

/**
 * Whether the two sides' edits land in the same chunk of the server's
 * three-way merge, in which case it would conflict where a local merge here
 * would silently succeed, leaving buffer and disk permanently disagreeing.
 *
 * Mirrors `server-merge`'s diff3: a base line survives as a sync point only
 * where both sides leave it byte-identical, chunks are the runs between
 * consecutive sync points, and a chunk both sides touched is a conflict. An
 * whole-line insertion at an exact line boundary leaves both neighbouring
 * lines intact, so it occupies the gap rather than a line -- but it joins an
 * adjoining run when either neighbour was rewritten.
 *
 * Errs toward deferring: the server's word-level refinement rescues some
 * same-chunk cases this treats as collisions, which costs a round trip but
 * never diverges.
 */
function collidesInSameChunk(
  external: ChangeSet,
  local: ChangeSet,
  base: string,
): boolean {
  const { lineAt, isLineStart } = lineIndexer(base);
  const externalEdits = classifyEdits(external, lineAt, isLineStart);
  const localEdits = classifyEdits(local, lineAt, isLineStart);

  const nonSync = new Set([...externalEdits.lines, ...localEdits.lines]);
  const externalChunks = claimedChunks(externalEdits, nonSync);
  for (const chunk of claimedChunks(localEdits, nonSync)) {
    if (externalChunks.has(chunk)) {
      return true;
    }
  }
  return false;
}

type Edits = {
  /** Base lines the side did not leave byte-identical. */
  lines: Set<number>;
  /** Line numbers an insertion sits immediately before. */
  boundaries: Set<number>;
};

function classifyEdits(
  changes: ChangeSet,
  lineAt: (pos: number) => number,
  isLineStart: (pos: number) => boolean,
): Edits {
  const lines = new Set<number>();
  const boundaries = new Set<number>();
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (from === to) {
      // Only a whole-line insertion at a line start leaves both neighbouring
      // lines byte-identical; anything else rewrites the line it lands in.
      if (
        isLineStart(from) &&
        inserted.sliceString(inserted.length - 1) === "\n"
      ) {
        boundaries.add(lineAt(from));
      } else {
        lines.add(lineAt(from));
      }
      return;
    }
    for (let line = lineAt(from); line <= lineAt(to - 1); line++) {
      lines.add(line);
    }
    // Whatever follows `to` on its line is joined onto whatever preceded
    // `from`, so that line stops being byte-identical too -- unless the
    // change ends exactly on a line boundary and leaves one behind.
    const endsCleanly =
      isLineStart(to) &&
      (inserted.length === 0 ||
        inserted.sliceString(inserted.length - 1) === "\n");
    if (!endsCleanly) {
      lines.add(lineAt(to));
    }
  });
  return { lines, boundaries };
}

function claimedChunks(edits: Edits, nonSync: Set<number>): Set<string> {
  const chunks = new Set<string>();
  for (const line of edits.lines) {
    chunks.add(`run:${runStart(line, nonSync)}`);
  }
  for (const boundary of edits.boundaries) {
    if (nonSync.has(boundary - 1)) {
      chunks.add(`run:${runStart(boundary - 1, nonSync)}`);
    } else if (nonSync.has(boundary)) {
      chunks.add(`run:${runStart(boundary, nonSync)}`);
    } else {
      chunks.add(`gap:${boundary}`);
    }
  }
  return chunks;
}

function runStart(line: number, nonSync: Set<number>): number {
  let start = line;
  while (nonSync.has(start - 1)) {
    start--;
  }
  return start;
}

function lineIndexer(base: string): {
  lineAt: (pos: number) => number;
  isLineStart: (pos: number) => boolean;
} {
  const starts = [0];
  for (let i = base.indexOf("\n"); i !== -1; i = base.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  const startSet = new Set(starts);
  return {
    lineAt: (pos) => {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid] <= pos) low = mid;
        else high = mid - 1;
      }
      return low;
    },
    isLineStart: (pos) => startSet.has(pos),
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
