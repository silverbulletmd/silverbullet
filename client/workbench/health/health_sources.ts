import { latestOnly } from "@silverbulletmd/silverbullet/lib/async";
import type { Client } from "../../client.ts";
import { subscribeRefresh } from "../../navigator/page_widget_logic.ts";
import { expandRefreshTriggers } from "../../navigator/refresh_triggers.ts";
import { setNativeBadge } from "../../navigator/ui/native_views.ts";
import { WORKBENCH_VIEW } from "../../navigator/views/workbench.ts";
import type { SpaceLintDiagnostic } from "../../space_lint.ts";
import { LuaEnv } from "../../space_lua/runtime.ts";
import type { ScriptRecord } from "../../space_lua.ts";
import type { StyleRecord } from "../../space_style.ts";
import { isUserPage } from "../../user_pages.ts";
import {
  type GitSources,
  gitSources,
  loadGitState,
} from "../shared/git_state.ts";
import type { DeepCheck } from "./deep_check.ts";
import {
  ambiguousLinkProblems,
  badgeCount,
  brokenLinkProblems,
  conflictProblems,
  type HealthProblem,
  scriptStyleProblems,
  syncStateProblems,
} from "./health.ts";

type LinkRow = { ref: string; page: string; pos: number; name: string };
type AmbiguousRow = LinkRow & { resolvesTo: string; candidates: string[] };

/** Where the problems that need no space-wide lint come from. */
export type InstantSources = GitSources & {
  aspiring: () => Promise<LinkRow[]>;
  ambiguous: () => Promise<AmbiguousRow[]>;
  scripts: () => ScriptRecord[];
  styles: () => StyleRecord[];
};

function userLinks<R extends LinkRow>(rows: R[]): R[] {
  return rows
    .filter((r) => isUserPage(r.page))
    .sort((a, b) => a.page.localeCompare(b.page) || a.pos - b.pos);
}

// One failing source (an index still building) mustn't hide the rest
const orEmpty = <T>(p: Promise<T[]>): Promise<T[]> =>
  p.catch((e) => {
    console.warn("health: source failed", e);
    return [];
  });

export async function loadInstantHealth(
  src: InstantSources,
): Promise<HealthProblem[]> {
  const [aspiring, ambiguous, git] = await Promise.all([
    orEmpty(src.aspiring()),
    orEmpty(src.ambiguous()),
    loadGitState(src),
  ]);
  const conflicts = git?.conflicts ?? [];
  return [
    ...brokenLinkProblems(userLinks(aspiring)),
    ...ambiguousLinkProblems(userLinks(ambiguous)),
    ...scriptStyleProblems(src.scripts(), src.styles()),
    ...(git ? syncStateProblems(git.snapshot, conflicts) : []),
    ...conflictProblems(conflicts),
  ];
}

export function instantSources(client: Client): InstantSources {
  const rows = <T>(tag: string) =>
    client.objectIndex.queryLuaObjects<T>(new LuaEnv(), tag, {});
  return {
    ...gitSources,
    aspiring: () => rows<LinkRow>("aspiring-page"),
    ambiguous: () => rows<AmbiguousRow>("ambiguous-link"),
    scripts: () => client.clientSystem.spaceLuaEnv.lastLoad?.scripts ?? [],
    styles: () => client.spaceStyles.lastLoad?.styles ?? [],
  };
}

/**
 * The badge's error count. A broken script block also fails the space-wide
 * lint (its Lua error, then the objects it couldn't index), so lint errors on
 * a page whose script already failed are left out, as are conflict markers on
 * a page Git already reports as conflicted. The rest count once per page and
 * line.
 */
export function badgeErrorCount(
  instant: HealthProblem[],
  deepFound: SpaceLintDiagnostic[],
): number {
  const errorPages = (group: HealthProblem["group"]) =>
    new Set(
      instant
        .filter((p) => p.group === group && p.severity === "error")
        .map((p) => p.page),
    );
  const failedScripts = errorPages("scripts");
  const gitConflictPages = errorPages("conflicts");
  const deep = new Set(
    deepFound
      .filter(
        (d) =>
          d.severity === "error" &&
          !failedScripts.has(d.page) &&
          !(d.source === "conflict" && gitConflictPages.has(d.page)),
      )
      .map((d) => JSON.stringify([d.page, d.line])),
  );
  return badgeCount(instant) + deep.size;
}

/** How the monitor loads the instant problems, and what makes them stale. */
export type HealthWatch = {
  load: () => Promise<HealthProblem[]>;
  subscribe: (changed: () => void) => () => void;
};

export function healthWatch(client: Client): HealthWatch {
  return {
    load: () => loadInstantHealth(instantSources(client)),
    subscribe: (changed) => {
      const offs = [
        subscribeRefresh(
          client.clientSystem.eventHook,
          expandRefreshTriggers(["index"]),
          changed,
        ),
        client.clientSystem.spaceLuaEnv.onLoad(changed),
        client.spaceStyles.onLoad(changed),
      ];
      return () => {
        for (const off of offs) off();
      };
    },
  };
}

/**
 * The Health tab's problems and its badge: the instant problems, kept current
 * while started, plus the space-wide lint. The Workbench starts it while open,
 * so nothing loads while it's closed.
 */
export class HealthMonitor {
  /** Undefined until the first load finishes. */
  instant: HealthProblem[] | undefined;
  private listeners = new Set<() => void>();
  // The last finished lint, counted while the next one runs
  private lastLint: SpaceLintDiagnostic[];

  constructor(
    private watch: HealthWatch,
    readonly deepCheck: DeepCheck,
  ) {
    const s = deepCheck.state;
    this.lastLint = s.kind === "done" ? s.found : [];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Loads now and on every change, until the returned function is called. */
  start(): () => void {
    const loader = latestOnly(this.watch.load, (problems) => {
      this.instant = problems;
      this.changed();
    });
    const load = () => void loader.run();
    const offs = [
      this.watch.subscribe(load),
      this.deepCheck.onChange((s) => {
        if (s.kind !== "done") return;
        this.lastLint = s.found;
        this.changed();
      }),
    ];
    load();
    return () => {
      loader.cancel();
      for (const off of offs) off();
    };
  }

  private changed() {
    const n = badgeErrorCount(this.instant ?? [], this.lastLint);
    setNativeBadge(WORKBENCH_VIEW, "Health", n > 0 ? String(n) : undefined);
    for (const fn of [...this.listeners]) fn();
  }
}
