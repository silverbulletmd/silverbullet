import { foldedRanges } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { space } from "@silverbulletmd/silverbullet/syscalls";
import { openRevisionPreview } from "../navigator/views/revisions.ts";
import type { EditorGutterGroup } from "./gutter.ts";

const HUNK_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export type EditorGutterDiffLine = {
  text: string;
  cssClass?: string;
};

export type EditorGutterDiffRequest = {
  id: number;
  pagePath: string;
  group: EditorGutterGroup;
};

export type EditorGutterDiffState = {
  request?: EditorGutterDiffRequest;
  status?: "loading" | "ready" | "error";
  lines: readonly EditorGutterDiffLine[];
  decorations: DecorationSet;
};

type EditorGutterDiffAction =
  | { type: "open"; request: EditorGutterDiffRequest }
  | {
      type: "result";
      requestId: number;
      lines: readonly EditorGutterDiffLine[];
    }
  | { type: "error"; requestId: number };

export const setEditorGutterDiffEffect =
  StateEffect.define<EditorGutterDiffAction>();
export const clearEditorGutterDiffEffect = StateEffect.define<void>();

const emptyEditorGutterDiffState = createEditorGutterDiffState();

export const editorGutterDiffState = StateField.define<EditorGutterDiffState>({
  create: () => emptyEditorGutterDiffState,

  update(value: EditorGutterDiffState, transaction: Transaction) {
    if (transaction.docChanged) {
      return emptyEditorGutterDiffState;
    }

    for (const effect of transaction.effects) {
      if (effect.is(clearEditorGutterDiffEffect)) {
        return emptyEditorGutterDiffState;
      }
      if (!effect.is(setEditorGutterDiffEffect)) {
        continue;
      }

      const action = effect.value;
      if (action.type === "open") {
        return createEditorGutterDiffState(
          transaction.state,
          action.request,
          "loading",
          [],
        );
      }
      if (value.request?.id !== action.requestId) {
        continue;
      }
      return createEditorGutterDiffState(
        transaction.state,
        value.request,
        action.type === "error" ? "error" : "ready",
        action.type === "error" ? [] : action.lines,
      );
    }
    return value;
  },

  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/** The state field itself provides decorations, so this can be composed easily. */
export const editorGutterDiffExtension: Extension = editorGutterDiffState;

let nextRequestId = 1;

/** Opens or closes the inline diff for a contiguous gutter group. */
export function openEditorGutterDiff(
  view: EditorView,
  pagePath: string,
  group: EditorGutterGroup,
): void {
  const current = view.state.field(editorGutterDiffState);
  if (current.request?.group.id === group.id) {
    view.dispatch({ effects: clearEditorGutterDiffEffect.of(undefined) });
    return;
  }

  const request: EditorGutterDiffRequest = {
    id: nextRequestId++,
    pagePath,
    group,
  };
  view.dispatch({
    effects: setEditorGutterDiffEffect.of({ type: "open", request }),
  });
  void loadEditorGutterDiff(view, request);
}

/** Parses a unified diff down to the selected gutter group's changed lines. */
export function parseEditorGutterDiff(
  diff: string,
  revisionStartLine: number,
  revisionEndLine: number,
  revisionLines?: readonly number[],
): EditorGutterDiffLine[] {
  const isSelectedLine = revisionLineSelector(
    revisionStartLine,
    revisionEndLine,
    revisionLines,
  );
  const hunks = parseHunks(diff);
  return hunks.flatMap((hunk) => {
    const lines = hunk.segments.flatMap((segment) =>
      selectedSegmentLines(segment, isSelectedLine),
    );
    if (lines.length === 0) {
      return [];
    }
    return [hunk.header, ...lines];
  });
}

/** Keeps a block diff visible when its selected line is inside a folded range. */
export function editorGutterDiffPosition(
  state: EditorState,
  position: number,
): number {
  let visiblePosition = position;
  const folded = foldedRanges(state).iter();
  while (folded.value) {
    if (position >= folded.from && position < folded.to) {
      visiblePosition = Math.max(visiblePosition, folded.to);
    }
    folded.next();
  }
  return visiblePosition;
}

type DiffHunk = {
  header: EditorGutterDiffLine;
  segments: DiffSegment[];
  newLine: number;
  lastWasContext: boolean;
};

type DiffSegment = {
  /** New-side line range changed by this contiguous diff segment. */
  newStart: number;
  newEnd: number;
  lines: DiffSegmentLine[];
};

type DiffSegmentLine = {
  diff: EditorGutterDiffLine;
  kind: "add" | "delete" | "meta";
  newLine?: number;
};

function parseHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  const lines = diff.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  for (const line of lines) {
    const match = line.match(HUNK_PATTERN);
    if (match) {
      current = {
        header: { text: line, cssClass: "sb-revision-diff-hunk" },
        segments: [],
        newLine: Number(match[3]),
        lastWasContext: true,
      };
      hunks.push(current);
      continue;
    }

    if (line.startsWith("diff --git ")) {
      current = undefined;
      continue;
    }
    if (current) {
      appendHunkLine(current, line);
    }
  }
  return hunks;
}

function appendHunkLine(hunk: DiffHunk, line: string): void {
  // Unified diff context is the separator between two independently changed
  // segments. It advances only the new-side line cursor.
  if (line.startsWith(" ")) {
    hunk.newLine += 1;
    hunk.lastWasContext = true;
    return;
  }

  if (line.startsWith("+") || line.startsWith("-")) {
    let segment = hunk.segments[hunk.segments.length - 1];
    if (!segment || hunk.lastWasContext) {
      segment = {
        newStart: hunk.newLine,
        newEnd: hunk.newLine - 1,
        lines: [],
      };
      hunk.segments.push(segment);
    }
    const isAddition = line.startsWith("+");
    segment.lines.push({
      diff: { text: line, cssClass: diffLineClass(line) },
      kind: isAddition ? "add" : "delete",
      newLine: isAddition ? hunk.newLine : undefined,
    });
    if (isAddition) {
      segment.newEnd = hunk.newLine;
      hunk.newLine += 1;
    }
    hunk.lastWasContext = false;
    return;
  }

  // `\\ No newline at end of file` belongs to the preceding change and does
  // not consume a line on either side of the diff.
  if (line.startsWith("\\")) {
    const segment = hunk.segments[hunk.segments.length - 1];
    segment?.lines.push({
      diff: { text: line, cssClass: diffLineClass(line) },
      kind: "meta",
    });
  }
}

function diffLineClass(line: string): string | undefined {
  if (line.startsWith("@@")) return "sb-revision-diff-hunk";
  if (line.startsWith("+")) return "sb-revision-diff-add";
  if (line.startsWith("-")) return "sb-revision-diff-del";
  return undefined;
}

function revisionLineSelector(
  targetStart: number,
  targetEnd: number,
  targetLines?: readonly number[],
): (line: number) => boolean {
  if (targetLines) {
    const selected = new Set(targetLines);
    return (line) => selected.has(line);
  }
  return (line) => targetStart <= line && line <= targetEnd;
}

function selectedSegmentLines(
  segment: DiffSegment,
  isSelectedLine: (line: number) => boolean,
): EditorGutterDiffLine[] {
  const selectedAdditions = segment.lines.some(
    (line) =>
      line.kind === "add" &&
      line.newLine !== undefined &&
      isSelectedLine(line.newLine),
  );
  const selectedDeletion =
    !selectedAdditions &&
    segment.newEnd < segment.newStart &&
    isSelectedLine(segment.newStart);

  if (!selectedAdditions && !selectedDeletion) {
    return [];
  }

  return segment.lines
    .filter((line) => {
      if (line.kind === "add") {
        return line.newLine !== undefined && isSelectedLine(line.newLine);
      }
      // A replacement's deleted side has no new-side line number. Keep it
      // with the selected additions so the inline diff remains meaningful.
      return selectedAdditions || selectedDeletion;
    })
    .map((line) => line.diff);
}

async function loadEditorGutterDiff(
  view: EditorView,
  request: EditorGutterDiffRequest,
): Promise<void> {
  try {
    const diff = await space.getRevisionDiff(
      request.pagePath,
      request.group.rev,
    );
    dispatchResult(view, {
      type: "result",
      requestId: request.id,
      lines: parseEditorGutterDiff(
        diff,
        request.group.revisionStartLine,
        request.group.revisionEndLine,
        request.group.revisionLines,
      ),
    });
  } catch (error) {
    if ((error as { status?: number } | undefined)?.status === 404) {
      dispatchResult(view, {
        type: "result",
        requestId: request.id,
        lines: [],
      });
      return;
    }
    dispatchResult(view, { type: "error", requestId: request.id });
  }
}

function dispatchResult(
  view: EditorView,
  action: Extract<EditorGutterDiffAction, { type: "result" | "error" }>,
): void {
  try {
    view.dispatch({ effects: setEditorGutterDiffEffect.of(action) });
  } catch {
    // A navigation can destroy the view while the request is in flight.
  }
}

function createEditorGutterDiffState(
  state?: EditorState,
  request?: EditorGutterDiffRequest,
  status?: "loading" | "ready" | "error",
  lines: readonly EditorGutterDiffLine[] = [],
): EditorGutterDiffState {
  if (!state || !request || !status) {
    return {
      lines: [],
      decorations: Decoration.none,
    };
  }

  const endLine = Math.max(1, Math.min(request.group.endLine, state.doc.lines));
  const position = editorGutterDiffPosition(state, state.doc.line(endLine).to);
  const widget = new EditorGutterDiffWidget({ request, status, lines });
  return {
    request,
    status,
    lines,
    decorations: Decoration.set([
      Decoration.widget({ widget, block: true, side: 1 }).range(position),
    ]),
  };
}

type EditorGutterDiffWidgetData = {
  request: EditorGutterDiffRequest;
  status: "loading" | "ready" | "error";
  lines: readonly EditorGutterDiffLine[];
};

class EditorGutterDiffWidget extends WidgetType {
  constructor(readonly data: EditorGutterDiffWidgetData) {
    super();
  }

  override eq(other: WidgetType): boolean {
    if (!(other instanceof EditorGutterDiffWidget)) return false;
    return (
      this.data.request.id === other.data.request.id &&
      this.data.status === other.data.status &&
      sameDiffLines(this.data.lines, other.data.lines)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "sb-editor-gutter-diff";
    root.dataset.status = this.data.status;

    const header = root.appendChild(document.createElement("div"));
    header.className = "sb-editor-gutter-diff-header";

    const label = header.appendChild(document.createElement("span"));
    label.className = "sb-editor-gutter-diff-label";
    label.textContent = this.data.request.group.rev
      ? this.data.request.group.rev.slice(0, 8)
      : "Uncommitted changes";

    const actions = header.appendChild(document.createElement("span"));
    actions.className = "sb-editor-gutter-diff-actions";
    const preview = actions.appendChild(document.createElement("button"));
    preview.type = "button";
    preview.className = "sb-editor-gutter-diff-action";
    preview.textContent = this.data.request.group.rev ? "View commit" : "View changes";
    preview.addEventListener("click", (event) => {
      stopEditorGutterDiffEvent(event);
      void openRevisionPreview(
        this.data.request.pagePath,
        this.data.request.group.rev,
        true,
      ).catch((error) =>
        console.error("Could not open gutter revision", error),
      );
    });

    const close = actions.appendChild(document.createElement("button"));
    close.type = "button";
    close.className = "sb-editor-gutter-diff-action";
    close.textContent = "Close";
    close.addEventListener("click", (event) => {
      stopEditorGutterDiffEvent(event);
      view.dispatch({ effects: clearEditorGutterDiffEffect.of(undefined) });
    });

    const body = root.appendChild(document.createElement("div"));
    body.className = "sb-editor-gutter-diff-body";
    if (this.data.status === "loading") {
      body.textContent = "Loading…";
    } else if (this.data.status === "error") {
      body.textContent = "Could not load line diff.";
    } else if (this.data.lines.length === 0) {
      body.textContent = "No changes touch this line.";
    } else {
      for (const line of this.data.lines) {
        const lineElement = body.appendChild(document.createElement("div"));
        if (line.cssClass) lineElement.className = line.cssClass;
        lineElement.textContent = line.text;
      }
    }
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function sameDiffLines(
  first: readonly EditorGutterDiffLine[],
  second: readonly EditorGutterDiffLine[],
): boolean {
  return (
    first.length === second.length &&
    first.every(
      (line, index) =>
        line.text === second[index].text &&
        line.cssClass === second[index].cssClass,
    )
  );
}

function stopEditorGutterDiffEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
