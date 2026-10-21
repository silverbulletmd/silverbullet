import type {
  GitConflict,
  GitSyncSnapshot,
} from "@silverbulletmd/silverbullet/type/revisions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitSyncOrOff, loadGitState } from "./git_state.ts";

afterEach(() => vi.restoreAllMocks());

describe("gitSyncOrOff", () => {
  it("passes a snapshot through", async () => {
    const snapshot = { enabled: true } as GitSyncSnapshot;
    expect(await gitSyncOrOff(Promise.resolve(snapshot))).toBe(snapshot);
  });

  it("still warns about an unexpected failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await gitSyncOrOff(
        Promise.reject(Object.assign(new Error("x"), { status: 500 })),
      ),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("loadGitState", () => {
  const conflict = { id: "1", path: "A.md" } as GitConflict;

  it("is undefined while Git sync is off, without asking for conflicts", async () => {
    const conflicts = vi.fn(async () => [conflict]);
    expect(
      await loadGitState({
        syncStatus: async () => ({ enabled: false }) as GitSyncSnapshot,
        conflicts,
      }),
    ).toBeUndefined();
    expect(conflicts).not.toHaveBeenCalled();
  });

  it("keeps the snapshot when listing conflicts fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const snapshot = { enabled: true } as GitSyncSnapshot;
    expect(
      await loadGitState({
        syncStatus: async () => snapshot,
        conflicts: () => Promise.reject(new Error("offline")),
      }),
    ).toEqual({ snapshot, conflicts: undefined });
  });
});
