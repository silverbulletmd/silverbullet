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
import type { ASTCtx, LuaBlock, NumericType } from "./ast.ts";
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

type DefState = {
  def: Definition;
  status: "pending" | "running" | "done";
  done?: Promise<void>;
  block?: LuaBlock;
  // The definitions it is waiting on, counted: the cycle check walks these
  waitingOn: Map<DefState, number>;
  // What reading this cell raises once it has failed
  failure?: string;
  // Set when the definition is part of a circular reference
  cycle?: string;
  // The first failure raised by something it read
  readFailure?: string;
  // The first cell name it tried to assign
  touched?: string;
};

type PageEnvHooks = {
  // Evaluates the definitions of `name` that `frame`'s reader needs first
  resolve: (name: string, frame?: LuaStackFrame) => Promise<void> | undefined;
  // false: the write is refused
  write: (name: string, frame?: LuaStackFrame) => boolean;
};

/** The page scope's env: while it builds, reads evaluate what they need. */
class PageEnv extends LuaEnv {
  hooks?: PageEnvHooks;

  override get(
    name: string,
    sf?: LuaStackFrame,
  ): Promise<LuaValue> | LuaValue | null {
    const pending = this.hooks?.resolve(name, sf);
    if (pending) return pending.then(() => super.get(name, sf));
    return super.get(name, sf);
  }

  override set(
    key: string,
    value: LuaValue,
    sf?: LuaStackFrame,
    numType?: NumericType,
  ): void {
    if (this.hooks && !this.hooks.write(key, sf)) return;
    super.set(key, value, sf, numType);
  }
}

/** Globals a block assigns at its top level: what reading them evaluates. */
function blockDefines(block: LuaBlock): string[] {
  const names: string[] = [];
  for (const statement of block.statements) {
    if (statement.type === "Function") {
      const { propNames, colonName } = statement.name;
      if (propNames.length === 1 && !colonName) names.push(propNames[0]);
    } else if (statement.type === "Assignment") {
      for (const v of statement.variables) {
        if (v.type === "Variable") names.push(v.name);
      }
    }
  }
  return names;
}

/** A chain of waits from `from` to `to`, starting with `from`, if any. */
function waitPath(from: DefState, to: DefState): DefState[] | undefined {
  const seen = new Set<DefState>();
  const visit = (state: DefState): DefState[] | undefined => {
    if (state === to) return [state];
    if (seen.has(state)) return;
    seen.add(state);
    for (const next of state.waitingOn.keys()) {
      const rest = visit(next);
      if (rest) return [state, ...rest];
    }
  };
  return visit(from);
}

