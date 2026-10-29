import type {
  GitConflict,
  GitSyncSnapshot,
} from "@silverbulletmd/silverbullet/type/revisions";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceLintDiagnostic } from "../../space_lint.ts";
import type { ScriptRecord } from "../../space_lua.ts";
import { PermissionDeniedError } from "../../spaces/http_space_primitives.ts";
import { DeepCheck } from "./deep_check.ts";
import type { HealthProblem } from "./health.ts";
import {
  badgeErrorCount,
  HealthMonitor,
  type HealthWatch,
  type InstantSources,
  loadInstantHealth,
} from "./health_sources.ts";

const setNativeBadge = vi.fn();
vi.mock("../../navigator/ui/native_views.ts", () => ({
  setNativeBadge: (...args: unknown[]) => setNativeBadge(...args),
}));

function sources(over: Partial<InstantSources> = {}): InstantSources {
  return {
    aspiring: async () => [],
    ambiguous: async () => [],
    scripts: () => [],
    styles: () => [],
    syncStatus: async () => undefined,
    conflicts: async () => [],
    ...over,
  };
}

describe("loadInstantHealth", () => {
  it("includes links from library and repository pages, sorted by page and position", async () => {
    const problems = await loadInstantHealth(
      sources({
        aspiring: async () => [
          { ref: "Notes@40", page: "Notes", pos: 40, name: "Later" },
          { ref: "Library/Std/X@3", page: "Library/Std/X", pos: 3, name: "Y" },
          {
            ref: "Repositories/R@3",
            page: "Repositories/R",
            pos: 3,
            name: "Z",
          },
          { ref: "Notes@5", page: "Notes", pos: 5, name: "Sooner" },
          { ref: "Alpha@9", page: "Alpha", pos: 9, name: "Gone" },
        ],
      }),
    );
    expect(problems.map((p) => p.target)).toEqual([
      { ref: "Alpha@9" },
      { ref: "Library/Std/X@3" },
      { ref: "Notes@5" },
      { ref: "Notes@40" },
      { ref: "Repositories/R@3" },
    ]);
  });

  it("includes ambiguous links in library pages", async () => {
    const problems = await loadInstantHealth(
      sources({
        ambiguous: async () => [
          {
            ref: "Library/Examples/Dashboard@8",
            page: "Library/Examples/Dashboard",
            pos: 8,
            name: "Notes",
            resolvesTo: "Projects/Notes",
            candidates: ["Projects/Notes", "Archive/Notes"],
          },
        ],
      }),
    );
    expect(problems).toMatchObject([
      {
        group: "ambiguous",
        target: { ref: "Library/Examples/Dashboard@8" },
        message: '"Notes" opens Projects/Notes · also Archive/Notes',
      },
    ]);
  });

  it("asks for conflicts and sync state only when git sync is enabled", async () => {
    let asked = 0;
    const conflicts = async () => {
      asked++;
      return [
        {
          id: "c1",
          path: "Page.md",
          kind: "text",
          local: true,
          remote: true,
        } as GitConflict,
      ];
    };
    const snapshot = (enabled: boolean): GitSyncSnapshot => ({
      sync: { state: "error", kind: "network", message: "offline" },
      lastAttempt: null,
      lastSuccess: null,
      version: 1,
      enabled,
      paused: false,
      pending: null,
      incoming: null,
    });
    const off = await loadInstantHealth(
      sources({ conflicts, syncStatus: async () => snapshot(false) }),
    );
    expect(off).toEqual([]);
    expect(asked).toBe(0);

    const on = await loadInstantHealth(
      sources({ conflicts, syncStatus: async () => snapshot(true) }),
    );
    expect(on.map((p) => [p.group, p.source, p.message])).toEqual([
      ["conflicts", "sync", "Sync failed: offline"],
      ["conflicts", "conflict", "Sync conflict (text)"],
    ]);
  });

  it("keeps the other groups when one source fails", async () => {
    const problems = await loadInstantHealth(
      sources({
        aspiring: async () => {
          throw new Error("index not ready");
        },
        syncStatus: async () => {
          throw new Error("offline");
        },
        scripts: () =>
          [
            { ref: "Config@0", status: "failed", error: new Error("boom") },
          ] as unknown as ScriptRecord[],
      }),
    );
    expect(problems.map((p) => p.group)).toEqual(["scripts"]);
  });

  describe("when revisions are off", () => {
    afterEach(() => vi.restoreAllMocks());

    it.each([
      ["a 404", Object.assign(new Error("not found"), { status: 404 })],
      ["a 403", Object.assign(new Error("forbidden"), { status: 403 })],
      ["a permission error", new PermissionDeniedError()],
    ])(
      "treats %s from the sync status as Git off, without a warning",
      async (_, error) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        let asked = 0;
        const problems = await loadInstantHealth(
          sources({
            syncStatus: () => Promise.reject(error),
            conflicts: async () => {
              asked++;
              return [];
            },
          }),
        );
        expect(problems).toEqual([]);
        expect(asked).toBe(0);
        expect(warn).not.toHaveBeenCalled();
      },
    );
  });
});

