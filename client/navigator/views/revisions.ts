import { base64EncodedDataUrl } from "@silverbulletmd/silverbullet/lib/crypto";
import { relativeTime } from "@silverbulletmd/silverbullet/lib/dates";
import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import type {
  FileStatus,
  GitConflict,
  GitConflictAction,
  SyncState,
} from "@silverbulletmd/silverbullet/type/revisions";
import {
  editor,
  events,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import {
  type DiffLine,
  openPreview,
  parseDiff,
  restoreInto,
} from "./revision_preview.ts";
import {
  type BuiltinView,
  baseMeta,
  type Decoration,
  EXPAND_ROW,
  type SourceCtx,
} from "./types.ts";

import { loadGitSyncStatus } from "../../git_sync_status.ts";
import { syncStatusText } from "../../sync_notification.ts";

const STATUS_ICONS: Record<FileStatus, string> = {
  added: "file-plus",
  modified: "file-text",
  deleted: "file-minus",
  renamed: "corner-up-right",
};

const PATH_SLASH = "∕";
const UNCOMMITTED = "@uncommitted";
const MORE = "@more";

const OFFLINE = "Revision history unavailable — offline.";
const DISABLED = "Revision history is off for this space.";

export const SYNC_CONFLICT = (n: number) =>
  `Sync paused — ${n} ${n === 1 ? "page has" : "pages have"} conflicting changes.`;
export const SYNC_ERROR = "Sync failed — check the space's git settings.";
export const SYNC_PAUSED = (reason: string) => `Sync paused — ${reason}.`;

/** Row name for the synthetic sync-status header; never a real commit rev. */
const SYNC_HEADER = "@sync";

function syncHeaderText(sync: SyncState): string | undefined {
  switch (sync.state) {
    case "conflicted":
      return SYNC_CONFLICT(sync.paths.length);
    case "paused":
      return SYNC_PAUSED(sync.reason);
    case "error":
      return SYNC_ERROR;
    default:
      return undefined;
  }
}

type Accumulator<T> = {
  key: string;
  rows: T[];
  more: boolean;
  cursor?: string;
  pending: boolean;
  loading: boolean;
};

/** A 404 means this server has no revisions route; anything else that got
 * here is a transport failure, which must not read as an empty history. */
function describeFailure(e: unknown): Error {
  const status = (e as { status?: number } | undefined)?.status;
  if (status === 404) return new Error(DISABLED);
  return new Error(OFFLINE);
}

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

let pageAcc: Accumulator<RevisionRow> | undefined;

async function fetchPageHistoryPage(
  path: string,
  before: string | undefined,
): Promise<{ rows: RevisionRow[]; more: boolean; cursor?: string }> {
  let listing;
  try {
    listing = await space.listRevisions(path, before);
  } catch (e) {
    throw describeFailure(e);
  }
  if (listing.mode === "disabled") throw new Error(DISABLED);
  const rows: RevisionRow[] = [];
  // The uncommitted flag describes the working tree right now, not this
  // page of history -- only the first page shows the pseudo-row for it.
  if (before === undefined && listing.uncommitted) {
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
  return { rows, more: listing.more, cursor: listing.revisions.at(-1)?.rev };
}

async function pageHistoryRows(): Promise<RevisionRow[]> {
  const path = await editor.getCurrentPath();
  if (!path.endsWith(".md")) {
    pageAcc = undefined;
    return [];
  }
  if (!pageAcc?.pending || pageAcc.key !== path) {
    const { rows, more, cursor } = await fetchPageHistoryPage(path, undefined);
    pageAcc = { key: path, rows, more, cursor, pending: false, loading: false };
  }
  pageAcc.pending = false;
  return pageAcc.more
    ? [...pageAcc.rows, { name: MORE, page: path }]
    : pageAcc.rows;
}

/** Returns whether it actually fetched a page -- false for the no-op path
 * (a stale row, or a fetch already in flight), so the caller only dispatches
 * a refresh when there is something new to show. Without this, a second
 * click landing on the guard above would still fire the refresh event, and
 * that spurious `rows()` call (not `pending`, since no extension happened
 * under it) would flash the panel back to a fresh page 1 while the real
 * extension is still in flight. */
async function loadMorePageHistory(path: string): Promise<boolean> {
  if (!pageAcc || pageAcc.key !== path || !pageAcc.more || pageAcc.loading) {
    return false;
  }
  const inProgress = pageAcc;
  inProgress.loading = true;
  try {
    const { rows, more, cursor } = await fetchPageHistoryPage(
      path,
      inProgress.cursor,
    );
    pageAcc = {
      key: path,
      rows: [...inProgress.rows, ...rows],
      more,
      cursor,
      pending: true,
      loading: false,
    };
    return true;
  } catch (e) {
    inProgress.loading = false;
    throw e;
  }
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

/** A deletion commit has no content of its own, so "restore this" can only
 * mean the version immediately before it. */
async function revisionText(
  page: string,
  rev: string,
): Promise<{ text: string; fromParent: boolean }> {
  try {
    return { text: await space.getRevision(page, rev), fromParent: false };
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status !== 404) throw e;
    return {
      text: await space.getRevision(page, rev, true),
      fromParent: true,
    };
  }
}

async function restoreRevision(obj: RevisionRow): Promise<void> {
  if (!obj.rev) return;
  const { text, fromParent } = await revisionText(obj.page, obj.rev);
  await restoreInto(obj.page, text);
  await editor.flashNotification(
    fromParent
      ? `Restored ${obj.page} as it was before ${obj.rev.slice(0, 8)}`
      : `Restored revision ${obj.rev.slice(0, 8)}`,
  );
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
      obj.name === MORE
        ? "Load more…"
        : obj.rev
          ? obj.author || obj.rev.slice(0, 8)
          : "Uncommitted changes",
    label: (obj) =>
      obj.name === MORE
        ? "Load more…"
        : obj.rev
          ? obj.author || obj.rev.slice(0, 8)
          : "Uncommitted changes",
    decorations: (obj) => (obj.rev ? commitDecorations(obj) : undefined),
    icon: (obj) =>
      obj.name === MORE ? "chevron-down" : obj.rev ? "clock" : "edit-3",
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
  keymap: {
    " ": (obj) => (obj.name === MORE ? false : peekRevision(obj)),
  },
  source: pageHistoryRows,
  onSelect: (obj) => {
    if (obj.name === MORE) {
      return loadMorePageHistory(obj.page).then(async (didLoad) => {
        if (didLoad) await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
        return false;
      });
    }
    return previewRevision(obj);
  },
};

type LogRow = {
  name: string;
  rev: string;
  file?: string;
  status?: FileStatus;
  author?: string;
  message?: string;
  timestamp?: number;
  added?: number;
  removed?: number;
  /** Set only on the synthetic sync-status rows this view prepends -- never
   * on a real commit or file row. */
  sync?: "header" | "path";
  syncEnabled?: boolean;
  syncConflicts?: boolean;
};

/** The non-selectable banner (and, for a conflict, its per-path links) shown
 * above the commit list -- see `syncHeaderText`. Empty once idle.
 *
 * A conflict set is one to three files, not the dozens a commit's file list
 * is designed for, so every path row's `name` is flat (no `/` at all, not
 * even a shared `${SYNC_HEADER}/` prefix) -- unlike a commit's files, they
 * must never nest under the header as children hidden behind an expand
 * click. The header carries the one-glance alarm; hiding which pages are
 * affected behind an extra click would make it less useful, not tidier. */
function syncRows(sync: SyncState | null | undefined): LogRow[] {
  if (!sync) return [];
  const text = syncHeaderText(sync);
  if (!text) return [];
  const rows: LogRow[] = [
    {
      name: SYNC_HEADER,
      rev: SYNC_HEADER,
      message: text,
      sync: "header",
      syncConflicts: sync.state === "conflicted",
    },
  ];
  if (sync.state === "conflicted") {
    for (const path of sync.paths) {
      rows.push({
        name: `${SYNC_HEADER}${PATH_SLASH}${path.replaceAll("/", PATH_SLASH)}`,
        rev: SYNC_HEADER,
        file: path,
        sync: "path",
      });
    }
  }
  return rows;
}

let logAcc: Accumulator<LogRow> | undefined;

async function fetchSpaceLogPage(
  phrase: string | undefined,
  before: string | undefined,
): Promise<{ rows: LogRow[]; more: boolean; cursor?: string }> {
  let log;
  try {
    log = await space.getSpaceLog(before, phrase);
  } catch (e) {
    throw describeFailure(e);
  }
  if (log.mode === "disabled") throw new Error(DISABLED);
  const rows: LogRow[] = [];
  // The sync banner and, for a conflict, its per-path rows describe the
  // sync state right now, not this page of history -- only the first page
  // shows them.
  if (before === undefined) {
    const status = await loadGitSyncStatus();
    if (status.stale || status.snapshot?.enabled) {
      rows.push(gitStatusRow(status));
      if (status.snapshot?.sync.state === "conflicted")
        rows.push(...syncRows(status.snapshot.sync).slice(1));
    } else if (!status.snapshot) {
      rows.push(...syncRows(log.sync));
    }
  }
  // Only the first history page includes the current working-tree pseudo-row.
  if (before === undefined) {
    const uncommitted = log.uncommitted ?? [];
    if (uncommitted.length > 0) {
      rows.push({ name: UNCOMMITTED, rev: UNCOMMITTED });
      for (const f of uncommitted) {
        rows.push({
          name: `${UNCOMMITTED}/${f.path.replaceAll("/", PATH_SLASH)}`,
          rev: UNCOMMITTED,
          file: f.path,
          status: f.status,
        });
      }
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
        name: `${c.rev}/${f.path.replaceAll("/", PATH_SLASH)}`,
        rev: c.rev,
        file: f.path,
        status: f.status,
        author: c.author,
        message: c.message,
        timestamp: c.timestamp,
      });
    }
  }
  return { rows, more: log.more, cursor: log.commits.at(-1)?.rev };
}

