import {
  type EditorState,
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  type BlockInfo,
  type EditorView,
  GutterMarker,
  gutter,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type {
  EditorGutter,
  EditorGutterMarker,
} from "../../plug-api/types/client.ts";
import {
  editorGutterDiffExtension,
  openEditorGutterDiff,
} from "./gutter_diff.ts";
import { setEditorGuttersEffect } from "./gutter_effects.ts";

const MAX_GUTTER_MARKERS = 100_000;
const MAX_GUTTER_WIDTH = 80;
const CORE_GUTTER_OWNER = "__core__";
const GUTTER_CELL_HORIZONTAL_PADDING = "0.7em";

export type EditorGutterDefinition = Omit<EditorGutter, "page">;

export type NamedEditorGutter = EditorGutterDefinition & {
  id: string;
};

export type EditorGutterGroup = {
  /** Stable identity for this contiguous run within a gutter update. */
  id: string;
  gutterId: string;
  rev?: string;
  startLine: number;
  endLine: number;
  /** Exact one-based line numbers in the committed revision (or working tree). */
  revisionLines: readonly number[];
  /** Bounding range kept for positioning and range-based fallback consumers. */
  revisionStartLine: number;
  revisionEndLine: number;
};

type StoredEditorGutter = {
  owner: string;
  id: string;
  page: string;
  gutter: EditorGutterDefinition;
};

type GutterCell = {
  gutterId: string;
  text: string;
  title?: string;
  className?: string;
  rev?: string;
  revisionLine?: number;
  group?: EditorGutterGroup;
  groupPosition?: "single" | "start" | "middle" | "end";
  hasMarker: boolean;
  width: number;
};

type GutterColumn = {
  gutter: NamedEditorGutter;
  width: number;
};

export type EditorGutterState = {
  gutters: readonly NamedEditorGutter[];
  activeColumns: readonly GutterColumn[];
  markers: RangeSet<EditorGutterLineMarker>;
  /** True while the displayed markers await a refresh for the new document. */
  stale: boolean;
};

export { setEditorGuttersEffect } from "./gutter_effects.ts";

const emptyEditorGutterState: EditorGutterState = {
  gutters: [],
  activeColumns: [],
  markers: RangeSet.empty,
  stale: false,
};

export const editorGutterState = StateField.define<EditorGutterState>({
  create: () => emptyEditorGutterState,

  update(value: EditorGutterState, transaction: Transaction) {
    let gutters = value.gutters;
    let hasGutterUpdate = false;
    for (const effect of transaction.effects) {
      if (effect.is(setEditorGuttersEffect)) {
        gutters = effect.value;
        hasGutterUpdate = true;
      }
    }

    // Providers usually calculate annotations asynchronously after an edit.
    // Keep the previous render in place while they do that. RangeSet.map is
    // cheap and keeps markers attached to the document as it changes, so the
    // gutter doesn't flash empty on every keystroke.
    if (transaction.docChanged && !hasGutterUpdate) {
      return {
        ...value,
        markers: value.markers.map(transaction.changes),
        stale: value.markers.size > 0,
      };
    }

    if (!hasGutterUpdate && gutters === value.gutters) {
      return value;
    }
    return {
      ...buildEditorGutterState(transaction.state, gutters),
      stale: false,
    };
  },
});

/**
 * Adds the single dynamic gutter used by plug-provided line annotations.
 * The field is initialized separately for each editor state so a rebuild can
 * preserve the current page's annotations without retaining another page's.
 */
export function editorGutterExtension(
  pagePath: string,
  initial: readonly NamedEditorGutter[],
): Extension {
  const initialGutters = cloneNamedGutters(initial);
  return [
    editorGutterState.init((state) =>
      buildEditorGutterState(state, initialGutters),
    ),
    gutter({
      class: "sb-plugin-gutter",
      markers: (view) => view.state.field(editorGutterState).markers,
      initialSpacer: (view) =>
        new EditorGutterSpacerMarker(
          view.state.field(editorGutterState).activeColumns,
        ),
      updateSpacer: (spacer, update) => {
        const next = new EditorGutterSpacerMarker(
          update.state.field(editorGutterState).activeColumns,
        );
        return spacer instanceof EditorGutterSpacerMarker && spacer.eq(next)
          ? spacer
          : next;
      },
      domEventHandlers: {
        click: (view, line, event) =>
          handleEditorGutterClick(pagePath, view, line, event),
        keydown: (view, line, event) =>
          handleEditorGutterKeydown(pagePath, view, line, event),
      },
    }),
    editorGutterPositionExtension,
    editorGutterDiffExtension,
  ];
}

export class EditorGutterStore {
  private readonly gutters = new Map<string, StoredEditorGutter>();

  set(
    owner: string,
    id: string,
    page: string,
    gutter: EditorGutterDefinition,
  ): void {
    this.gutters.set(storeKey(owner, id), {
      owner,
      id,
      page,
      gutter: cloneGutter(gutter),
    });
  }

  clear(owner: string, id: string, page?: string): boolean {
    const key = storeKey(owner, id);
    const current = this.gutters.get(key);
    if (!current || (page !== undefined && current.page !== page)) {
      return false;
    }
    return this.gutters.delete(key);
  }

  clearOwner(owner: string): boolean {
    let changed = false;
    for (const [key, gutter] of this.gutters) {
      if (gutter.owner === owner) {
        changed = this.gutters.delete(key) || changed;
      }
    }
    return changed;
  }

  clearPage(page: string): boolean {
    let changed = false;
    for (const [key, gutter] of this.gutters) {
      if (gutter.page === page) {
        changed = this.gutters.delete(key) || changed;
      }
    }
    return changed;
  }

  forPage(page: string): NamedEditorGutter[] {
    const result: NamedEditorGutter[] = [];
    for (const gutter of this.gutters.values()) {
      if (gutter.page !== page) {
        continue;
      }
      result.push({
        id: publicGutterId(gutter.owner, gutter.id),
        ...cloneGutter(gutter.gutter),
      });
    }
    return result;
  }
}

/**
 * Validates and normalizes the data crossing the plug syscall boundary.
 * Invalid rows are rejected before they can reach CodeMirror's DOM layer.
 */
export function normalizeEditorGutter(value: unknown): EditorGutterDefinition {
  if (!value || typeof value !== "object") {
    throw new Error("editor.setGutter expects a gutter object");
  }

  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.markers)) {
    throw new Error("editor.setGutter expects a markers array");
  }
  if (input.markers.length > MAX_GUTTER_MARKERS) {
    throw new Error(
      `editor.setGutter accepts at most ${MAX_GUTTER_MARKERS} markers`,
    );
  }

  const markersByLine = new Map<number, EditorGutterMarker>();
  for (const marker of input.markers) {
    if (!marker || typeof marker !== "object") {
      throw new Error("editor.setGutter markers must be objects");
    }
    const item = marker as Record<string, unknown>;
    if (
      typeof item.line !== "number" ||
      !Number.isInteger(item.line) ||
      item.line < 1
    ) {
      throw new Error(
        "editor.setGutter marker lines must be positive integers",
      );
    }
    if (typeof item.text !== "string") {
      throw new Error("editor.setGutter marker text must be a string");
    }
    if (item.title !== undefined && typeof item.title !== "string") {
      throw new Error("editor.setGutter marker titles must be strings");
    }
    if (item.className !== undefined && typeof item.className !== "string") {
      throw new Error("editor.setGutter marker className must be a string");
    }
    if (
      item.revisionLine !== undefined &&
      (typeof item.revisionLine !== "number" ||
        !Number.isInteger(item.revisionLine) ||
        item.revisionLine < 1)
    ) {
      throw new Error(
        "editor.setGutter marker revisionLine must be a positive integer",
      );
    }
    if (
      item.rev !== undefined &&
      (typeof item.rev !== "string" || !/^[0-9a-f]{40}$/i.test(item.rev))
    ) {
      throw new Error(
        "editor.setGutter marker revisions must be 40-character hexadecimal hashes",
      );
    }

    markersByLine.set(item.line, {
      line: item.line,
      text: item.text,
      title: item.title as string | undefined,
      className: safeClassNames(item.className as string | undefined),
      rev: item.rev as string | undefined,
      revisionLine: item.revisionLine as number | undefined,
    });
  }

  const width = input.width;
  if (
    width !== undefined &&
    (typeof width !== "number" ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > MAX_GUTTER_WIDTH)
  ) {
    throw new Error(
      `editor.setGutter width must be an integer between 1 and ${MAX_GUTTER_WIDTH}`,
    );
  }
  if (input.className !== undefined && typeof input.className !== "string") {
    throw new Error("editor.setGutter className must be a string");
  }

  return {
    markers: [...markersByLine.values()].sort((a, b) => a.line - b.line),
    width: width as number | undefined,
    className: safeClassNames(input.className as string | undefined),
  };
}

