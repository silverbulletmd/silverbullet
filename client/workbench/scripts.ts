import { hasRun, type ScriptRecord, type ScriptStatus } from "../space_lua.ts";
import { stdLibPrefix } from "../spaces/constants.ts";
import type { Action } from "./action.ts";
import { scriptRefParts } from "./source_frames.ts";

export type ScriptFilter = "all" | "loaded" | "failed" | "quarantined";
export type ScriptOrigin = "all" | "custom" | "builtin";

/** Shipped with SilverBullet: a script on a `Library/Std/` page. Everything else, installed libraries included, is custom. */
export function isBuiltinScript(r: ScriptRecord): boolean {
  return r.ref.startsWith(stdLibPrefix);
}

/** The scripts of one origin, still in load order. */
export function scriptsFrom(
  scripts: ScriptRecord[],
  origin: ScriptOrigin,
): ScriptRecord[] {
  if (origin === "all") return scripts;
  const builtin = origin === "builtin";
  return scripts.filter((r) => isBuiltinScript(r) === builtin);
}

export function originCounts(
  scripts: ScriptRecord[],
): Record<ScriptOrigin, number> {
  const builtin = scripts.filter(isBuiltinScript).length;
  return {
    all: scripts.length,
    custom: scripts.length - builtin,
    builtin,
  };
}

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
  const needle = text.trim().toLowerCase();
  return scripts.filter(
    (r) =>
      matchesFilter(r, filter) &&
      (!needle || r.ref.toLowerCase().includes(needle)),
  );
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

/**
 * Each script's page name, plus its offset in the page when the page holds
 * more than one script, so its rows can be told apart.
 */
export function scriptLabels(
  scripts: ScriptRecord[],
): Map<string, { page: string; pos?: number }> {
  const parts = new Map(scripts.map((r) => [r.ref, scriptRefParts(r.ref)]));
  const perPage = new Map<string, number>();
  for (const { page } of parts.values()) {
    perPage.set(page, (perPage.get(page) ?? 0) + 1);
  }
  return new Map(
    [...parts].map(([ref, { page, pos }]) => [
      ref,
      (perPage.get(page) ?? 0) > 1 ? { page, pos } : { page },
    ]),
  );
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
