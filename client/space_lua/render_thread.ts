import { restrictedContext } from "./restricted_context.ts";
import { restrictedRenderValue } from "./restricted_render.ts";
import { toLuaData } from "./restricted_env.ts";
import type { ASTCtx } from "./ast.ts";
import {
  BUSY_LIMIT_DEFAULT_MS,
  type LuaBudget,
  makeLuaBudget,
} from "./budget.ts";
import type { Tracker } from "./dependencies.ts";
import { isTaggedFloat } from "./numeric.ts";
import {
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  type LuaValue,
  luaValueToJS,
  type PageScopeFrame,
} from "./runtime.ts";

export type RenderThreadOptions = {
  currentPage?: unknown;
  sourcePage?: string;
  // Defaults to a fresh busy-limit budget
  budget?: LuaBudget;
  renderDepth?: number;
  // Where undeclared names resolve and assignments land; defaults to `globalEnv`
  parentEnv?: LuaEnv;
  pageScope?: PageScopeFrame;
  track?: Tracker;
};

/**
 * The frame and env for evaluating page code at render time. `_CTX` is the
 * thread-local (as inside any Lua function), carrying the page.
 */
export function renderThread(
  globalEnv: LuaEnv,
  ctx: ASTCtx | null,
  opts: RenderThreadOptions = {},
): { env: LuaEnv; sf: LuaStackFrame } {
  const restricted = restrictedContext(
    globalEnv,
    opts.sourcePage,
    opts.parentEnv,
  );
  if (restricted) globalEnv = restricted.env;
  const sf = LuaStackFrame.createWithGlobalEnv(globalEnv, ctx);
  if (restricted) sf.threadState.restrictedPolicy = restricted.policy;
  const tl = sf.threadLocal;
  tl.setLocal(
    "currentPage",
    restricted ? toLuaData(opts.currentPage) : opts.currentPage,
  );
  if (opts.sourcePage)
    tl.setLocal(
      "sourcePage",
      restricted
        ? toLuaData({ name: opts.sourcePage })
        : { name: opts.sourcePage },
    );
  sf.threadState.budget =
    opts.budget ??
    makeLuaBudget({
      busyLimitMs: BUSY_LIMIT_DEFAULT_MS,
      onLimit: (b) => {
        b.stopped = true;
      },
    });
  sf.threadState.renderDepth = opts.renderDepth;
  sf.threadState.pageScope = opts.pageScope;
  sf.threadState.track = opts.track;
  // `_CTX` lives in a child env so it never becomes a page binding
  const env = new LuaEnv(opts.parentEnv ?? globalEnv);
  env.setLocal("_CTX", tl);
  return { env, sf };
}

/** A Lua result as the widget renderer takes it: numbers and tables stay Lua. */
export function toRenderValue(rawResult: LuaValue, sf: LuaStackFrame): any {
  if (sf.threadState.restrictedPolicy) return restrictedRenderValue(rawResult);
  if (isTaggedFloat(rawResult) || typeof rawResult === "number") {
    return rawResult;
  }
  if (rawResult instanceof LuaTable) return rawResult;
  return luaValueToJS(rawResult, sf);
}