/** Handles clicks on a real marker, leaving filler cells to the editor. */
export function handleEditorGutterClick(
  pagePath: string,
  view: EditorView,
  line: BlockInfo,
  event: Event,
): boolean {
  if (!pagePath || !pagePath.toLowerCase().endsWith(".md")) {
    return false;
  }
  // The displayed cells are intentionally kept during an async refresh, but
  // their line metadata may no longer describe the current document.
  if (view.state.field(editorGutterState).stale) {
    return false;
  }
  if (
    "button" in event &&
    typeof (event as MouseEvent).button === "number" &&
    (event as MouseEvent).button !== 0
  ) {
    return false;
  }

  const gutterId = gutterIdFromEvent(event);
  if (!gutterId) {
    return false;
  }

  const cursor = view.state.field(editorGutterState).markers.iter(line.from);
  if (!cursor.value || cursor.from !== line.from) {
    return false;
  }
  const cell = cursor.value.cells.find((item) => item.gutterId === gutterId);
  if (!cell?.hasMarker) {
    return false;
  }

  if (!cell.group) {
    return false;
  }
  openEditorGutterDiff(view, pagePath, cell.group);
  return true;
}

export function handleEditorGutterKeydown(
  pagePath: string,
  view: EditorView,
  line: BlockInfo,
  event: Event,
): boolean {
  const key = (event as KeyboardEvent).key;
  if (key !== "Enter" && key !== " ") {
    return false;
  }
  return handleEditorGutterClick(pagePath, view, line, event);
}