async function spaceLogRows(ctx: SourceCtx): Promise<LogRow[]> {
  const key = ctx.phrase || "";
  if (!logAcc?.pending || logAcc.key !== key) {
    const { rows, more, cursor } = await fetchSpaceLogPage(
      ctx.phrase || undefined,
      undefined,
    );
    logAcc = { key, rows, more, cursor, pending: false, loading: false };
  }
  logAcc.pending = false;
  return logAcc.more
    ? [...logAcc.rows, { name: MORE, rev: MORE }]
    : logAcc.rows;
}

/** See `loadMorePageHistory`'s comment: the boolean return is what lets the
 * caller skip dispatching a refresh for a no-op click. */
async function loadMoreSpaceLog(): Promise<boolean> {
  if (!logAcc || !logAcc.more || logAcc.loading) return false;
  const inProgress = logAcc;
  inProgress.loading = true;
  try {
    const { rows, more, cursor } = await fetchSpaceLogPage(
      inProgress.key || undefined,
      inProgress.cursor,
    );
    logAcc = {
      key: inProgress.key,
      rows: [...inProgress.rows, ...rows],
      more,
      cursor,
      pending: true,
      loading: false,
    };
    return true;
  } catch (e) {
    inProgress.loading = false;
    throw e;
  }
}

