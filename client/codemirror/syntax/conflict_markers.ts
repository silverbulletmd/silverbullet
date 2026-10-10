import { isolateHistory } from "@codemirror/commands";
import {
  type EditorState,
  type Line,
  type Range,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { Client } from "../../client.ts";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
} from "../util.ts";

const editConflictManually = StateEffect.define<number>();
const compareConflict = StateEffect.define<number>();
const manualConflicts = StateField.define<number[]>({
  create: () => [],
  update: (positions, transaction) => {
    let next = positions.map((position) =>
      transaction.changes.mapPos(position),
    );
    for (const effect of transaction.effects) {
      if (effect.is(editConflictManually)) next.push(effect.value);
      if (effect.is(compareConflict))
        next = next.filter((position) => position !== effect.value);
    }
    return next;
  },
});

const SB_START_PREFIX = "<<<<<<< SB sha256:";
const SB_BASE_PREFIX = "||||||| SB BASE sha256:";
const SB_END_PREFIX = ">>>>>>> SB sha256:";

export type ConflictKind = "sb" | "git";

export type ConflictSection = {
  from: number;
  to: number;
  hash: string;
  label?: string;
  text: string;
};

export type ConflictHunk = {
  from: number;
  to: number;
  kind: ConflictKind;
  first: ConflictSection;
  base?: ConflictSection;
  second: ConflictSection;
};

export type ConflictResolveAction = "first" | "second" | "both" | "base";