export function validateEditorGutterId(id: unknown): asserts id is string {
  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    id.length > 100 ||
    [...id].some((char) => char.charCodeAt(0) < 0x20)
  ) {
    throw new Error(
      "editor.setGutter expects a non-empty gutter id without control characters",
    );
  }
}

export function gutterOwnerForPlug(plug: string | undefined): string {
  return plug || CORE_GUTTER_OWNER;
}

const GUTTER_CONTENT_GAP_PX = 8;

/** Returns the visual offset that places the gutter just before the content. */
export function editorGutterOffset(
  contentLeft: number,
  gutterRight: number,
  currentOffset = 0,
): number {
  return Math.max(
    0,
    contentLeft - GUTTER_CONTENT_GAP_PX - (gutterRight - currentOffset),
  );
}

/** Keeps the plug gutter beside the centered editor column on wide screens. */
export const editorGutterPositionExtension = ViewPlugin.fromClass(
  class {
    private offset = 0;
    private element?: HTMLElement;
    private readonly resizeObserver?: ResizeObserver;

    constructor(readonly view: EditorView) {
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.measure());
        this.resizeObserver.observe(view.dom);
      }
      this.measure();
    }

    update(update: ViewUpdate): void {
      // A gutter update is a state effect rather than a document change. The
      // gutter DOM is created after this callback, so measure after every
      // transaction to catch its first asynchronous insertion as well.
      if (
        update.geometryChanged ||
        update.docChanged ||
        update.transactions.length > 0
      ) {
        this.measure();
      }
    }

    docViewUpdate(): void {
      this.measure();
    }

    destroy(): void {
      this.resizeObserver?.disconnect();
      const gutter = this.gutterElement();
      if (gutter) {
        gutter.style.transform = "";
      }
    }

    private measure(): void {
      this.view.requestMeasure({
        key: this,
        read: () => {
          const gutter = this.gutterElement();
          if (!gutter) {
            return undefined;
          }
          const content = this.view.contentDOM.getBoundingClientRect();
          const gutterBox = gutter.getBoundingClientRect();
          return {
            gutter,
            offset: editorGutterOffset(
              content.left,
              gutterBox.right,
              gutter === this.element ? this.offset : 0,
            ),
          };
        },
        write: (measurement) => {
          if (!measurement) {
            return;
          }
          this.element = measurement.gutter;
          this.offset = measurement.offset;
          measurement.gutter.style.transform = measurement.offset
            ? `translateX(${measurement.offset}px)`
            : "";
        },
      });
    }

    private gutterElement(): HTMLElement | null {
      return this.view.dom.querySelector<HTMLElement>(".sb-plugin-gutter");
    }
  },
);

export class EditorGutterLineMarker extends GutterMarker {
  constructor(readonly cells: readonly GutterCell[]) {
    super();
  }

