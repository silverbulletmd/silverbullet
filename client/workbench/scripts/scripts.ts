import {
  hasRun,
  type ScriptRecord,
  type ScriptStatus,
} from "../../space_lua.ts";
import type { Action } from "../shared/action.ts";
import { refMatches } from "../shared/blocks.ts";

export const SCRIPT_STATUS_TITLES: Record<ScriptRecord["status"], string> = {
  loaded: "Loaded",
  failed: "Failed to load",
  stopped: "Stopped while loading; quarantined from the next load",
  quarantined: "Quarantined: skipped until re-enabled or edited",
};

export type ScriptFilter = "all" | "loaded" | "failed" | "quarantined";
// A script stopped during this load is quarantined from the next one
const FILTER_STATUSES: Record<Exclude<ScriptFilter, "all">, ScriptStatus[]> = {
  loaded: ["loaded"],
  failed: ["failed"],
  quarantined: ["quarantined", "stopped"],
};

function matchesFilter(r: ScriptRecord, filter: ScriptFilter): boolean {
  return filter === "all" || FILTER_STATUSES[filter].includes(r.status);
}

/** The scripts that pass `filter` and whose ref contains `text`, still in load order. */
export function filterScripts(
  scripts: ScriptRecord[],
  text: string,
  filter: ScriptFilter,
): ScriptRecord[] {
  return scripts.filter((r) => matchesFilter(r, filter) && refMatches(r, text));
}

export function scriptCounts(
  scripts: ScriptRecord[],
): Record<ScriptFilter, number> {
  return {
    all: scripts.length,
    loaded: scripts.filter((r) => matchesFilter(r, "loaded")).length,
    failed: scripts.filter((r) => matchesFilter(r, "failed")).length,
    quarantined: scripts.filter((r) => matchesFilter(r, "quarantined")).length,
  };
}

/** A quarantined script didn't run, so it has no time to show. */
export function formatLoadTime(r: ScriptRecord): string {
  if (!hasRun(r)) return "–";
  return r.ms < 1 ? "<1 ms" : `${Math.round(r.ms)} ms`;
}

/** What a script row's actions act through. */
export type ScriptActionDeps = {
  openSource: (ref: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  reEnable: (ref: string) => Promise<void>;
};

export type ScriptAction = Action<ScriptActionDeps>;

/** What a script row's ⋯ menu offers. */
export function scriptActions(r: ScriptRecord): ScriptAction[] {
  const actions: ScriptAction[] = [
    {
      label: "Open source",
      icon: "definition",
      run: (deps) => deps.openSource(r.ref),
    },
    {
      label: "Copy code",
      icon: "copy",
      run: (deps) => deps.copyText(r.source),
    },
  ];
  if (r.status === "quarantined" || r.status === "stopped") {
    actions.push({
      label: "Re-enable and reload",
      icon: "reload",
      run: (deps) => deps.reEnable(r.ref),
    });
  }
  return actions;
}
