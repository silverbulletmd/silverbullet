import { LuaBudgetStopped } from "./budget.ts";
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
  // Pages the definitions read with `space.pageVars`, also through the pages
  // they read: a change to any of them invalidates this scope
  reads: Set<string>;
};

export type PageScopesDeps = {
  readPageText: (name: string) => Promise<string | null>;
  spaceEnv: () => LuaEnv;
  // Indexed meta for `_CTX.currentPage`, overlaid with the page's frontmatter
  pageMeta?: (name: string) => Promise<Record<string, unknown> | null>;
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
};

export class PageScopes {
  // In least recently used order
  private entries = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<PageScope | null>>();
  private generation = 0;

  constructor(private deps: PageScopesDeps) {}

  private entry(page: string): Entry | undefined {
    const entry = this.entries.get(page);
    if (entry) this.store(page, entry);
    return entry;
  }

  private store(page: string, entry: Entry): void {
    this.entries.delete(page);
    this.entries.set(page, entry);
    if (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
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
  get(page: string, reader?: PageScopeFrame): Promise<PageScope | null> {
    const chain = reader?.chain ?? [];
    if (chain.includes(page)) {
      return Promise.reject(
        new Error(`space.pageVars: cycle ${[...chain, page].join(" → ")}`),
      );
    }
    const entry = this.entry(page);
    if (entry && !entry.stale) return this.found(page, entry);
    // A build reading another page builds its own, uncached copy: joining a
    // shared build could wait on a build that waits on us, a cycle no chain
    // would show
    if (reader && chain.length) {
      return this.load(page, reader).then((e) => this.found(page, e));
    }
    let p = this.inFlight.get(page);
    if (!p) {
      const created: Promise<PageScope | null> = this.load(page).then(
        (e) => {
          // pageChanged and clear drop an invalidated build from `inFlight`
          if (this.inFlight.get(page) !== created) return this.found(page, e);
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
      ? Promise.reject(new Error(`space.pageVars: page ${page} not found`))
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
    const invalidated: string[] = [];
    const visit = (p: string) => {
      if (invalidated.includes(p)) return;
      invalidated.push(p);
      const e = this.entries.get(p);
      if (e) e.stale = true;
      this.inFlight.delete(p);
      for (const [reader, { scope }] of this.entries) {
        if (scope?.reads.has(p)) visit(reader);
      }
    };
    visit(page);
    // Never built and nobody read it: nothing to tell
    return known || invalidated.length > 1 ? invalidated : [];
  }

  clear(): void {
    this.inFlight.clear();
    this.entries.clear();
  }

  private async load(page: string, reader?: PageScopeFrame): Promise<Entry> {
    const text = await this.deps.readPageText(page);
    if (text === null) {
      // Cached, so the page's creation invalidates whoever tried to read it
      return { fingerprint: MISSING, scope: undefined, stale: false };
    }
    const extracted = extractDefinitions(text);
    const scope = extracted.definitions.length
      ? await this.build(page, extracted, reader)
      : null;
    return { fingerprint: extracted.fingerprint, scope, stale: false };
  }

  private async build(
    page: string,
    { definitions, duplicateNames, frontmatter }: ExtractedDefinitions,
    reader?: PageScopeFrame,
  ): Promise<PageScope> {
    const indexed = await this.deps.pageMeta?.(page).catch(() => null);
    const scope: PageScope = {
      key: `${page}#${++this.generation}`,
      env: new LuaEnv(this.deps.spaceEnv(), { boundary: true }),
      assignments: new Map(),
      blockErrors: new Map(),
      firstError: null,
      reads: new Set(),
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
      pageScope: {
        chain: [...(reader?.chain ?? []), page],
        onRead: (target) => {
          scope.reads.add(target);
          // An uncached build's reads count as its reader's own
          reader?.onRead?.(target);
        },
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