  override elementClass = "sb-editor-gutter-marker";

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof EditorGutterLineMarker &&
      sameCells(this.cells, other.cells)
    );
  }

  override toDOM(_view: EditorView): Node {
    return renderCells(this.cells, false);
  }
}

class EditorGutterSpacerMarker extends GutterMarker {
  constructor(readonly columns: readonly GutterColumn[]) {
    super();
  }

  override elementClass = "sb-editor-gutter-spacer";

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof EditorGutterSpacerMarker &&
      this.columns.length === other.columns.length &&
      this.columns.every(
        (column, index) =>
          column.gutter.id === other.columns[index].gutter.id &&
          column.width === other.columns[index].width,
      )
    );
  }

  override toDOM(_view: EditorView): Node {
    return renderCells(
      this.columns.map((column) => ({
        gutterId: column.gutter.id,
        text: "",
        width: column.width,
        className: column.gutter.className,
        hasMarker: false,
      })),
      true,
    );
  }
}

function buildEditorGutterState(
  state: EditorState,
  input: readonly NamedEditorGutter[],
): EditorGutterState {
  const gutters = cloneNamedGutters(input);
  const columns = gutters.map((gutter) => ({
    gutter,
    width: widthOf(gutter),
  }));
  const cellsByLine = new Map<number, Map<string, GutterCell>>();

  for (const column of columns) {
    const markersByLine = new Map<number, EditorGutterMarker>();
    for (const marker of column.gutter.markers) {
      if (marker.line >= 1 && marker.line <= state.doc.lines) {
        markersByLine.set(marker.line, marker);
      }
    }
    const markers = [...markersByLine.values()].sort((a, b) => a.line - b.line);

    for (let start = 0; start < markers.length; ) {
      let end = start;
      while (
        end + 1 < markers.length &&
        markers[end + 1].line === markers[end].line + 1 &&
        sameRevision(markers[end + 1].rev, markers[start].rev)
      ) {
        end++;
      }

      const groupMarkers = markers.slice(start, end + 1);
      const group = makeGutterGroup(column.gutter.id, groupMarkers);
      for (let index = start; index <= end; index++) {
        const marker = markers[index];
        let lineCells = cellsByLine.get(marker.line);
        if (!lineCells) {
          lineCells = new Map();
          cellsByLine.set(marker.line, lineCells);
        }
        lineCells.set(column.gutter.id, {
          gutterId: column.gutter.id,
          text: marker.text,
          title: marker.title,
          className: joinClassNames(column.gutter.className, marker.className),
          rev: marker.rev,
          revisionLine: marker.revisionLine,
          group,
          groupPosition:
            groupMarkers.length === 1
              ? "single"
              : index === start
                ? "start"
                : index === end
                  ? "end"
                  : "middle",
          hasMarker: true,
          width: column.width,
        });
      }
      start = end + 1;
    }
  }

  const activeColumns = columns.filter((column) =>
    [...cellsByLine.values()].some((line) => line.has(column.gutter.id)),
  );
  const builder = new RangeSetBuilder<EditorGutterLineMarker>();
  for (const lineNumber of [...cellsByLine.keys()].sort((a, b) => a - b)) {
    const lineCells = cellsByLine.get(lineNumber)!;
    const cells = activeColumns.map(
      (column): GutterCell =>
        lineCells.get(column.gutter.id) || {
          gutterId: column.gutter.id,
          text: "",
          width: column.width,
          className: column.gutter.className,
          hasMarker: false,
        },
    );
    const line = state.doc.line(lineNumber);
    builder.add(line.from, line.from, new EditorGutterLineMarker(cells));
  }

  return {
    gutters,
    activeColumns,
    markers: builder.finish(),
    stale: false,
  };
}

function makeGutterGroup(
  gutterId: string,
  markers: readonly EditorGutterMarker[],
): EditorGutterGroup {
  const first = markers[0];
  const last = markers[markers.length - 1];
  const revisionLines = [
    ...new Set(markers.map((marker) => marker.revisionLine ?? marker.line)),
  ];
  return {
    id: `${gutterId}:${first.line}:${first.rev ?? "uncommitted"}`,
    gutterId,
    rev: first.rev,
    startLine: first.line,
    endLine: last.line,
    revisionLines,
    revisionStartLine: Math.min(...revisionLines),
    revisionEndLine: Math.max(...revisionLines),
  };
}

function sameRevision(first: string | undefined, second: string | undefined) {
  return first?.toLowerCase() === second?.toLowerCase();
}

