import { relativeTime } from "@silverbulletmd/silverbullet/lib/dates";
import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import { type DiffLine, openPreview, parseDiff } from "./revision_preview.ts";
import {
  type BuiltinView,
  baseMeta,
  type Decoration,
  EXPAND_ROW,
} from "./types.ts";

const PATH_SLASH = "∕";
const UNCOMMITTED = "@uncommitted";

/** Commits changed without any file changing, so nothing else would refresh. */
export const REVISIONS_CHANGED_EVENT = "revisions:snapshot";

/** Both views dock here, and the preview hands focus back to it on close. */
const DOCK = "rhs";

type RevisionRow = {
  name: string;
  page: string;
  rev?: string;
  author?: string;
  message?: string;
  timestamp?: number;
  added?: number;
  removed?: number;
};

const CHIP_LOCALE = "en-US";

/** The precise timestamp behind a row's relative one -- header text, tooltips. */
function exactTime(timestamp: number): string {
  const d = new Date(timestamp);
  const datePart = d.toLocaleDateString(CHIP_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const timePart = d.toLocaleTimeString(CHIP_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${datePart} ${timePart}`;
}

function hasDiff(entry: { added?: number; removed?: number }): boolean {
  return entry.added !== undefined || entry.removed !== undefined;
}

function diffText(entry: { added?: number; removed?: number }): string {
  return `+${entry.added ?? 0} −${entry.removed ?? 0}`;
}

function commitDecorations(entry: {
  added?: number;
  removed?: number;
  timestamp?: number;
}): Decoration[] | undefined {
  if (!entry.timestamp) return undefined;
  const decorations: Decoration[] = [];
  if (hasDiff(entry)) {
    decorations.push({ text: diffText(entry), position: "right" });
  }
  decorations.push({
    text: relativeTime(entry.timestamp, CHIP_LOCALE),
    title: exactTime(entry.timestamp),
    position: "right",
  });
  return decorations;
}

async function pageHistoryRows(): Promise<RevisionRow[]> {
  const path = await editor.getCurrentPath();
  if (!path.endsWith(".md")) return [];
  let listing;
  try {
    listing = await space.listRevisions(path, undefined);
  } catch {
    return [];
  }
  const rows: RevisionRow[] = [];
  if (listing.uncommitted) {
    rows.push({ name: UNCOMMITTED, page: path });
  }
  for (const r of listing.revisions) {
    rows.push({
      name: r.rev,
      page: path,
      rev: r.rev,
      author: r.author,
      message: r.message,
      timestamp: r.timestamp,
      added: r.added,
      removed: r.removed,
    });
  }
  return rows;
}

/** Mirrors `builtins.ts`'s gate for a `requireMode: "rw"` row action. */
async function isReadOnly(): Promise<boolean> {
  if ((await system.getMode()) === "ro") return true;
  return (await editor.getUiOption("forcedROMode")) === true;
}

/**
 * The uncommitted row's preview: the working-tree change, and nothing else --
 * there is no revision to read whole content from, and "restoring" a version
 * to itself would mean nothing.
 */
async function showUncommittedPreview(
  page: string,
  focus: boolean,
): Promise<false | undefined> {
  let diff: DiffLine[];
  try {
    diff = parseDiff(await space.getRevisionDiff(page));
  } catch {
    // A 404 here means it matches HEAD after all (the row is a moment stale).
    diff = parseDiff("Nothing uncommitted for this page.");
  }
  openPreview({
    path: page,
    header: `${page} \u2014 uncommitted`,
    message: "Not committed yet",
    diff,
    canRestore: false,
    focus,
    dock: DOCK,
  });
  return false;
}

async function showRevisionPreview(
  obj: RevisionRow,
  focus: boolean,
): Promise<false | undefined> {
  if (!obj.rev) return showUncommittedPreview(obj.page, focus);
  let diff: DiffLine[] | undefined;
  try {
    diff = parseDiff(await space.getRevisionDiff(obj.page, obj.rev));
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 404) {
      // A merge commit (or otherwise nothing to diff against a parent):
      // still worth the toggle, the Diff pane just has nothing to color.
      diff = parseDiff("No diff for this commit.");
    }
    // Any other failure (an older server without `format=diff` support, a
    // transport error, ...) leaves `diff` unset: the preview opens on the
    // content view, with nothing to toggle to.
  }
  const meta = [
    obj.author,
    obj.timestamp ? exactTime(obj.timestamp) : undefined,
    hasDiff(obj) ? diffText(obj) : undefined,
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
  openPreview({
    path: obj.page,
    rev: obj.rev,
    header: `${obj.page} @ ${obj.rev.slice(0, 8)}${meta ? ` \u2014 ${meta}` : ""}`,
    message: obj.message ?? "",
    diff,
    canRestore: !(await isReadOnly()),
    focus,
    dock: DOCK,
  });
  return false;
}

function previewRevision(obj: RevisionRow): Promise<false | undefined> {
  return showRevisionPreview(obj, true);
}

function peekRevision(obj: RevisionRow): Promise<false | undefined> {
  return showRevisionPreview(obj, false);
}

async function restoreRevision(obj: RevisionRow): Promise<void> {
  if (!obj.rev) return;
  const currentPath = await editor.getCurrentPath();
  if (currentPath !== obj.page) return;
  const text = await space.getRevision(obj.page, obj.rev);
  await editor.setText(text, true);
  await editor.flashNotification(`Restored revision ${obj.rev.slice(0, 8)}`);
}

export const pageHistoryView: BuiltinView<RevisionRow> = {
  meta: baseMeta({
    title: "Page History",
    noFilter: true,
    mode: "tree",
    dock: DOCK,
    expandAll: true,
    expansionScope: "page",
    foldersFirst: false,
    hasRowIcon: true,
    refreshOn: [
      "editor:pageLoaded",
      "editor:documentLoaded",
      "editor:pageModified",
      REVISIONS_CHANGED_EVENT,
    ],
    refreshOnOpen: true,
  }),
  row: {
    primary: (obj) =>
      obj.rev ? obj.author || obj.rev.slice(0, 8) : "Uncommitted changes",
    label: (obj) =>
      obj.rev ? obj.author || obj.rev.slice(0, 8) : "Uncommitted changes",
    decorations: (obj) => (obj.rev ? commitDecorations(obj) : undefined),
    icon: (obj) => (obj.rev ? "clock" : "edit-3"),
    cssClass: () => "sb-nav-noband",
  },
  actions: [
    {
      icon: "rotate-ccw",
      label: "Restore",
      requireMode: "rw",
      when: (obj) => !!obj.rev,
      run: restoreRevision,
    },
  ],
  keymap: { " ": peekRevision },
  source: pageHistoryRows,
  onSelect: previewRevision,
};

type LogRow = {
  name: string;
  rev: string;
  file?: string;
  author?: string;
  message?: string;
  timestamp?: number;
  added?: number;
  removed?: number;
};

async function spaceLogRows(): Promise<LogRow[]> {
  let log;
  try {
    log = await space.getSpaceLog(undefined);
  } catch {
    return [];
  }
  const rows: LogRow[] = [];
  // A pseudo-commit for what is not committed yet, expanding to the files it
  // covers exactly as a real commit row does.
  const uncommitted = log.uncommitted ?? [];
  if (uncommitted.length > 0) {
    rows.push({ name: UNCOMMITTED, rev: UNCOMMITTED });
    for (const path of uncommitted) {
      rows.push({
        name: `${UNCOMMITTED}/${path.replaceAll("/", PATH_SLASH)}`,
        rev: UNCOMMITTED,
        file: path,
      });
    }
  }
  for (const c of log.commits) {
    rows.push({
      name: c.rev,
      rev: c.rev,
      author: c.author,
      message: c.message,
      timestamp: c.timestamp,
      added: c.added,
      removed: c.removed,
    });
    for (const f of c.files) {
      rows.push({
        name: `${c.rev}/${f.replaceAll("/", PATH_SLASH)}`,
        rev: c.rev,
        file: f,
        author: c.author,
        message: c.message,
        timestamp: c.timestamp,
      });
    }
  }
  return rows;
}

function logRowLabel(obj: LogRow): string {
  if (obj.file) return obj.file;
  if (obj.rev === UNCOMMITTED) return "Uncommitted changes";
  return obj.author || obj.rev.slice(0, 8);
}

/**
 * Only pages preview: the diff and the restore that goes with it are both
 * text operations, and an attachment has nothing useful to show or put back.
 */
function previewLogFile(
  obj: LogRow,
  focus: boolean,
): Promise<false | undefined> {
  if (!obj.file?.endsWith(".md")) return Promise.resolve(false);
  if (obj.rev === UNCOMMITTED) {
    return showUncommittedPreview(obj.file, focus);
  }
  return showRevisionPreview({ ...obj, page: obj.file }, focus);
}

export const spaceLogView: BuiltinView<LogRow> = {
  meta: baseMeta({
    title: "Space History",
    placeholder: "Page or author",
    mode: "tree",
    dock: DOCK,
    foldersFirst: false,
    hasRowIcon: true,
    // Unlike Page History (one page's revisions, all of them worth scanning),
    // this spans the whole space -- filtering is how you find a page in it.
    filterFields: { primary: { weight: 1.0, segments: true }, message: 0.8 },
    refreshOn: ["file:changed", "file:deleted", REVISIONS_CHANGED_EVENT],
    refreshOnOpen: true,
  }),
  row: {
    primary: (obj) => logRowLabel(obj),
    label: (obj) => logRowLabel(obj),
    decorations: (obj) => (obj.file ? undefined : commitDecorations(obj)),
    icon: (obj) =>
      obj.file
        ? "file-text"
        : obj.rev === UNCOMMITTED
          ? "edit-3"
          : "git-commit",
    cssClass: () => "sb-nav-noband",
  },
  source: spaceLogRows,
  onSelect: (obj) => {
    // A commit row's only meaningful selection is opening it up; the pages it
    // touched preview exactly like a Page History row does.
    if (!obj.file) return Promise.resolve(EXPAND_ROW);
    return previewLogFile(obj, true);
  },
  keymap: { " ": (obj) => previewLogFile(obj, false) },
};