function logRowLabel(obj: LogRow): string {
  if (obj.sync === "header") return obj.message ?? "";
  if (obj.name === MORE) return "Load more…";
  if (obj.file) return obj.file;
  if (obj.rev === UNCOMMITTED) return "Uncommitted changes";
  return obj.message || obj.author || obj.rev.slice(0, 8);
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
    placeholder: "Search commit message or author",
    mode: "tree",
    dock: DOCK,
    foldersFirst: false,
    hasRowIcon: true,
    refreshOn: ["file:changed", "file:deleted", REVISIONS_CHANGED_EVENT],
    refreshOnOpen: true,
    search: "source",
  }),
  row: {
    primary: (obj) => logRowLabel(obj),
    label: (obj) => logRowLabel(obj),
    decorations: (obj) => {
      if (obj.file) return undefined;
      const chips: Decoration[] = [];
      if (obj.message && obj.author) {
        chips.push({ text: obj.author, position: "right" });
      }
      chips.push(...(commitDecorations(obj) ?? []));
      return chips.length > 0 ? chips : undefined;
    },
    icon: (obj) =>
      obj.sync === "header"
        ? "alert-triangle"
        : obj.name === MORE
          ? "chevron-down"
          : obj.file
            ? STATUS_ICONS[obj.status ?? "modified"]
            : obj.rev === UNCOMMITTED
              ? "edit-3"
              : "git-commit",
    cssClass: () => "sb-nav-noband",
  },
  source: spaceLogRows,
  onSelect: (obj) => {
    // Banner rows are informational. Conflicted paths open the page directly:
    // there is no commit to preview.
    if (obj.sync === "header") return Promise.resolve(false);
    if (obj.sync === "path") {
      return editor.navigate({ path: obj.file as Path }).then(() => false);
    }
    if (obj.name === MORE) {
      return loadMoreSpaceLog().then(async (didLoad) => {
        if (didLoad) await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
        return false;
      });
    }
    // A commit row's only meaningful selection is opening it up; the pages it
    // touched preview exactly like a Page History row does.
    if (!obj.file) return Promise.resolve(EXPAND_ROW);
    return previewLogFile(obj, true);
  },
  keymap: {
    " ": (obj) =>
      obj.sync || obj.name === MORE ? false : previewLogFile(obj, false),
  },
  actions: [
    {
      icon: "rotate-ccw",
      label: "Restore",
      requireMode: "rw",
      when: (obj) =>
        !obj.sync && !!obj.file?.endsWith(".md") && obj.rev !== UNCOMMITTED,
      run: (obj) => restoreRevision({ ...obj, page: obj.file! }),
    },
    {
      icon: "refresh-cw",
      label: "Sync now",
      requireMode: "rw",
      when: (obj) => obj.sync === "header" && obj.syncEnabled === true,
      run: requestGitSync,
    },

    {
      icon: "alert-triangle",
      label: "Review conflicts",
      when: (obj) => obj.sync === "header" && obj.syncConflicts === true,
      run: async () =>
        (await import("../navigator.ts")).openView("std.gitConflicts"),
    },
  ],
};