function widthOf(gutter: EditorGutterDefinition): number {
  if (gutter.width !== undefined) {
    return gutter.width;
  }
  if (gutter.markers.length === 0) {
    return 1;
  }
  let width = 1;
  for (const marker of gutter.markers) {
    width = Math.max(width, marker.text.length);
  }
  return Math.min(MAX_GUTTER_WIDTH, width);
}

function sameGroups(
  first: EditorGutterGroup | undefined,
  second: EditorGutterGroup | undefined,
): boolean {
  if (!first || !second) return first === second;
  return (
    first.id === second.id &&
    first.gutterId === second.gutterId &&
    first.rev === second.rev &&
    first.startLine === second.startLine &&
    first.endLine === second.endLine &&
    sameNumberArray(first.revisionLines, second.revisionLines) &&
    first.revisionStartLine === second.revisionStartLine &&
    first.revisionEndLine === second.revisionEndLine
  );
}

function sameNumberArray(first: readonly number[], second: readonly number[]) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function renderCells(
  cells: readonly GutterCell[],
  spacer: boolean,
): HTMLElement {
  const root = document.createElement("span");
  root.className = spacer
    ? "sb-editor-gutter-line sb-editor-gutter-spacer-line"
    : "sb-editor-gutter-line";
  for (const cell of cells) {
    const element = document.createElement("span");
    element.className = "sb-editor-gutter-cell";
    if (!spacer) {
      element.classList.add(gutterIdClass(cell.gutterId));
      if (cell.className) {
        element.classList.add(...cell.className.split(" "));
      }
      if (cell.groupPosition) {
        element.classList.add(`sb-editor-gutter-group-${cell.groupPosition}`);
      }
      element.dataset.gutterId = cell.gutterId;
      if (cell.group) {
        element.dataset.gutterGroupId = cell.group.id;
      }
      if (cell.hasMarker) {
        element.classList.add("sb-editor-gutter-clickable");
        element.setAttribute("role", "button");
        element.tabIndex = 0;
      }
    }
    element.textContent = spacer
      ? " ".repeat(cell.width)
      : cell.groupPosition === "middle" || cell.groupPosition === "end"
        ? ""
        : cell.text;
    // The cell uses border-box sizing, so include its horizontal padding in
    // the inline width. This keeps the longest marker fully visible.
    element.style.width = `calc(${cell.width}ch + ${GUTTER_CELL_HORIZONTAL_PADDING})`;
    if (!spacer && cell.title) {
      element.title = cell.title;
    }
    root.appendChild(element);
  }
  return root;
}

function sameCells(
  a: readonly GutterCell[],
  b: readonly GutterCell[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (cell, index) =>
        cell.gutterId === b[index].gutterId &&
        cell.text === b[index].text &&
        cell.title === b[index].title &&
        cell.className === b[index].className &&
        cell.rev === b[index].rev &&
        cell.revisionLine === b[index].revisionLine &&
        sameGroups(cell.group, b[index].group) &&
        cell.groupPosition === b[index].groupPosition &&
        cell.hasMarker === b[index].hasMarker &&
        cell.width === b[index].width,
    )
  );
}

function cloneNamedGutters(
  gutters: readonly NamedEditorGutter[],
): NamedEditorGutter[] {
  return gutters.map((gutter) => ({
    id: gutter.id,
    ...cloneGutter(gutter),
  }));
}

function cloneGutter(gutter: EditorGutterDefinition): EditorGutterDefinition {
  return {
    markers: gutter.markers.map((marker) => ({ ...marker })),
    width: gutter.width,
    className: gutter.className,
  };
}

function storeKey(owner: string, id: string): string {
  return `${owner}\u0000${id}`;
}

function publicGutterId(owner: string, id: string): string {
  return owner === CORE_GUTTER_OWNER ? id : `${owner}/${id}`;
}

function gutterIdClass(id: string): string {
  return `sb-editor-gutter-${id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function safeClassNames(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const names = value
    .split(/\s+/)
    .filter((name) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(name));
  return names.length > 0 ? names.join(" ") : undefined;
}

function joinClassNames(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  return [first, second].filter(Boolean).join(" ") || undefined;
}

function gutterIdFromEvent(event: Event): string | undefined {
  const target = event.target;
  if (!target || typeof target !== "object") {
    return undefined;
  }
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") {
    return undefined;
  }
  const cell = closest.call(target, ".sb-editor-gutter-cell") as {
    dataset?: { gutterId?: string };
  } | null;
  return cell?.dataset?.gutterId;
}
