// Detection logic duplicated from client/codemirror/conflict_markers.ts:
// plugs run in a separate WASM sandbox with no access to CodeMirror's
// `Text`, so the two can't share a module. Keep this in sync with that
// file's grammar/fence/nesting rules when either changes.

const SB_START_PREFIX = "<<<<<<< SB sha256:";
const SB_BASE_PREFIX = "||||||| SB BASE sha256:";
const SEPARATOR_LINE = "=======";
const SB_END_PREFIX = ">>>>>>> SB sha256:";
const GIT_START_PREFIX = "<<<<<<<";
const GIT_BASE_PREFIX = "|||||||";
const GIT_END_PREFIX = ">>>>>>>";

type Kind = "sb" | "git";

function stripTrailingCR(text: string): string {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

function matchStart(line: string): Kind | null {
  const s = stripTrailingCR(line);
  if (s.startsWith(SB_START_PREFIX)) return "sb";
  if (s.startsWith(GIT_START_PREFIX)) return "git";
  return null;
}

function matchBase(line: string): Kind | null {
  const s = stripTrailingCR(line);
  if (s.startsWith(SB_BASE_PREFIX)) return "sb";
  if (s.startsWith(GIT_BASE_PREFIX)) return "git";
  return null;
}

function matchEnd(line: string): Kind | null {
  const s = stripTrailingCR(line);
  if (s.startsWith(SB_END_PREFIX)) return "sb";
  if (s.startsWith(GIT_END_PREFIX)) return "git";
  return null;
}

function isSeparator(line: string): boolean {
  return stripTrailingCR(line) === SEPARATOR_LINE;
}

interface DocLine {
  text: string;
  from: number;
}

function splitLines(text: string): DocLine[] {
  const lines: DocLine[] = [];
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) {
      lines.push({ text: text.slice(pos), from: pos });
      break;
    }
    lines.push({ text: text.slice(pos, nl), from: pos });
    pos = nl + 1;
  }
  return lines;
}

