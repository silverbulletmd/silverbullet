import { beforeEach, expect, test, vi } from "vitest";
import type { SpaceLog } from "@silverbulletmd/silverbullet/type/revisions";

const editor = {
  downloadFile: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
  getCurrentPath: vi.fn<() => Promise<string>>(async () => ""),
  navigate: vi.fn<(ref: unknown) => Promise<void>>(async () => {}),
  getUiOption: vi.fn<(name: string) => Promise<unknown>>(async () => false),
  setText: vi.fn<(text: string, isolateHistory?: boolean) => Promise<void>>(),
  flashNotification: vi.fn(async () => {}),
};
const events = { dispatchEvent: vi.fn(async () => [] as unknown[]) };
const space = {
  getGitSyncStatus: vi.fn(),
  getGitConflictVersion: vi.fn(),
  syncGitNow: vi.fn(async () => {}),
  getGitConflicts: vi.fn(),
  resolveGitConflict: vi.fn(),
  getSpaceLog: vi.fn<(before?: string, q?: string) => Promise<SpaceLog>>(),
  getRevisionDiff: vi.fn(),
  getRevision: vi.fn(),
};
const system = { getMode: vi.fn(async () => "rw") };

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  editor,
  events,
  space,
  system,
}));

const { spaceLogView, requestGitSync, gitConflictsView, gitStatusView } =
  await import("./revisions.ts");

function log(over: Partial<SpaceLog>): SpaceLog {
  return {
    mode: "managed",
    commits: [],
    more: false,
    uncommitted: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("shows nothing extra above the commit list when sync is idle", async () => {
  space.getSpaceLog.mockResolvedValueOnce(log({ sync: { state: "idle" } }));
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows).toEqual([]);
});

test("shows nothing extra when the server carries no sync field at all", async () => {
  space.getSpaceLog.mockResolvedValueOnce(log({}));
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows).toEqual([]);
});

test("shows nothing extra when Git sync is not configured", async () => {
  space.getSpaceLog.mockResolvedValueOnce(log({ sync: { state: "idle" } }));
  space.getGitSyncStatus.mockResolvedValueOnce({
    sync: { state: "idle" },
    enabled: false,
    paused: false,
    pending: null,
    incoming: null,
    lastAttempt: null,
    lastSuccess: null,
    version: 1,
  });
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows).toEqual([]);
});

test("a conflict prepends a header plus one link row per path", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({ sync: { state: "conflicted", paths: ["a.md", "b/c.md"] } }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({
    sync: "header",
    message: "Sync paused — 2 pages have conflicting changes.",
  });
  expect(rows[1]).toMatchObject({ sync: "path", file: "a.md" });
  expect(rows[2]).toMatchObject({ sync: "path", file: "b/c.md" });
  // Flat siblings, not nested under the header -- neither name may contain
  // a real "/", or they would render as children hidden behind an expand.
  expect(rows[1].name).not.toContain("/");
  expect(rows[2].name).not.toContain("/");
});

test("a single conflicted path uses the singular wording", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({ sync: { state: "conflicted", paths: ["a.md"] } }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows[0].message).toBe("Sync paused — 1 page has conflicting changes.");
});

test("a paused sync shows only the header, carrying the server's reason", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({ sync: { state: "paused", reason: "detached HEAD" } }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows).toEqual([
    expect.objectContaining({
      sync: "header",
      message: "Sync paused — detached HEAD.",
    }),
  ]);
});

test("a sync error shows only the header, with no path detail leaked into it", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({
      sync: { state: "error", kind: "AuthFailed", message: "denied" },
    }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  expect(rows).toEqual([
    expect.objectContaining({
      sync: "header",
      message: "Sync failed — check the space's git settings.",
    }),
  ]);
});

test("only the first page carries the banner -- loading more does not repeat it", async () => {
  const conflicted = { state: "conflicted" as const, paths: ["a.md"] };
  space.getSpaceLog.mockResolvedValueOnce(
    log({
      sync: conflicted,
      commits: [
        { rev: "deadbeef", timestamp: 1, author: "a", message: "m", files: [] },
      ],
      more: true,
    }),
  );
  const first = await spaceLogView.source({ phrase: "" } as any);
  const moreRow = first.find((r) => r.name === "@more")!;

  // `handle_space_log` inserts `sync` into every non-range response,
  // "before" set or not -- a real continuation page carries the exact same
  // (still-unresolved) state, not an absent field.
  space.getSpaceLog.mockResolvedValueOnce(log({ sync: conflicted }));
  await spaceLogView.onSelect(moreRow, {});
  const second = await spaceLogView.source({ phrase: "" } as any);

  expect(second.filter((r) => (r as any).sync === "header")).toHaveLength(1);
});

test("selecting the header row is a no-op -- it has no preview or expansion of its own", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({ sync: { state: "conflicted", paths: ["a.md"] } }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  const result = await spaceLogView.onSelect(rows[0], {});
  expect(result).toBe(false);
  expect(editor.navigate).not.toHaveBeenCalled();
});

