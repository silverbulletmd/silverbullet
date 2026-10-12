import { LuaBudgetStopped } from "./budget.ts";
import type { EventInterest } from "../event_interest.ts";
import { expandRefreshTriggers } from "../navigator/refresh_triggers.ts";
import type { Tracker } from "./dependencies.ts";
import { evalExpression, evalStatement } from "./eval.ts";
import { parseBlock, parseExpressionString } from "./parse.ts";
import {
  type Definition,
  type ExtractedDefinitions,
  extractDefinitions,
} from "./page_definitions.ts";
import { renderThread, toRenderValue } from "./render_thread.ts";
import {
  LuaEnv,
  LuaStackFrame,
  type LuaValue,
  type PageScopeFrame,
  singleResult,
} from "./runtime.ts";

export type AssignmentResult = { value: LuaValue } | { error: string };

export type PageScope = {
  key: string;
  env: LuaEnv;
  assignments: Map<string, AssignmentResult>;
  blockErrors: Map<number, string>;
  // The first failing definition, as "label: message"
  firstError: string | null;
  // Events the definitions' reads depend on, including through the pages
  // they read: any of them invalidates this scope
  deps: Set<string>;
};

export type PageScopesDeps = {
  readPageText: (name: string) => Promise<string | null>;
  spaceEnv: () => LuaEnv;
  // Indexed meta for `_CTX.currentPage`, overlaid with the page's frontmatter
  pageMeta?: (name: string) => Promise<Record<string, unknown> | null>;
  // Holds cached scopes' dependencies; without it only text changes invalidate
  interest?: EventInterest;
  // Told the pages a dependency or text change invalidated
  onInvalidated?: (pages: string[]) => void | Promise<void>;
};

/** What to render a page's directives with right now. */
export type LatestScope = {
  // undefined: nothing to render with yet; null: the page has no definitions
  scope: PageScope | null | undefined;
  // Whether a build should be started to bring `scope` up to date
  needsBuild: boolean;
};

const STOPPED = "stopped: budget exceeded";
const MISSING = "\0missing";
// Scopes kept, least recently used first out; open pages stay in use
const MAX_ENTRIES = 200;

/**
 * The event fired when `page`'s scope changes. A widget that read the page
 * refreshes on it like on any live trigger.
 */
export function pageScopeChangedEvent(page: string): string {
  return `pageScope:changed:${page}`;
}

/** A `${name = …}` directive's value as the renderers take it, or its error. */
export function assignmentRenderValue(
  scope: PageScope | null,
  name: string,
): unknown {
  const result = scope?.assignments.get(name);
  if (!result) return "**Lua error:** page scope not available";
  if ("error" in result) return `**Lua error:** ${result.error}`;
  return toRenderValue(result.value, LuaStackFrame.lostFrame);
}

type Entry = {
  fingerprint: string;
  // null: no definitions; undefined: the page doesn't exist
  scope: PageScope | null | undefined;
  // Invalidated: kept for display until the rebuild lands
  stale: boolean;
  // Releases the hold on the scope's dependencies
  release?: () => void;
  // The build's own watch on what it read, until the entry is stored
  watch?: BuildWatch;
};

/**
 * Holds a build's reads as it makes them, so a change between a read and the
 * scope being stored (an index flush mid-build) isn't lost.
 */
type BuildWatch = {
  missed: boolean;
  release: () => void;
};

export class PageScopes {
  // In least recently used order
  private entries = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<PageScope | null>>();
  private generation = 0;

  constructor(private deps: PageScopesDeps) {}

  get size(): number {
    return this.entries.size;
  }

  private entry(page: string): Entry | undefined {
    const entry = this.entries.get(page);
    if (entry) {
      // Least recently used order: re-insert, keeping its hold
      this.entries.delete(page);
      this.entries.set(page, entry);
    }
    return entry;
  }

