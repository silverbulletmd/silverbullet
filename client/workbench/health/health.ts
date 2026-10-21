import {
  encodeRef,
  type Path,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type {
  GitConflict,
  GitSyncSnapshot,
} from "@silverbulletmd/silverbullet/type/revisions";
import type { SpaceLintDiagnostic } from "../../space_lint.ts";
import type { ScriptRecord } from "../../space_lua.ts";
import type { StyleRecord } from "../../space_style.ts";
import { SCRIPT_STATUS_TITLES } from "../scripts/scripts.ts";
import { blockSourceRef } from "../shared/blocks.ts";
import { errorMessage } from "../shared/value_preview.ts";
import { styleStatus } from "../styles/styles.ts";

export type Severity = "error" | "warning" | "info";
export type HealthGroup =
  | "deep"
  | "broken"
  | "ambiguous"
  | "scripts"
  | "conflicts";

/** Where a problem opens: a position (parseable by `parseToRef`, e.g. `Page@L3C5`), or a navigator view. */
export type ProblemTarget = { ref: string } | { view: string };

export type HealthProblem = {
  group: HealthGroup;
  severity: Severity;
  label: string;
  message: string;
  source: string;
  target?: ProblemTarget;
  /** The page the problem is on, when it is on one. */
  page?: string;
};

/** The groups listed from the index and Git; the space-wide lint follows them. */
export const INSTANT_GROUPS: Exclude<HealthGroup, "deep">[] = [
  "broken",
  "ambiguous",
  "scripts",
  "conflicts",
];

const GIT_STATUS_VIEW = "std.gitStatus";
const GIT_CONFLICTS_VIEW = "std.gitConflicts";

const pageOfPath = (path: string): string | undefined =>
  path.endsWith(".md") ? path.slice(0, -3) : undefined;

/** The page a ref points into, without the `.md` or position. */
function refPage(ref: string): string {
  const parsed = parseToRef(ref);
  return parsed ? encodeRef({ path: parsed.path }) : ref;
}

export function brokenLinkProblems(
  rows: { ref: string; name: string }[],
): HealthProblem[] {
  return rows.map((r) => ({
    group: "broken",
    severity: "warning",
    label: refPage(r.ref),
    message: `→ ${r.name}`,
    source: "aspiring",
    target: { ref: r.ref },
    page: refPage(r.ref),
  }));
}

export function ambiguousLinkProblems(
  rows: {
    ref: string;
    name: string;
    resolvesTo: string;
    candidates: string[];
  }[],
): HealthProblem[] {
  return rows.map((r) => ({
    group: "ambiguous",
    severity: "warning",
    label: refPage(r.ref),
    message: `"${r.name}" opens ${r.resolvesTo} · also ${r.candidates
      .filter((c) => c !== r.resolvesTo)
      .join(", ")}`,
    source: "ambiguous",
    target: { ref: r.ref },
    page: refPage(r.ref),
  }));
}

function blockTarget(
  ref: string,
  fence: "space-lua" | "space-style",
): ProblemTarget | undefined {
  const r: Ref | null = blockSourceRef(ref, fence);
  return r ? { ref: encodeRef(r) } : undefined;
}

export function scriptStyleProblems(
  scripts: ScriptRecord[],
  styles: StyleRecord[],
): HealthProblem[] {
  const out: HealthProblem[] = [];
  for (const s of scripts) {
    let severity: Severity;
    let message: string;
    if (s.status === "failed") {
      severity = "error";
      message = `Failed to load: ${errorMessage(s.error)}`;
    } else if (s.status === "quarantined") {
      severity = "warning";
      message = SCRIPT_STATUS_TITLES.quarantined;
    } else if (s.status === "stopped") {
      severity = "warning";
      message = SCRIPT_STATUS_TITLES.stopped;
    } else continue;
    out.push({
      group: "scripts",
      severity,
      label: refPage(s.ref),
      message,
      source: "script",
      target: blockTarget(s.ref, "space-lua"),
      page: refPage(s.ref),
    });
  }
  for (const s of styles) {
    if (styleStatus(s) !== "empty") continue;
    out.push({
      group: "scripts",
      severity: "warning",
      label: refPage(s.ref),
      message: "Style block produced no rules",
      source: "style",
      target: blockTarget(s.ref, "space-style"),
      page: refPage(s.ref),
    });
  }
  return out;
}

export function conflictProblems(conflicts: GitConflict[]): HealthProblem[] {
  return conflicts.map((c) => ({
    group: "conflicts",
    severity: "error",
    label: c.path,
    message: `Sync conflict (${c.kind})`,
    source: "conflict",
    target: { view: GIT_CONFLICTS_VIEW },
    page: pageOfPath(c.path),
  }));
}

/**
 * What the sync engine reports. Conflicted paths already listed by
 * `getGitConflicts()` are left out, since `conflictProblems` shows them.
 */
export function syncStateProblems(
  snapshot: GitSyncSnapshot,
  listed: GitConflict[] = [],
): HealthProblem[] {
  const { sync } = snapshot;
  const row = (severity: Severity, message: string): HealthProblem => ({
    group: "conflicts",
    severity,
    label: "Git sync",
    message,
    source: "sync",
    target: { view: GIT_STATUS_VIEW },
  });
  switch (sync.state) {
    case "error":
      return [row("error", `Sync failed: ${sync.message ?? sync.kind}`)];
    case "paused":
      return [row("warning", `Sync paused: ${sync.reason}`)];
    case "conflicted": {
      const known = new Set(listed.map((c) => c.path));
      return sync.paths
        .filter((path) => !known.has(path))
        .map((path) => ({
          group: "conflicts",
          severity: "error",
          label: path,
          message: "Merge conflict",
          source: "sync",
          target: { view: GIT_CONFLICTS_VIEW },
          page: pageOfPath(path),
        }));
    }
    default:
      return [];
  }
}

export function lintProblems(diags: SpaceLintDiagnostic[]): HealthProblem[] {
  return diags.map((d) => ({
    // Leftover markers are a merge problem, wherever they came from
    group: d.source === "conflict" ? "conflicts" : "deep",
    // Hints are filtered out by the linter; map defensively for the type.
    severity: d.severity === "hint" ? "info" : d.severity,
    label: d.page,
    message: d.message,
    source: d.source,
    target: {
      ref: encodeRef({
        path: `${d.page}.md` as Path,
        details: { type: "linecolumn", line: d.line, column: d.column },
      }),
    },
    page: d.page,
  }));
}

export function filterProblems(
  ps: HealthProblem[],
  severity: Severity | "all",
  text: string,
): HealthProblem[] {
  const needle = text.trim().toLowerCase();
  return ps.filter(
    (p) =>
      (severity === "all" || p.severity === severity) &&
      (!needle ||
        p.label.toLowerCase().includes(needle) ||
        p.message.toLowerCase().includes(needle)),
  );
}

export function severityCounts(
  ps: HealthProblem[],
): Record<Severity | "all", number> {
  const counts = { all: ps.length, error: 0, warning: 0, info: 0 };
  for (const p of ps) counts[p.severity]++;
  return counts;
}

/** Only errors count toward the tab badge. */
export function badgeCount(ps: HealthProblem[]): number {
  return ps.filter((p) => p.severity === "error").length;
}