// Same fenced-code-awareness as the widget: a conflict-markers example
// inside a ``` / ~~~ block is documentation, not damage to resolve.
function computeFenceMask(lines: DocLine[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = stripTrailingCR(lines[i].text).replace(/^ {0,3}/, "");
    if (fenceChar === null) {
      const open = /^(`{3,}|~{3,})/.exec(trimmed);
      if (open) {
        fenceChar = open[1][0] as "`" | "~";
        fenceLen = open[1].length;
      }
      continue;
    }
    const closeRe = fenceChar === "`" ? /^`{3,}\s*$/ : /^~{3,}\s*$/;
    if (closeRe.test(trimmed) && trimmed.trimEnd().length >= fenceLen) {
      fenceChar = null;
      fenceLen = 0;
      continue;
    }
    mask[i] = true;
  }

  return mask;
}

type ScanResult =
  | { kind: "found"; index: number }
  | { kind: "sep"; index: number }
  | { kind: "nested"; index: number }
  | { kind: "missing" };

// A start-marker line always aborts as "nested" regardless of fencing — SB
// can't false-positive, and a git-form start is only exempt from counting
// when `respectFenceMask` is off (i.e. inside an SB hunk's own scan, which
// must never be fence-masked at all).
function isNestedStart(
  text: string,
  index: number,
  fenceMask: boolean[],
  respectFenceMask: boolean,
): boolean {
  const kind = matchStart(text);
  if (kind === null) return false;
  if (kind === "git" && respectFenceMask && fenceMask[index]) return false;
  return true;
}

function scanFor(
  lines: DocLine[],
  fenceMask: boolean[],
  from: number,
  respectFenceMask: boolean,
  options: { wantBaseKind?: Kind; wantSeparator?: boolean },
): ScanResult {
  for (let i = from; i < lines.length; i++) {
    const text = lines[i].text;
    if (isNestedStart(text, i, fenceMask, respectFenceMask)) {
      return { kind: "nested", index: i };
    }
    if (respectFenceMask && fenceMask[i]) continue;
    if (options.wantSeparator && isSeparator(text)) {
      return { kind: "sep", index: i };
    }
    if (options.wantBaseKind && matchBase(text) === options.wantBaseKind) {
      return { kind: "found", index: i };
    }
  }
  return { kind: "missing" };
}

function scanForEnd(
  lines: DocLine[],
  fenceMask: boolean[],
  from: number,
  respectFenceMask: boolean,
  wantKind: Kind,
):
  | { kind: "found"; index: number }
  | { kind: "nested"; index: number }
  | { kind: "missing" } {
  for (let i = from; i < lines.length; i++) {
    const text = lines[i].text;
    if (isNestedStart(text, i, fenceMask, respectFenceMask)) {
      return { kind: "nested", index: i };
    }
    if (respectFenceMask && fenceMask[i]) continue;
    if (matchEnd(text) === wantKind) {
      return { kind: "found", index: i };
    }
  }
  return { kind: "missing" };
}

/**
 * Offsets of every complete, well-ordered conflict hunk (SB or git),
 * fence-aware and nested-start-aware — same rules as
 * `findConflictHunks` in the CodeMirror widget.
 */
function findCompleteHunkOffsets(text: string): number[] {
  const lines = splitLines(text);
  const fenceMask = computeFenceMask(lines);
  const offsets: number[] = [];
  let n = 0;

  while (n < lines.length) {
    const startKind = matchStart(lines[n].text);
    if (startKind === null) {
      n++;
      continue;
    }
    // A git-form start inside a fence is ignored; an SB-form start never is
    // — SB's grammar can't false-positive and must never be fence-masked.
    if (startKind === "git" && fenceMask[n]) {
      n++;
      continue;
    }

    if (startKind === "sb") {
      const base = scanFor(lines, fenceMask, n + 1, false, {
        wantBaseKind: "sb",
      });
      if (base.kind === "nested") {
        n = base.index + 1;
        continue;
      }
      if (base.kind !== "found") {
        n++;
        continue;
      }
      const sep = scanFor(lines, fenceMask, base.index + 1, false, {
        wantSeparator: true,
      });
      if (sep.kind === "nested") {
        n = sep.index + 1;
        continue;
      }
      if (sep.kind !== "sep") {
        n++;
        continue;
      }
      const end = scanForEnd(lines, fenceMask, sep.index + 1, false, "sb");
      if (end.kind === "nested") {
        n = end.index + 1;
        continue;
      }
      if (end.kind !== "found") {
        n++;
        continue;
      }
      offsets.push(lines[n].from);
      n = end.index + 1;
      continue;
    }

    // Git: the diff3 base section is optional. Unlike the SB branch above,
    // these scans respect the fence mask.
    const baseOrSep = scanFor(lines, fenceMask, n + 1, true, {
      wantBaseKind: "git",
      wantSeparator: true,
    });
    if (baseOrSep.kind === "nested") {
      n = baseOrSep.index + 1;
      continue;
    }
    if (baseOrSep.kind === "missing") {
      n++;
      continue;
    }
    let sepIndex: number;
    if (baseOrSep.kind === "found") {
      const sep = scanFor(lines, fenceMask, baseOrSep.index + 1, true, {
        wantSeparator: true,
      });
      if (sep.kind === "nested") {
        n = sep.index + 1;
        continue;
      }
      if (sep.kind !== "sep") {
        n++;
        continue;
      }
      sepIndex = sep.index;
    } else {
      sepIndex = baseOrSep.index;
    }

    const end = scanForEnd(lines, fenceMask, sepIndex + 1, true, "git");
    if (end.kind === "nested") {
      n = end.index + 1;
      continue;
    }
    if (end.kind !== "found") {
      n++;
      continue;
    }
    offsets.push(lines[n].from);
    n = end.index + 1;
  }

  return offsets;
}

export function containsConflictMarkers(text: string): boolean {
  return findCompleteHunkOffsets(text).length > 0;
}
