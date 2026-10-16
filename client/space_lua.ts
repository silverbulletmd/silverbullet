import type { System } from "./plugos/system.ts";
import type { SpaceLuaObject } from "../plugs/index/space_lua.ts";
import {
  LuaEnv,
  LuaFunction,
  luaFunctionInfo,
  LuaRuntimeError,
  LuaStackFrame,
} from "./space_lua/runtime.ts";
import { parseBlock, parseExpressionString } from "./space_lua/parse.ts";
import { evalStatement } from "./space_lua/eval.ts";
import {
  encodeRef,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { ASTCtx } from "./space_lua/ast.ts";
import { buildLuaEnv } from "./space_lua_api.ts";
import type { LuaCollectionQuery } from "./space_lua/query_collection.ts";
import type { ObjectIndex } from "./data/object_index.ts";
import {
  BUSY_LIMIT_DEFAULT_MS,
  type LuaBudget,
  LuaBudgetStopped,
  makeLuaBudget,
} from "./space_lua/budget.ts";
import {
  isQuarantined,
  quarantine,
  reconcileQuarantine,
} from "./space_lua/quarantine.ts";
import {
  type BudgetNotifier,
  offerStopNotification,
} from "./space_lua/budget_ui.ts";
import { recordMeasure } from "./lib/perf.ts";

/** How running a space script went. */
type ScriptOutcome =
  | { status: "loaded" }
  | { status: "failed"; error: unknown }
  /** Stopped by the budget during this load, and so quarantined from the next. */
  | { status: "stopped" };

/**
 * A space script in the last load. A quarantined script was skipped, so it
 * has no run time; the others record how long their run took.
 */
export type ScriptRecord = { ref: string; source: string; priority: number } & (
  | (ScriptOutcome & { ms: number })
  | { status: "quarantined" }
);

export type ScriptStatus = ScriptRecord["status"];

/** A script that ran in the last load, so it has a run time. */
export function hasRun(
  r: ScriptRecord,
): r is Extract<ScriptRecord, { ms: number }> {
  return r.status !== "quarantined";
}

/** One load of the space's scripts, in load order. */
export type ScriptLoad = {
  scripts: ScriptRecord[];
  loadedAt: number;
  ms: number;
};

export class SpaceLuaEnvironment {
  env: LuaEnv;
  /** The last completed load, replaced whole once a reload finishes. */
  lastLoad: ScriptLoad | undefined;
  private sources = new Map<string, string>();
  private loadListeners = new Set<(load: ScriptLoad) => void>();

  constructor(
    private system: System<any>,
    private objectIndex: ObjectIndex,
    private client?: { ui: BudgetNotifier },
  ) {
    this.env = buildLuaEnv(system);
  }

  private offerStop(script: SpaceLuaObject, budget: LuaBudget) {
    if (!this.client) {
      return;
    }
    offerStopNotification(
      this.client.ui,
      `Lua script ${script.ref} has been running for a while`,
      budget,
      () => quarantine(script.ref, script.script),
    );
  }

  sourceFor(ref: string): string | undefined {
    return this.sources.get(ref);
  }

  onLoad(fn: (load: ScriptLoad) => void): () => void {
    this.loadListeners.add(fn);
    return () => this.loadListeners.delete(fn);
  }

  private publish(load: ScriptLoad) {
    this.lastLoad = load;
    this.sources = new Map(load.scripts.map((s) => [s.ref, s.source]));
    for (const fn of this.loadListeners) fn(load);
  }

  /** Runs one script in the space env, logging a failure the way script loading always has. */
  private async runScript(
    script: SpaceLuaObject,
    tl: LuaEnv,
  ): Promise<ScriptOutcome> {
    try {
      const ast = parseBlock(script.script, { ref: script.ref });
      const scriptEnv = new LuaEnv(this.env);
      const budget = makeLuaBudget({
        busyLimitMs: BUSY_LIMIT_DEFAULT_MS,
        onLimit: (b) => this.offerStop(script, b),
      });
      const sf = new LuaStackFrame(tl, ast.ctx, undefined, undefined, {
        closeStack: undefined,
        budget,
      });
      try {
        await evalStatement(ast, scriptEnv, sf);
      } finally {
        budget.finished = true;
      }
      return { status: "loaded" };
    } catch (e: any) {
      if (e instanceof LuaBudgetStopped) {
        console.info(`Script ${script.ref} stopped by the user`);
        return { status: "stopped" };
      }
      const origin =
        e instanceof LuaRuntimeError ? resolveASTReference(e.sf.astCtx!) : null;
      if (origin) {
        console.error(
          `Error evaluating script: ${e.message} at [[${encodeRef(origin)}]]`,
          e,
        );
      } else {
        console.error(
          `Error evaluating script: ${e.message} for script: ${script.script}`,
          e,
        );
      }
      return { status: "failed", error: e };
    }
  }

  /**
   * Loads all Lua scripts from the database and evaluates them in a new environment
   * @param system
   */
  async reload() {
    const allScripts: SpaceLuaObject[] = await this.objectIndex.queryLuaObjects(
      this.env,
      "space-lua",
      {
        objectVariable: "script",
        orderBy: [
          {
            expr: parseExpressionString("script.priority or 0"),
            desc: true,
            nulls: "first",
          },
          {
            expr: parseExpressionString("script.ref"),
            desc: false,
          },
        ],
      } as LuaCollectionQuery,
    );
    reconcileQuarantine(allScripts.map((script) => script.ref));
    const records: ScriptRecord[] = [];
    const totalStart = performance.now();
    try {
      this.env = buildLuaEnv(this.system);
      const tl = new LuaEnv();
      tl.setLocal("_GLOBAL", this.env);
      for (const script of allScripts) {
        const base = {
          ref: script.ref,
          source: script.script,
          priority: script.priority ?? 0,
        };
        if (isQuarantined(script.ref, script.script)) {
          records.push({ ...base, status: "quarantined" });
          continue;
        }
        const scriptStart = performance.now();
        const outcome = await this.runScript(script, tl);
        const ms = performance.now() - scriptStart;
        recordMeasure(
          `sb:lua-script:${script.ref}`,
          scriptStart,
          scriptStart + ms,
        );
        records.push({ ...base, ...outcome, ms });
      }

      const slowest = records
        .filter(hasRun)
        .filter((r) => r.ms >= 2)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3)
        .map((r) => `${r.ref} ${r.ms.toFixed(1)}ms`)
        .join(", ");
      console.log(
        `[Lua] Loaded ${allScripts.length} scripts in ${Math.round(
          performance.now() - totalStart,
        )}ms${slowest ? ` (slowest: ${slowest})` : ""}`,
      );
    } catch (e: any) {
      console.error("Error reloading Lua scripts:", e.message);
    }
    this.publish({
      scripts: records,
      loadedAt: Date.now(),
      ms: performance.now() - totalStart,
    });
  }
}

export function resolveASTReference(ctx?: ASTCtx): Ref | null {
  if (!ctx?.ref) {
    return null;
  }
  const ref = parseToRef(ctx.ref);
  if (!ref) {
    return null;
  }

  if (ref.details?.type === "position") {
    ref.details.pos =
      (ref.details.pos as number) + "```space-lua\n".length + ctx.from!;
  }

  return ref;
}

export function luaDefinitionRef(fn: unknown): Ref | null {
  const info =
    fn instanceof LuaFunction
      ? fn.info
      : typeof fn === "function"
        ? (fn as typeof fn & { [luaFunctionInfo]?: LuaFunction["info"] })[
            luaFunctionInfo
          ]
        : undefined;
  return info?.kind === "lua" ? resolveASTReference(info.source) : null;
}