function cycleLabel(def: Definition): string {
  return def.kind === "block"
    ? `page-lua block ${def.index + 1}`
    : `\`${def.name}\``;
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
        new Error(`pageVars: cycle ${[...chain, page].join(" → ")}`),
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
      ? Promise.reject(new Error(`pageVars: page ${page} not found`))
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
    const pageEnv = new PageEnv(this.deps.spaceEnv(), { boundary: true });
    const scope: PageScope = {
      key: `${page}#${++this.generation}`,
      env: pageEnv,
      assignments: new Map(),
      blockErrors: new Map(),
      firstError: null,
      deps: new Set(),
    };
    const pageScope: PageScopeFrame = {
      chain: [...(reader?.chain ?? []), page],
    };
    const { env, sf } = renderThread(this.deps.spaceEnv(), null, {
      // The text was just read; the index can lag right after a save
      currentPage: { ...indexed, ...frontmatter, name: page },
      sourcePage: page,
      parentEnv: pageEnv,
      pageScope,
      track: (event) => {
        if (scope.deps.has(event)) return;
        scope.deps.add(event);
        // The build's watch, and an uncached build's reader
        track?.(event);
      },
    });

    const states: DefState[] = definitions.map((def) => ({
      def,
      status: "pending",
      waitingOn: new Map(),
    }));
    const own = new Set(states);
    // Which definitions assign each name: reading the name evaluates them
    const owners = new Map<string, DefState[]>();
    const addOwner = (name: string, state: DefState) => {
      const list = owners.get(name);
      if (!list) owners.set(name, [state]);
      else if (!list.includes(state)) list.push(state);
    };
    // Names a `${name = …}` cell owns: blocks may not reassign them, so the
    // value a cell shows is the value the page uses
    const cellNames = new Set<string>();
    for (const state of states) {
      if (state.def.kind === "assign") {
        cellNames.add(state.def.name);
        addOwner(state.def.name, state);
      }
    }
    for (const state of states) {
      if (state.def.kind !== "block") continue;
      try {
        state.block = parseBlock(state.def.source, { ref: page });
      } catch {
        // Reported when the block runs
        continue;
      }
      for (const name of blockDefines(state.block)) {
        if (!cellNames.has(name)) addOwner(name, state);
      }
    }

    const record = (state: DefState, result: AssignmentResult) => {
      const { def } = state;
      if (def.kind === "assign") scope.assignments.set(def.name, result);
      if (!("error" in result)) return;
      if (def.kind === "block") scope.blockErrors.set(def.index, result.error);
      else state.failure ??= `\`${def.name}\` failed: ${result.error}`;
    };
    for (const state of states) {
      const { def } = state;
      if (def.kind === "assign" && duplicateNames.has(def.name)) {
        const error = `\`${def.name}\` is defined more than once on this page`;
        state.status = "done";
        state.failure = error;
        record(state, { error });
      }
    }

    const readerOf = (frame?: LuaStackFrame): DefState | undefined => {
      const d = frame?.threadState.pageScope?.definition as DefState;
      return own.has(d) ? d : undefined;
    };
    // A read failing in `reader` becomes its own error, whatever wraps it
    const fail = (reader: DefState | undefined, message: string): never => {
      if (reader) reader.readFailure ??= message;
      throw new Error(message);
    };
    const circular = (reader: DefState, path: DefState[]): never => {
      // Named from the member highest on the page, so every member agrees
      const first = Math.min(...path.map((p) => states.indexOf(p)));
      const at = path.indexOf(states[first]);
      const cycle = [...path.slice(at), ...path.slice(0, at)];
      const message = `circular reference: ${[...cycle, cycle[0]]
        .map((p) => cycleLabel(p.def))
        .join(" → ")}`;
      for (const member of path) member.cycle ??= message;
      return fail(reader, message);
    };

    let stopped = false;
    const evaluate = async (state: DefState): Promise<void> => {
      const { def } = state;
      if (stopped) return record(state, { error: STOPPED });
      try {
        // A fresh env per definition keeps one block's locals from the next
        const defEnv = new LuaEnv(env);
        const defSf = (ctx: ASTCtx) =>
          new LuaStackFrame(sf.threadLocal, ctx, undefined, undefined, {
            ...sf.threadState,
            closeStack: undefined,
            pageScope: { ...pageScope, definition: state },
          });
        if (def.kind === "block") {
          const block = state.block ?? parseBlock(def.source, { ref: page });
          await evalStatement(block, defEnv, defSf(block.ctx));
          if (state.touched) {
            const name = state.touched;
            throw new Error(
              `\`${name}\` is defined by a \${${name} = …} cell on this page`,
            );
          }
          record(state, { value: null });
        } else {
          const expr = parseExpressionString(def.exprSource);
          const value = singleResult(
            await evalExpression(expr, defEnv, defSf(expr.ctx)),
          );
          if (state.touched) {
            const name = state.touched;
            throw new Error(
              `\`${name}\` is defined by a \${${name} = …} cell on this page`,
            );
          }
          pageEnv.setLocal(def.name, value);
          record(state, { value });
        }
      } catch (e) {
        if (e instanceof LuaBudgetStopped) stopped = true;
        const message = e instanceof Error ? e.message : String(e);
        const error = stopped
          ? STOPPED
          : (state.cycle ?? state.readFailure ?? message);
        // A cell failing because of what it read fails the same way for its
        // readers, instead of nesting the message
        if (
          def.kind === "assign" &&
          !stopped &&
          (state.cycle || state.readFailure)
        ) {
          state.failure = error;
        }
        record(state, { error });
      } finally {
        state.status = "done";
      }
    };
    const start = (state: DefState): Promise<void> => {
      state.status = "running";
      state.done = evaluate(state);
      return state.done;
    };
    const wait = (reader: DefState, target: DefState): Promise<void> => {
      const count = reader.waitingOn.get(target) ?? 0;
      reader.waitingOn.set(target, count + 1);
      const done = target.status === "pending" ? start(target) : target.done!;
      return done.finally(() => {
        const left = reader.waitingOn.get(target)! - 1;
        if (left) reader.waitingOn.set(target, left);
        else reader.waitingOn.delete(target);
      });
    };

    pageEnv.hooks = {
      resolve: (name, frame) => {
        const owned = owners.get(name);
        if (!owned) return;
        const reader = readerOf(frame);
        const waits: Promise<void>[] = [];
        for (const target of owned) {
          if (target === reader) {
            // A block may read its own globals before assigning them
            if (target.def.kind === "assign") circular(reader, [reader]);
            continue;
          }
          // Waiting without knowing who waits could wait on itself
          if (target.status === "done" || !reader) continue;
          if (target.status === "running") {
            const path = waitPath(target, reader);
            if (path) circular(reader, path);
          }
          waits.push(wait(reader, target));
        }
        const check = () => {
          for (const target of owned) {
            if (target !== reader && target.failure) {
              fail(reader, target.failure);
            }
          }
        };
        if (!waits.length) return void check();
        return Promise.all(waits).then(check);
      },
      write: (name, frame) => {
        if (!cellNames.has(name)) return true;
        const writer = readerOf(frame);
        if (writer) writer.touched ??= name;
        return false;
      },
    };

    for (const state of states) {
      if (state.status === "pending") await start(state);
    }
    pageEnv.hooks = undefined;

    for (const { def } of states) {
      const error =
        def.kind === "block"
          ? scope.blockErrors.get(def.index)
          : (scope.assignments.get(def.name) as { error?: string }).error;
      if (error === undefined) continue;
      const label =
        def.kind === "block" ? `page-lua block ${def.index + 1}` : def.name;
      scope.firstError = `${label}: ${error}`;
      break;
    }
    return scope;
  }
}
