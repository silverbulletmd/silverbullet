import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import type {
  GitConflict,
  GitSyncSnapshot,
} from "@silverbulletmd/silverbullet/type/revisions";
import { describe, expect, it } from "vitest";
import type { ScriptRecord } from "../../space_lua.ts";
import type { StyleRecord } from "../../space_style.ts";
import {
  ambiguousLinkProblems,
  badgeCount,
  brokenLinkProblems,
  conflictProblems,
  filterProblems,
  type HealthProblem,
  INSTANT_GROUPS,
  lintProblems,
  scriptStyleProblems,
  severityCounts,
  syncStateProblems,
} from "./health.ts";

const problem = (
  severity: HealthProblem["severity"],
  label: string,
  message: string,
): HealthProblem => ({
  group: "deep",
  severity,
  label,
  message,
  source: "test",
});

describe("health problems", () => {
  it("lists the instant groups in order, without the space-wide lint", () => {
    expect(INSTANT_GROUPS).toEqual([
      "broken",
      "ambiguous",
      "scripts",
      "conflicts",
    ]);
  });

  it("builds broken link problems", () => {
    expect(
      brokenLinkProblems([{ ref: "Notes@L3C5", name: "Missing Page" }]),
    ).toEqual([
      {
        group: "broken",
        severity: "warning",
        label: "Notes",
        message: "→ Missing Page",
        source: "aspiring",
        target: { ref: "Notes@L3C5" },
        page: "Notes",
      },
    ]);
  });

  it("builds ambiguous link problems listing the other candidates", () => {
    const [p] = ambiguousLinkProblems([
      {
        ref: "Notes@L1",
        name: "Idea",
        resolvesTo: "A/Idea",
        candidates: ["A/Idea", "B/Idea", "C/Idea"],
      },
    ]);
    expect(p.group).toBe("ambiguous");
    expect(p.severity).toBe("warning");
    expect(p.message).toBe('"Idea" opens A/Idea · also B/Idea, C/Idea');
    expect(p.target).toEqual({ ref: "Notes@L1" });
    expect(p.page).toBe("Notes");
  });

  it("maps script and style states to severities with parseable refs", () => {
    const scripts: ScriptRecord[] = [
      {
        ref: "Lib/Boom@10",
        source: "x",
        priority: 0,
        status: "failed",
        error: new Error("bad thing"),
        ms: 1,
      },
      { ref: "Lib/Ok@10", source: "x", priority: 0, status: "loaded", ms: 1 },
      { ref: "Lib/Slow@10", source: "x", priority: 0, status: "quarantined" },
      {
        ref: "Lib/Stop@10",
        source: "x",
        priority: 0,
        status: "stopped",
        ms: 1,
      },
    ];
    const styles: StyleRecord[] = [
      { ref: "Lib/Css@5", source: ".a { color: red }", rules: 1 },
      { ref: "Lib/Bad@5", source: "nonsense here", rules: 0 },
    ];
    const ps = scriptStyleProblems(scripts, styles);
    expect(ps.map((p) => [p.severity, p.label])).toEqual([
      ["error", "Lib/Boom"],
      ["warning", "Lib/Slow"],
      ["warning", "Lib/Stop"],
      ["warning", "Lib/Bad"],
    ]);
    expect(ps[0].message).toBe("Failed to load: bad thing");
    expect(ps[1].message).toBe(
      "Quarantined: skipped until re-enabled or edited",
    );
    expect(ps[2].message).toBe(
      "Stopped while loading; quarantined from the next load",
    );
    expect(ps.every((p) => p.group === "scripts")).toBe(true);
    const refOf = (p: HealthProblem) =>
      p.target && "ref" in p.target ? p.target.ref : "";
    for (const p of ps) expect(parseToRef(refOf(p))).not.toBeNull();
    expect(refOf(ps[0])).toBe(`Lib/Boom@${10 + "```space-lua\n".length}`);
    expect(refOf(ps[3])).toBe(`Lib/Bad@${5 + "```space-style\n".length}`);
    expect(ps[0].page).toBe("Lib/Boom");
  });

  it("builds conflict problems that open the Git conflicts view", () => {
    const [p] = conflictProblems([
      {
        id: "1",
        path: "Notes/A.md",
        kind: "text",
        local: true,
        remote: true,
        contentRevision: "r",
      },
    ]);
    expect(p).toMatchObject({
      group: "conflicts",
      severity: "error",
      label: "Notes/A.md",
      source: "conflict",
      target: { view: "std.gitConflicts" },
      page: "Notes/A",
    });
  });

  it("syncStateProblems reports error, paused and conflicted states", () => {
    const snap = (sync: GitSyncSnapshot["sync"]): GitSyncSnapshot => ({
      sync,
      lastAttempt: null,
      lastSuccess: null,
      version: 1,
      enabled: true,
      paused: false,
      pending: null,
      incoming: null,
    });
    expect(
      syncStateProblems(
        snap({ state: "error", kind: "auth", message: "denied" }),
      ),
    ).toEqual([
      {
        group: "conflicts",
        severity: "error",
        label: "Git sync",
        message: "Sync failed: denied",
        source: "sync",
        target: { view: "std.gitStatus" },
      },
    ]);
    expect(
      syncStateProblems(snap({ state: "error", kind: "network" }))[0].message,
    ).toBe("Sync failed: network");
    expect(
      syncStateProblems(snap({ state: "paused", reason: "manual" })),
    ).toEqual([
      {
        group: "conflicts",
        severity: "warning",
        label: "Git sync",
        message: "Sync paused: manual",
        source: "sync",
        target: { view: "std.gitStatus" },
      },
    ]);
    const existing: GitConflict[] = [
      {
        id: "1",
        path: "A.md",
        kind: "text",
        local: true,
        remote: true,
        contentRevision: "r",
      },
    ];
    const rows = syncStateProblems(
      snap({ state: "conflicted", paths: ["A.md", "B.md"] }),
      existing,
    );
    expect(rows).toEqual([
      {
        group: "conflicts",
        severity: "error",
        label: "B.md",
        message: "Merge conflict",
        source: "sync",
        target: { view: "std.gitConflicts" },
        page: "B",
      },
    ]);
    expect(syncStateProblems(snap({ state: "idle" }))).toEqual([]);
    expect(syncStateProblems(snap({ state: "syncing" }))).toEqual([]);
  });

  it("conflict-marker diagnostics land in the Merge conflicts group", () => {
    const [marker, other] = lintProblems([
      {
        page: "Notes",
        line: 2,
        column: 1,
        severity: "error",
        message: "Unresolved merge conflict",
        source: "conflict",
      },
      {
        page: "Notes",
        line: 9,
        column: 1,
        severity: "error",
        message: "oops",
        source: "lua",
      },
    ]);
    expect(marker.group).toBe("conflicts");
    // encodeRef omits column 1
    expect(marker.target).toEqual({ ref: "Notes@L2" });
    expect(other.group).toBe("deep");
  });

  it("builds lint problems with a line/column ref", () => {
    const [p] = lintProblems([
      {
        page: "Notes",
        line: 3,
        column: 5,
        severity: "error",
        message: "oops",
        source: "lua",
      },
    ]);
    expect(p).toEqual({
      group: "deep",
      severity: "error",
      label: "Notes",
      message: "oops",
      source: "lua",
      target: { ref: "Notes@L3C5" },
      page: "Notes",
    });
  });

  it("filters by severity and text", () => {
    const ps = [
      problem("error", "Alpha", "broke"),
      problem("warning", "Beta", "Slow thing"),
      problem("info", "Gamma", "fyi"),
    ];
    expect(filterProblems(ps, "all", "")).toHaveLength(3);
    expect(filterProblems(ps, "warning", "").map((p) => p.label)).toEqual([
      "Beta",
    ]);
    expect(filterProblems(ps, "all", "ALPHA")).toHaveLength(1);
    expect(filterProblems(ps, "all", "slow")).toHaveLength(1);
    expect(filterProblems(ps, "error", "slow")).toHaveLength(0);
  });

  it("counts severities and badges errors only", () => {
    const ps = [
      problem("error", "a", ""),
      problem("error", "b", ""),
      problem("warning", "c", ""),
      problem("info", "d", ""),
    ];
    expect(severityCounts(ps)).toEqual({
      all: 4,
      error: 2,
      warning: 1,
      info: 1,
    });
    expect(badgeCount(ps)).toBe(2);
    expect(badgeCount([problem("warning", "c", "")])).toBe(0);
  });
});