  private store(page: string, entry: Entry): void {
    this.entries.get(page)?.release?.();
    this.entries.delete(page);
    const deps = entry.scope?.deps;
    if (deps?.size && this.deps.interest) {
      entry.release = this.deps.interest.listen(
        expandRefreshTriggers([...deps]),
        () => this.dependencyChanged(page),
      );
    }
    const missed = !!entry.watch?.missed;
    this.unwatch(entry);
    this.entries.set(page, entry);
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value!;
      this.entries.get(oldest)?.release?.();
      this.entries.delete(oldest);
    }
    if (missed) this.dependencyChanged(page);
  }

  // A build's watch ends when its entry is stored or discarded
  private unwatch(entry: Entry): Entry {
    entry.watch?.release();
    entry.watch = undefined;
    return entry;
  }

  latest(page: string): LatestScope {
    const entry = this.entry(page);
    const current = entry && !entry.stale;
    return {
      scope: entry?.scope,
      needsBuild: !current && !this.inFlight.has(page),
    };
  }

  /**
   * Rejects for a missing page or a cycle. `reader` is the evaluation asking:
   * its chain of builds in progress, and where its reads are reported.
   */
  get(
    page: string,
    reader?: PageScopeFrame,
    track?: Tracker,
  ): Promise<PageScope | null> {
    const chain = reader?.chain ?? [];
    if (chain.includes(page)) {
      return Promise.reject(
        new Error(`pageVars.get: cycle ${[...chain, page].join(" → ")}`),
      );
    }
    const entry = this.entry(page);
    if (entry && !entry.stale) return this.found(page, entry);
    // A build reading another page builds its own, uncached copy: joining a
    // shared build could wait on a build that waits on us, a cycle no chain
    // would show
    if (reader && chain.length) {
      return this.load(page, reader, track).then((e) =>
        this.found(page, this.unwatch(e)),
      );
    }
    let p = this.inFlight.get(page);
    if (!p) {
      const created: Promise<PageScope | null> = this.load(page).then(
        (e) => {
          // pageChanged and clear drop an invalidated build from `inFlight`
          if (this.inFlight.get(page) !== created) {
            return this.found(page, this.unwatch(e));
          }
          this.inFlight.delete(page);
          this.store(page, e);
          return this.found(page, e);
        },
        (err) => {
          if (this.inFlight.get(page) === created) this.inFlight.delete(page);
          throw err;
        },
      );
      p = created;
      this.inFlight.set(page, p);
    }
    return p;
  }

  /** Never rejects: a missing page or a cycle has no scope. */
  tryGet(page: string): Promise<PageScope | null> {
    return this.get(page).catch(() => null);
  }

  private found(page: string, entry: Entry): Promise<PageScope | null> {
    return entry.scope === undefined
      ? Promise.reject(new Error(`pageVars.get: page ${page} not found`))
      : Promise.resolve(entry.scope);
  }

  /** Invalidates `page` and the scopes that read it; returns their pages. */
  async pageChanged(page: string): Promise<string[]> {
    const entry = this.entries.get(page);
    if (entry && !entry.stale) {
      const text = await this.deps.readPageText(page);
      const fingerprint =
        text === null ? MISSING : extractDefinitions(text).fingerprint;
      if (fingerprint === entry.fingerprint) return [];
    }
    const known = !!entry || this.inFlight.has(page);
    const invalidated = this.invalidate(page);
    // Never built and nobody read it: nothing to tell
    if (!known && invalidated.length <= 1) return [];
    await this.deps.onInvalidated?.(invalidated);
    return invalidated;
  }

  clear(): void {
    this.inFlight.clear();
    for (const entry of this.entries.values()) entry.release?.();
    this.entries.clear();
  }

  /** Marks `page` and the scopes that read it stale; returns their pages. */
  private invalidate(page: string): string[] {
    const invalidated: string[] = [];
    const visit = (p: string) => {
      if (invalidated.includes(p)) return;
      invalidated.push(p);
      const e = this.entries.get(p);
      if (e) {
        e.stale = true;
        e.release?.();
        e.release = undefined;
      }
      this.inFlight.delete(p);
      const event = pageScopeChangedEvent(p);
      for (const [reader, { scope }] of this.entries) {
        if (scope?.deps.has(event)) visit(reader);
      }
    };
    visit(page);
    return invalidated;
  }

  private dependencyChanged(page: string): void {
    const pages = this.invalidate(page);
    if (pages.length) void this.deps.onInvalidated?.(pages);
  }

  private async load(
    page: string,
    reader?: PageScopeFrame,
    track?: Tracker,
  ): Promise<Entry> {
    const text = await this.deps.readPageText(page);
    if (text === null) {
      // Cached, so the page's creation invalidates whoever tried to read it
      return { fingerprint: MISSING, scope: undefined, stale: false };
    }
    const extracted = extractDefinitions(text);
    if (!extracted.definitions.length) {
      return { fingerprint: extracted.fingerprint, scope: null, stale: false };
    }
    const holds: Array<() => void> = [];
    const watch: BuildWatch = {
      missed: false,
      release: () => {
        for (const release of holds.splice(0)) release();
      },
    };
    const interest = this.deps.interest;
    const scope = await this.build(page, extracted, reader, (event) => {
      if (interest) {
        holds.push(
          interest.listen(expandRefreshTriggers([event]), () => {
            watch.missed = true;
          }),
        );
      }
      track?.(event);
    });
    return { fingerprint: extracted.fingerprint, scope, stale: false, watch };
  }

  private async build(
    page: string,
    { definitions, duplicateNames, frontmatter }: ExtractedDefinitions,
    reader?: PageScopeFrame,
    track?: Tracker,
  ): Promise<PageScope> {
    const indexed = await this.deps.pageMeta?.(page).catch(() => null);
    const scope: PageScope = {
      key: `${page}#${++this.generation}`,
      env: new LuaEnv(this.deps.spaceEnv(), { boundary: true }),
      assignments: new Map(),
      blockErrors: new Map(),
      firstError: null,
      deps: new Set(),
    };
    const record = (def: Definition, result: AssignmentResult) => {
      if (def.kind === "assign") scope.assignments.set(def.name, result);
      if (!("error" in result)) return;
      if (def.kind === "block") scope.blockErrors.set(def.index, result.error);
      const label =
        def.kind === "block" ? `page-lua block ${def.index + 1}` : def.name;
      scope.firstError ??= `${label}: ${result.error}`;
    };

    const { env, sf } = renderThread(this.deps.spaceEnv(), null, {
      // The text was just read; the index can lag right after a save
      currentPage: { ...indexed, ...frontmatter, name: page },
      sourcePage: page,
      parentEnv: scope.env,
      pageScope: { chain: [...(reader?.chain ?? []), page] },
      track: (event) => {
        if (scope.deps.has(event)) return;
        scope.deps.add(event);
        // The build's watch, and an uncached build's reader
        track?.(event);
      },
    });

    let stopped = false;
    for (const def of definitions) {
      if (def.kind === "assign" && duplicateNames.has(def.name)) {
        record(def, {
          error: `\`${def.name}\` is defined more than once on this page`,
        });
        continue;
      }
      if (stopped) {
        record(def, { error: STOPPED });
        continue;
      }
      try {
        // A fresh env per definition keeps one block's locals from the next
        const defEnv = new LuaEnv(env);
        if (def.kind === "block") {
          const block = parseBlock(def.source, { ref: page });
          await evalStatement(block, defEnv, sf.withCtx(block.ctx));
          record(def, { value: null });
        } else {
          const expr = parseExpressionString(def.exprSource);
          const value = singleResult(
            await evalExpression(expr, defEnv, sf.withCtx(expr.ctx)),
          );
          scope.env.setLocal(def.name, value);
          record(def, { value });
        }
      } catch (e) {
        stopped = e instanceof LuaBudgetStopped;
        record(def, {
          error: stopped ? STOPPED : e instanceof Error ? e.message : String(e),
        });
      }
    }
    return scope;
  }
}