test("selecting a conflicted path navigates straight to the page, not a diff preview", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({ sync: { state: "conflicted", paths: ["a.md"] } }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  const result = await spaceLogView.onSelect(rows[1], {});
  expect(editor.navigate).toHaveBeenCalledWith({ path: "a.md" });
  expect(result).toBe(false);
  expect(space.getRevisionDiff).not.toHaveBeenCalled();
});

test("the Restore action never targets a sync row", async () => {
  space.getSpaceLog.mockResolvedValueOnce(
    log({ sync: { state: "conflicted", paths: ["a.md"] } }),
  );
  const rows = await spaceLogView.source({ phrase: "" } as any);
  const restore = spaceLogView.actions!.find((a) => a.label === "Restore")!;
  expect(restore.when!(rows[0])).toBe(false);
  expect(restore.when!(rows[1])).toBe(false);
});

test("Git Sync now does not mutate for read members", async () => {
  system.getMode.mockResolvedValueOnce("ro");
  await requestGitSync();
  expect(space.syncGitNow).not.toHaveBeenCalled();
  expect(editor.save).not.toHaveBeenCalled();
});

test("conflict list includes every kind and sends the displayed content precondition", async () => {
  const conflicts = ["text", "binary", "deleteModify", "unsupported"].map(
    (kind, index) => ({
      id: `opaque-${index}`,
      path: `Sample ${index}.md`,
      kind,
      local: true,
      remote: true,
      contentRevision: `revision-${index}`,
    }),
  );
  space.getGitConflicts.mockResolvedValueOnce({
    generation: "merge-1",
    conflicts,
  });
  const rows = await gitConflictsView.source({ phrase: "" } as any);
  expect(rows.map((row) => row.kind)).toEqual([
    "text",
    "binary",
    "deleteModify",
    "unsupported",
  ]);
  space.resolveGitConflict.mockResolvedValueOnce({
    generation: "merge-1",
    conflicts: [],
  });
  await gitConflictsView.actions![0].run(rows[1]);
  expect(space.resolveGitConflict).toHaveBeenCalledWith(
    "opaque-1",
    "merge-1",
    "revision-1",
    "local",
  );
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "All conflicts resolved. Resuming sync…",
  );
});

test("a stale conflict choice refreshes without retrying the mutation", async () => {
  space.resolveGitConflict.mockRejectedValueOnce({ status: 409 });
  await gitConflictsView.actions![0].run({
    name: "opaque",
    id: "opaque",
    generation: "merge-1",
    contentRevision: "old",
    kind: "text",
    path: "Sample.md",
    local: true,
    remote: true,
  });
  expect(space.resolveGitConflict).toHaveBeenCalledTimes(1);
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "This conflict changed. Review the refreshed file before choosing again.",
    "error",
  );
  expect(events.dispatchEvent).toHaveBeenCalledWith("revisions:snapshot", {});
});

test("read members can download an original conflict side without resolving it", async () => {
  space.getGitConflictVersion.mockResolvedValueOnce(
    new Uint8Array([0, 255, 7]),
  );
  const action = gitConflictsView.actions!.find(
    (action) => action.label === "Download This space",
  )!;
  expect(action.requireMode).toBeUndefined();
  await action.run({
    name: "opaque",
    id: "opaque",
    generation: "merge-1",
    contentRevision: "old",
    kind: "binary",
    path: "Sample.bin",
    local: true,
    remote: true,
  });
  expect(space.getGitConflictVersion).toHaveBeenCalledWith(
    "opaque",
    "merge-1",
    "local",
  );
  expect(editor.downloadFile).toHaveBeenCalledWith(
    "Sample.bin.local",
    "data:application/octet-stream;base64,AP8H",
  );
  expect(space.resolveGitConflict).not.toHaveBeenCalled();
});

test("Git status is readable without accessing writer-only history", async () => {
  space.getGitSyncStatus.mockResolvedValueOnce({
    sync: { state: "conflicted", paths: ["Sample.bin"] },
    enabled: true,
    paused: false,
    pending: null,
    incoming: null,
    lastAttempt: 100,
    lastSuccess: null,
    version: 1,
  });
  const rows = await gitStatusView.source({ phrase: "" } as any);
  expect(rows[0].message).toBe("1 files need conflict resolution");
  expect(space.getSpaceLog).not.toHaveBeenCalled();
});

test("safe unsupported files expose choices but unsafe entries stay download-only", () => {
  const local = gitConflictsView.actions!.find(
    (action) => action.label === "Keep This space",
  )!;
  expect(
    local.when!({ kind: "unsupported", canResolve: true, local: true } as any),
  ).toBe(true);
  expect(
    local.when!({ kind: "unsupported", canResolve: false, local: true } as any),
  ).toBe(false);
});