function stripTrailingCR(text: string): string {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

function splitLabel(rest: string): string {
  return rest.startsWith(" ") ? rest.slice(1) : rest;
}

type MarkerMatch = {
  markerSize: number;
  kind: ConflictKind;
  hash: string;
  label?: string;
};

function matchStartLine(lineText: string): MarkerMatch | null {
  const stripped = stripTrailingCR(lineText);
  if (stripped.startsWith(SB_START_PREFIX)) {
    return {
      kind: "sb",
      markerSize: 7,
      hash: stripped.slice(SB_START_PREFIX.length),
    };
  }
  const prefix = stripped.match(/^(<{3,256})(?= |$)/)?.[0];
  if (prefix) {
    return {
      kind: "git",
      hash: "",
      markerSize: prefix.length,
      label: splitLabel(stripped.slice(prefix.length)),
    };
  }
  return null;
}

function matchBaseLine(lineText: string): MarkerMatch | null {
  const stripped = stripTrailingCR(lineText);
  if (stripped.startsWith(SB_BASE_PREFIX)) {
    return {
      kind: "sb",
      markerSize: 7,
      hash: stripped.slice(SB_BASE_PREFIX.length),
    };
  }
  const prefix = stripped.match(/^(\|{3,256})(?= |$)/)?.[0];
  if (prefix) {
    return {
      kind: "git",
      hash: "",
      markerSize: prefix.length,
      label: splitLabel(stripped.slice(prefix.length)),
    };
  }
  return null;
}

function matchEndLine(lineText: string): MarkerMatch | null {
  const stripped = stripTrailingCR(lineText);
  if (stripped.startsWith(SB_END_PREFIX)) {
    return {
      kind: "sb",
      markerSize: 7,
      hash: stripped.slice(SB_END_PREFIX.length),
    };
  }
  const prefix = stripped.match(/^(>{3,256})(?= |$)/)?.[0];
  if (prefix) {
    return {
      kind: "git",
      hash: "",
      markerSize: prefix.length,
      label: splitLabel(stripped.slice(prefix.length)),
    };
  }
  return null;
}

function matchSeparatorLine(lineText: string, size: number): boolean {
  return stripTrailingCR(lineText) === "=".repeat(size);
}

function readSection(
  doc: Text,
  from: number,
  to: number,
  hash: string,
  label?: string,
): ConflictSection {
  return { from, to, hash, label, text: doc.sliceString(from, to) };
}

/**
 * Lines inside a ``` / ~~~ fenced code block never start a real hunk — a
 * fenced conflict-markers *example* in documentation is prose, not damage
 * to resolve. `mask[n]` is true when line `n` sits strictly between an
 * opening and (if any) closing fence; the delimiter lines themselves are
 * left unmasked since they never look like conflict markers anyway. An
 * unterminated fence masks through EOF, which is the conservative choice.
 */
export function computeFenceMask(doc: Text): boolean[] {
  const totalLines = doc.lines;
  const mask = new Array<boolean>(totalLines + 1).fill(false);
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  for (let i = 1; i <= totalLines; i++) {
    const trimmed = stripTrailingCR(doc.line(i).text).replace(/^ {0,3}/, "");
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
  | { kind: "found"; line: Line; match: MarkerMatch }
  | { kind: "sep"; line: Line }
  | { kind: "nested"; line: Line }
  | { kind: "missing" };

/**
 * A start-marker line always aborts as "nested", regardless of fencing —
 * SB's sha256 grammar can't false-positive, and a git-form start is only
 * exempt from counting when `respectFenceMask` is off (i.e. we're inside an
 * SB hunk's own scan, which must never be fence-masked at all).
 */
function isNestedStart(
  lineText: string,
  lineNumber: number,
  fenceMask: boolean[],
  respectFenceMask: boolean,
): boolean {
  const match = matchStartLine(lineText);
  if (match === null) return false;
  if (match.kind === "git" && respectFenceMask && fenceMask[lineNumber]) {
    return false;
  }
  return true;
}

/**
 * Scans lines [from, totalLines] for the first line matching
 * `wantBase`/`wantSep` as instructed. Any start-marker line (SB or git)
 * encountered along the way aborts as "nested" before it's tested against
 * the target: a marker can't legally contain another marker's start, so the
 * server never produces this for SB, but hand-edited or git-conflicted
 * damage shouldn't have a stray marker line silently swallowed into an
 * accepted section.
 *
 * `respectFenceMask` gates fencing for the *target* match only (and for a
 * git-kind nested start — see `isNestedStart`): pass `false` when scanning
 * an SB hunk, since SB's grammar can't false-positive and must never be
 * fence-masked, even when the hunk's own content contains or straddles a
 * fenced block; pass `true` for a git hunk's own scan, where a fenced
 * example must still be ignored.
 */
function scanForLine(
  doc: Text,
  from: number,
  totalLines: number,
  fenceMask: boolean[],
  respectFenceMask: boolean,
  options: {
    wantBaseKind?: ConflictKind;
    wantSeparator?: boolean;
    markerSize?: number;
  },
): ScanResult {
  for (let i = from; i <= totalLines; i++) {
    const line = doc.line(i);
    if (isNestedStart(line.text, i, fenceMask, respectFenceMask)) {
      return { kind: "nested", line };
    }
    if (respectFenceMask && fenceMask[i]) continue;
    if (
      options.wantSeparator &&
      matchSeparatorLine(line.text, options.markerSize ?? 7)
    ) {
      return { kind: "sep", line };
    }
    if (options.wantBaseKind) {
      const base = matchBaseLine(line.text);
      if (
        base !== null &&
        base.kind === options.wantBaseKind &&
        base.markerSize === (options.markerSize ?? 7)
      ) {
        return { kind: "found", line, match: base };
      }
    }
  }
  return { kind: "missing" };
}

function scanForEnd(
  doc: Text,
  from: number,
  totalLines: number,
  fenceMask: boolean[],
  respectFenceMask: boolean,
  wantKind: ConflictKind,
  markerSize = 7,
):
  | { kind: "found"; line: Line; match: MarkerMatch }
  | { kind: "nested"; line: Line }
  | {
      kind: "missing";
    } {
  for (let i = from; i <= totalLines; i++) {
    const line = doc.line(i);
    if (isNestedStart(line.text, i, fenceMask, respectFenceMask)) {
      return { kind: "nested", line };
    }
    if (respectFenceMask && fenceMask[i]) continue;
    const end = matchEndLine(line.text);
    if (
      end !== null &&
      end.kind === wantKind &&
      end.markerSize === markerSize
    ) {
      return { kind: "found", line, match: end };
    }
  }
  return { kind: "missing" };
}

/**
 * Raw line scan for conflict-marker hunks — SB's own grammar (see
 * `merge/src/markers.rs`) and, alongside it, git's. Conflict markers are
 * never syntax-tree nodes, so this deliberately doesn't use
 * `syntaxTree.iterate` — it must keep working inside frontmatter, fenced
 * code (which it explicitly ignores), or any other block context.
 */
export function findConflictHunks(doc: Text): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  const totalLines = doc.lines;
  const fenceMask = computeFenceMask(doc);
  let n = 1;

  while (n <= totalLines) {
    const startLine = doc.line(n);
    const start = matchStartLine(startLine.text);
    if (start === null) {
      n++;
      continue;
    }
    if (start.kind === "git" && fenceMask[n]) {
      n++;
      continue;
    }

    if (start.kind === "sb") {
      const baseResult = scanForLine(doc, n + 1, totalLines, fenceMask, false, {
        wantBaseKind: "sb",
      });
      if (baseResult.kind === "nested") {
        n = baseResult.line.number + 1;
        continue;
      }
      if (baseResult.kind !== "found") {
        n++;
        continue;
      }
      const { line: baseLine, match: baseMatch } = baseResult;

      const sepResult = scanForLine(
        doc,
        baseLine.number + 1,
        totalLines,
        fenceMask,
        false,
        {
          wantSeparator: true,
        },
      );
      if (sepResult.kind === "nested") {
        n = sepResult.line.number + 1;
        continue;
      }
      if (sepResult.kind !== "sep") {
        n++;
        continue;
      }
      const { line: sepLine } = sepResult;

      const endResult = scanForEnd(
        doc,
        sepLine.number + 1,
        totalLines,
        fenceMask,
        false,
        "sb",
      );
      if (endResult.kind === "nested") {
        n = endResult.line.number + 1;
        continue;
      }
      if (endResult.kind !== "found") {
        n++;
        continue;
      }
      const { line: endLine, match: endMatch } = endResult;

      const first = readSection(
        doc,
        startLine.to + 1,
        baseLine.from,
        start.hash,
      );
      const base = readSection(
        doc,
        baseLine.to + 1,
        sepLine.from,
        baseMatch.hash,
      );
      const second = readSection(
        doc,
        sepLine.to + 1,
        endLine.from,
        endMatch.hash,
      );
      const to = endLine.to < doc.length ? endLine.to + 1 : endLine.to;

      hunks.push({ from: startLine.from, to, kind: "sb", first, base, second });
      n = endLine.number + 1;
      continue;
    }

    // Git: the diff3 base section is optional, so this scans for a git
    // base line OR the separator, whichever comes first. Unlike the SB
    // branch above, these scans respect the fence mask.
    const baseOrSep = scanForLine(doc, n + 1, totalLines, fenceMask, true, {
      wantBaseKind: "git",
      wantSeparator: true,
      markerSize: start.markerSize,
    });
    if (baseOrSep.kind === "nested") {
      n = baseOrSep.line.number + 1;
      continue;
    }
    if (baseOrSep.kind === "missing") {
      n++;
      continue;
    }

    let baseLine: Line | undefined;
    let baseMatch: MarkerMatch | undefined;
    let sepLine: Line;
    if (baseOrSep.kind === "found") {
      baseLine = baseOrSep.line;
      baseMatch = baseOrSep.match;
      const sepResult = scanForLine(
        doc,
        baseLine.number + 1,
        totalLines,
        fenceMask,
        true,
        {
          wantSeparator: true,
          markerSize: start.markerSize,
        },
      );
      if (sepResult.kind === "nested") {
        n = sepResult.line.number + 1;
        continue;
      }
      if (sepResult.kind !== "sep") {
        n++;
        continue;
      }
      sepLine = sepResult.line;
    } else {
      sepLine = baseOrSep.line;
    }

    const endResult = scanForEnd(
      doc,
      sepLine.number + 1,
      totalLines,
      fenceMask,
      true,
      "git",
      start.markerSize,
    );
    if (endResult.kind === "nested") {
      n = endResult.line.number + 1;
      continue;
    }
    if (endResult.kind !== "found") {
      n++;
      continue;
    }
    const { line: endLine, match: endMatch } = endResult;

    const first = readSection(
      doc,
      startLine.to + 1,
      (baseLine ?? sepLine).from,
      start.hash,
      start.label,
    );
    const base =
      baseLine && baseMatch
        ? readSection(
            doc,
            baseLine.to + 1,
            sepLine.from,
            baseMatch.hash,
            baseMatch.label,
          )
        : undefined;
    const second = readSection(
      doc,
      sepLine.to + 1,
      endLine.from,
      endMatch.hash,
      endMatch.label,
    );
    const to = endLine.to < doc.length ? endLine.to + 1 : endLine.to;

    hunks.push({ from: startLine.from, to, kind: "git", first, base, second });
    n = endLine.number + 1;
  }

  return hunks;
}

export function resolveHunk(
  hunk: ConflictHunk,
  action: ConflictResolveAction,
): { from: number; to: number; insert: string } {
  let insert: string;
  switch (action) {
    case "first":
      insert = hunk.first.text;
      break;
    case "second":
      insert = hunk.second.text;
      break;
    case "both":
      insert = hunk.first.text + hunk.second.text;
      break;
    case "base":
      if (!hunk.base) {
        throw new Error(
          "resolveHunk: this hunk has no base section to restore",
        );
      }
      insert = hunk.base.text;
      break;
  }
  return { from: hunk.from, to: hunk.to, insert };
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

export function truncateLabel(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sectionEq(a: ConflictSection, b: ConflictSection): boolean {
  return a.hash === b.hash && a.label === b.label && a.text === b.text;
}

export function sectionTitle(
  hunk: ConflictHunk,
  role: "first" | "base" | "second",
  _section: ConflictSection,
): string {
  if (hunk.kind === "git") {
    return role === "first"
      ? "This space"
      : role === "second"
        ? "Remote repository"
        : "Common ancestor";
  }
  switch (role) {
    case "first":
      return "Version 1";
    case "second":
      return "Version 2";
    case "base":
      return "Original";
  }
}

export function shouldRenderBasePanel(hunk: ConflictHunk): boolean {
  return hunk.base !== undefined;
}

export class ConflictWidget extends WidgetType {
  constructor(
    readonly hunk: ConflictHunk,
    readonly client: Client,
  ) {
    super();
  }

  private resolve(action: ConflictResolveAction) {
    if (this.client.editorView.state.readOnly) return;
    const current = findConflictHunks(this.client.editorView.state.doc).find(
      (hunk) => hunk.from === this.hunk.from && hunk.to === this.hunk.to,
    );
    if (
      !current ||
      !sectionEq(current.first, this.hunk.first) ||
      !sectionEq(current.second, this.hunk.second)
    )
      return;
    const { from, to, insert } = resolveHunk(this.hunk, action);
    this.client.editorView.dispatch({
      changes: { from, to, insert },
      annotations: isolateHistory.of("full"),
    });
    this.client.focus();
  }

  private editManually() {
    this.client.editorView.dispatch({
      selection: { anchor: this.hunk.from },
      effects: editConflictManually.of(this.hunk.from),
      annotations: isolateHistory.of("full"),
      scrollIntoView: true,
    });
    this.client.focus();
  }

  private createButton(
    text: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = text;
    button.setAttribute("title", title);
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return button;
  }

  private renderSection(
    title: string,
    actionTitle: string,
    section: ConflictSection,
    action: ConflictResolveAction,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "sb-conflict-section";
    const readOnly = this.client.editorView.state.readOnly;
    if (!readOnly) {
      wrapper.setAttribute("role", "button");
      wrapper.tabIndex = 0;
    }
    wrapper.title = section.hash
      ? `${actionTitle} (${shortHash(section.hash)})`
      : `${actionTitle}: ${title}`;
    // Without this the accessible name defaults to the wrapper's full text
    // content — the entire raw conflict body — instead of naming the action.
    wrapper.setAttribute(
      "aria-label",
      action === "base" ? `Restore ${title.toLowerCase()}` : `Accept ${title}`,
    );

    const header = document.createElement("div");
    header.className = "sb-conflict-section-header";
    header.textContent = truncateLabel(title);
    if (section.hash) {
      const hash = document.createElement("span");
      hash.className = "sb-conflict-section-hash";
      hash.textContent = shortHash(section.hash);
      header.appendChild(hash);
    }

    const body = document.createElement("pre");
    body.className = "sb-conflict-section-body";
    body.textContent = section.text;

    wrapper.appendChild(header);
    wrapper.appendChild(body);

    const activate = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (!readOnly) this.resolve(action);
    };
    wrapper.addEventListener("click", activate);
    wrapper.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        activate(e);
      }
    });

    return wrapper;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "sb-conflict-widget";

    const buttonBar = document.createElement("div");
    buttonBar.className = "sb-conflict-button-bar";
    buttonBar.appendChild(
      this.createButton(
        this.hunk.kind === "git" ? "Keep both" : "Accept both",
        "Keep both versions, first then second",
        () => this.resolve("both"),
      ),
    );
    buttonBar.appendChild(
      this.createButton(
        "Edit manually",
        "Reveal the raw conflict markers for manual editing",
        () => this.editManually(),
      ),
    );
    const label = document.createElement("span");
    label.className = "sb-comment-label";
    label.textContent = "edit conflict";
    buttonBar.appendChild(label);

    const prompt = document.createElement("div");
    prompt.className = "sb-conflict-prompt";
    prompt.textContent = "Select the version you'd like to keep:";

    const sections = document.createElement("div");
    sections.className = "sb-conflict-sections";
    sections.appendChild(
      this.renderSection(
        sectionTitle(this.hunk, "first", this.hunk.first),
        "Accept this version",
        this.hunk.first,
        "first",
      ),
    );
    if (shouldRenderBasePanel(this.hunk)) {
      sections.appendChild(
        this.renderSection(
          sectionTitle(this.hunk, "base", this.hunk.base!),
          "Restore this version",
          this.hunk.base!,
          "base",
        ),
      );
    }
    sections.appendChild(
      this.renderSection(
        sectionTitle(this.hunk, "second", this.hunk.second),
        "Accept this version",
        this.hunk.second,
        "second",
      ),
    );

    if (!this.client.editorView.state.readOnly)
      container.appendChild(buttonBar);
    container.appendChild(prompt);
    container.appendChild(sections);
    return container;
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof ConflictWidget)) return false;
    if (other.hunk.from !== this.hunk.from) return false;
    if (other.hunk.to !== this.hunk.to) return false;
    if (other.hunk.kind !== this.hunk.kind) return false;
    if (!sectionEq(other.hunk.first, this.hunk.first)) return false;
    if (!sectionEq(other.hunk.second, this.hunk.second)) return false;
    const otherBase = other.hunk.base;
    const thisBase = this.hunk.base;
    if ((otherBase === undefined) !== (thisBase === undefined)) return false;
    if (otherBase && thisBase && !sectionEq(otherBase, thisBase)) return false;
    return true;
  }
}