const instantError = (
  group: HealthProblem["group"],
  page: string,
): HealthProblem => ({
  group,
  severity: "error",
  label: page,
  message: "m",
  source: "s",
  page,
});

const diag = (
  page: string,
  line: number,
  severity: SpaceLintDiagnostic["severity"] = "error",
  source = "yaml",
): SpaceLintDiagnostic => ({
  page,
  line,
  column: 1,
  severity,
  message: "m",
  source,
});

describe("badgeErrorCount", () => {
  it("counts instant errors and finished deep errors", () => {
    expect(badgeErrorCount([instantError("conflicts", "A")], [])).toBe(1);
    expect(badgeErrorCount([], [diag("BadYaml", 3)])).toBe(1);
  });

  it("skips deep errors on a page whose script already failed to load", () => {
    expect(
      badgeErrorCount(
        [instantError("scripts", "Scripts")],
        [
          diag("Scripts", 4, "error", "lua"),
          diag("Scripts", 4, "error", "objects"),
        ],
      ),
    ).toBe(1);
  });

  it("counts a conflict marker once when the page is also a git conflict", () => {
    expect(
      badgeErrorCount(
        [instantError("conflicts", "Notes/A")],
        [
          diag("Notes/A", 3, "error", "conflict"),
          diag("Other", 1, "error", "conflict"),
        ],
      ),
    ).toBe(2);
  });

  it("counts deep errors once per page and line, and ignores warnings", () => {
    expect(
      badgeErrorCount(
        [],
        [
          diag("Page", 4, "error", "lua"),
          diag("Page", 4, "error", "objects"),
          diag("Page", 9),
          diag("Other", 4),
          diag("Other", 6, "warning"),
        ],
      ),
    ).toBe(3);
  });
});

describe("HealthMonitor", () => {
  function fakeWatch() {
    const pending: ((ps: HealthProblem[]) => void)[] = [];
    let subscribed = 0;
    let changed: () => void = () => {};
    const watch: HealthWatch = {
      load: () => new Promise((resolve) => pending.push(resolve)),
      subscribe: (fn) => {
        subscribed++;
        changed = fn;
        return () => {
          subscribed--;
        };
      },
    };
    return {
      watch,
      pending,
      subscribed: () => subscribed,
      change: () => changed(),
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("loads nothing until started", () => {
    const w = fakeWatch();
    new HealthMonitor(w.watch, new DeepCheck(async () => []));
    expect(w.pending).toHaveLength(0);
    expect(w.subscribed()).toBe(0);
  });

  it("loads on start and on each change, and badges the errors", async () => {
    const w = fakeWatch();
    const monitor = new HealthMonitor(w.watch, new DeepCheck(async () => []));
    setNativeBadge.mockClear();
    const stop = monitor.start();
    w.pending.shift()!([instantError("scripts", "A")]);
    await flush();
    expect(monitor.instant).toHaveLength(1);
    expect(setNativeBadge).toHaveBeenLastCalledWith(
      "std.workbench",
      "Health",
      "1",
    );
    w.change();
    w.pending.shift()!([]);
    await flush();
    expect(setNativeBadge).toHaveBeenLastCalledWith(
      "std.workbench",
      "Health",
      undefined,
    );
    stop();
  });

  it("counts a finished space-wide lint in the badge", async () => {
    const w = fakeWatch();
    const deep = new DeepCheck(async () => [diag("BadYaml", 3)]);
    const monitor = new HealthMonitor(w.watch, deep);
    const stop = monitor.start();
    w.pending.shift()!([]);
    await deep.run();
    expect(setNativeBadge).toHaveBeenLastCalledWith(
      "std.workbench",
      "Health",
      "1",
    );
    stop();
  });

  it("unsubscribes on stop and drops a load still in flight", async () => {
    const w = fakeWatch();
    const monitor = new HealthMonitor(w.watch, new DeepCheck(async () => []));
    const stop = monitor.start();
    expect(w.subscribed()).toBe(1);
    setNativeBadge.mockClear();
    stop();
    expect(w.subscribed()).toBe(0);
    w.pending.shift()!([instantError("scripts", "A")]);
    await flush();
    expect(monitor.instant).toBeUndefined();
    expect(setNativeBadge).not.toHaveBeenCalled();
  });
});