function gitStatusRow(
  status: Awaited<ReturnType<typeof loadGitSyncStatus>>,
): LogRow {
  const previous = status.snapshot?.lastSuccess;
  return {
    name: SYNC_HEADER,
    rev: SYNC_HEADER,
    sync: "header",
    syncEnabled: status.snapshot?.enabled && !status.snapshot.paused,
    syncConflicts: status.snapshot?.sync.state === "conflicted",
    message: status.stale
      ? `Git status unavailable${previous ? ` · Last successful sync ${new Date(previous).toLocaleString()}` : ""}`
      : status.snapshot
        ? syncStatusText(status.snapshot)
        : "Git sync is not available for this space.",
  };
}

export const gitStatusView: BuiltinView<LogRow> = {
  meta: baseMeta({
    title: "Git status",
    mode: "list",
    dock: DOCK,
    noFilter: true,
    refreshOn: [REVISIONS_CHANGED_EVENT],
    refreshOnOpen: true,
  }),
  row: {
    primary: (row) => row.message ?? "Git status",
    icon: () => "git-branch",
  },
  source: async () => [gitStatusRow(await loadGitSyncStatus())],
  onSelect: async () => false,
  actions: spaceLogView.actions!.filter((action) => action.label !== "Restore"),
};

export async function requestGitSync(): Promise<void> {
  if (await isReadOnly()) return;
  try {
    await editor.save();
    await space.syncGitNow();
    await editor.flashNotification("Git sync requested");
  } catch (error: any) {
    await editor.flashNotification(
      error?.status === 403
        ? "Only writers can request Git sync."
        : error?.status === 404
          ? "Git sync is not available for this space."
          : "Could not sync. Review Git status; an administrator may need to repair the connection.",
      "error",
    );
  }
  await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
}

type ConflictRow = GitConflict & { name: string; generation: string };

function canResolve(row: GitConflict): boolean {
  return row.canResolve ?? row.kind !== "unsupported";
}

