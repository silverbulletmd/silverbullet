import type { System } from "./plugos/system.ts";
import type { SpaceLuaObject } from "../plugs/index/space_lua.ts";
import { LuaEnv, LuaRuntimeError, LuaStackFrame } from "./space_lua/runtime.ts";
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

export class SpaceLuaEnvironment {
  env: LuaEnv;

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
    try {
      this.env = buildLuaEnv(this.system);
      const tl = new LuaEnv();
      tl.setLocal("_GLOBAL", this.env);
      const totalStart = performance.now();
      const scriptTimings: [string, number][] = [];
      for (const script of allScripts) {
        if (isQuarantined(script.ref, script.script)) {
          continue;
        }
        const scriptStart = performance.now();
        try {
          const ast = parseBlock(script.script, { ref: script.ref });
          // We create a local scope for each script
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
        } catch (e: any) {
          if (e instanceof LuaBudgetStopped) {
            console.info(`Script ${script.ref} stopped by the user`);
            continue;
          }
          if (e instanceof LuaRuntimeError) {
            const origin = resolveASTReference(e.sf.astCtx!);
            if (origin) {
              console.error(
                `Error evaluating script: ${e.message} at [[${encodeRef(
                  origin,
                )}]]`,
              );
              continue;
            }
          }
          console.error(
            `Error evaluating script: ${e.message} for script: ${script.script}`,
            e,
          );
        } finally {
          const duration = performance.now() - scriptStart;
          scriptTimings.push([script.ref, duration]);
          performance.measure(`sb:lua-script:${script.ref}`, {
            start: scriptStart,
            end: scriptStart + duration,
          });
        }
      }

      const slowest = scriptTimings
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .filter(([, ms]) => ms >= 2)
        .map(([ref, ms]) => `${ref} ${ms.toFixed(1)}ms`)
        .join(", ");
      console.log(
        `[Lua] Loaded ${allScripts.length} scripts in ${Math.round(
          performance.now() - totalStart,
        )}ms${slowest ? ` (slowest: ${slowest})` : ""}`,
      );
    } catch (e: any) {
      console.error("Error reloading Lua scripts:", e.message);
    }
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
