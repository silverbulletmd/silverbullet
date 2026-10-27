import {
  hasRun,
  type ScriptRecord,
  type ScriptStatus,
} from "../../space_lua.ts";
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