async function resolveConflict(
  row: ConflictRow,
  action: GitConflictAction,
): Promise<void> {
  if (await isReadOnly()) return;
  if (
    action === "delete" &&
    !(await editor.confirm(`Delete ${row.path} to resolve this conflict?`))
  )
    return;
  try {
    await editor.save();
    const result = await space.resolveGitConflict(
      row.id,
      row.generation,
      row.contentRevision,
      action,
    );
    await editor.flashNotification(
      result.conflicts.length
        ? `${row.path} resolved`
        : "All conflicts resolved. Resuming sync…",
    );
  } catch (error: any) {
    await editor.flashNotification(
      error?.status === 409 || error?.status === 428
        ? "This conflict changed. Review the refreshed file before choosing again."
        : "Could not resolve this conflict. Refresh and review the file before retrying.",
      "error",
    );
  }
  await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
}

async function downloadConflict(
  row: ConflictRow,
  side: "local" | "remote",
): Promise<void> {
  try {
    const content = await space.getGitConflictVersion(
      row.id,
      row.generation,
      side,
    );
    await editor.downloadFile(
      `${row.path.split("/").at(-1)}.${side}`,
      base64EncodedDataUrl("application/octet-stream", content),
    );
  } catch {
    await editor.flashNotification(
      "Could not download this version. Refresh the conflict list and try again.",
      "error",
    );
    await events.dispatchEvent(REVISIONS_CHANGED_EVENT, {});
  }
}

export const gitConflictsView: BuiltinView<ConflictRow> = {
  meta: baseMeta({
    title: "Git conflicts",
    emptyText:
      "No unresolved Git conflicts. Open Git status for sync progress.",
    dock: DOCK,
    mode: "list",
    noFilter: true,
    limit: 10000,
    refreshOn: ["file:changed", "file:deleted", REVISIONS_CHANGED_EVENT],
    refreshOnOpen: true,
  }),
  row: {
    primary: (row) => row.path,
    description: (row) =>
      row.kind === "text"
        ? "Edit the markers away to resume automatically"
        : row.kind === "deleteModify"
          ? "Deleted on one side; choose a version or deletion"
          : row.kind === "binary"
            ? "Binary file; choose which version to keep"
            : canResolve(row)
              ? "Choose a version, or save and keep an edited version"
              : "Unsupported file; resolve with Git on the server",
    icon: () => "alert-triangle",
  },
  source: async () => {
    const result = await space.getGitConflicts();
    return result.conflicts.map((conflict) => ({
      ...conflict,
      name: conflict.id,
      generation: result.generation,
    }));
  },
  onSelect: async (row) => {
    if (row.kind === "text") await editor.navigate({ path: row.path as Path });
    else
      await editor.flashNotification(
        !canResolve(row)
          ? "An administrator must resolve this file with Git on the server."
          : "Use this file's actions to keep This space, keep Remote repository, or keep the deletion.",
      );
    return false;
  },
  actions: [
    {
      icon: "check",
      label: "Keep This space",
      requireMode: "rw",
      when: (row) => canResolve(row) && row.local,
      run: (row) => resolveConflict(row, "local"),
    },
    {
      icon: "download",
      label: "Keep Remote repository",
      requireMode: "rw",
      when: (row) => canResolve(row) && row.remote,
      run: (row) => resolveConflict(row, "remote"),
    },
    {
      icon: "trash",
      label: "Keep deletion",
      requireMode: "rw",
      when: (row) => canResolve(row) && row.kind === "deleteModify",
      run: (row) => resolveConflict(row, "delete"),
    },
    {
      icon: "edit-3",
      label: "Keep edited version",
      requireMode: "rw",
      when: (row) => canResolve(row) && row.contentRevision !== "missing",
      run: (row) => resolveConflict(row, "edited"),
    },
    {
      icon: "download",
      label: "Download This space",
      when: (row) => row.local,
      run: (row) => downloadConflict(row, "local"),
    },
    {
      icon: "download",
      label: "Download Remote repository",
      when: (row) => row.remote,
      run: (row) => downloadConflict(row, "remote"),
    },
  ],
};