class ManualConflictWidget extends WidgetType {
  constructor(
    readonly client: Client,
    readonly from: number,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("div");
    node.className = "sb-conflict-manual";
    const text = document.createElement("p");
    text.textContent =
      "Remove the conflict markers to resume sync. Your edits are saved automatically.";
    node.append(text);
    const button = document.createElement("button");
    button.textContent = "Show comparison";
    button.addEventListener("click", () =>
      this.client.editorView.dispatch({
        effects: compareConflict.of(this.from),
      }),
    );
    node.append(button);
    return node;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof ManualConflictWidget && other.from === this.from;
  }
}

export function conflictMarkers(client: Client) {
  const decorations = decoratorStateField((state: EditorState) => {
    const hunks = findConflictHunks(state.doc);
    const manual = state.field(manualConflicts);
    const widgets: Range<Decoration>[] = [];
    if (
      manual.length &&
      /^(?:<{3,}|>{3,}|\|{3,}|={3,})/m.test(state.doc.toString())
    ) {
      for (const from of manual) {
        widgets.push(
          Decoration.widget({
            widget: new ManualConflictWidget(client, from),
            side: -1,
          }).range(state.doc.lineAt(from).from),
        );
      }
    }
    for (const hunk of hunks) {
      if (
        (hunk.kind === "sb" && isCursorInRange(state, [hunk.from, hunk.to])) ||
        state.field(manualConflicts).includes(hunk.from)
      ) {
        continue;
      }
      const hideTo =
        state.doc.sliceString(hunk.to - 1, hunk.to) === "\n"
          ? hunk.to - 1
          : hunk.to;
      hideBlockSource(widgets, state, hunk.from, hideTo, "start");
      widgets.push(
        Decoration.widget({
          widget: new ConflictWidget(hunk, client),
        }).range(hunk.from),
      );
    }

    return Decoration.set(widgets, true);
  });
  return [manualConflicts, decorations] as const;
}
