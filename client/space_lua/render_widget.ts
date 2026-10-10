import type { ASTCtx } from "./ast.ts";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import {
  type ILuaFunction,
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  LuaTable,
  type LuaValue,
  luaValueToJS,
  singleResult,
} from "./runtime.ts";
import {
  BUSY_LIMIT_DEFAULT_MS,
  LUA_TIMEOUT_MESSAGE,
  type LuaBudget,
  LuaBudgetStopped,
  makeLuaBudget,
} from "./budget.ts";
import { isTaggedFloat } from "./numeric.ts";
import {
  encodeRef,
  getNameFromPath,
} from "@silverbulletmd/silverbullet/lib/ref";
import { resolveASTReference } from "../space_lua.ts";
import type { Client } from "../client.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";

import { isLuaWidgetError } from "./render_lua_markdown.ts";

export { isLuaWidgetError };

export type EvalForRenderOptions = {
  currentPage?: { name: string };
  sourcePage?: string;
  budget?: LuaBudget;
  // Widget nesting depth of the render this evaluation belongs to
  renderDepth?: number;
  stoppedMessage?: () => string;
};

/**
 * Run a Space Lua computation for rendering, with `_CTX.currentPage` (and
 * `_CTX.sourcePage`) set, and convert the result like the widget renderer
 * expects. Errors and timeouts become markdown error strings.
 */
export async function evaluateForRender(
  sle: SpaceLuaEnvironment,
  compute: (env: LuaEnv, sf: LuaStackFrame) => Promise<LuaValue> | LuaValue,
  ctx: ASTCtx,
  opts: EvalForRenderOptions = {},
): Promise<any> {
  const currentPage = opts.currentPage;
  // The rendered error only shows inside the page; also log one line so it
  // reaches the runtime log (`sb logs`).
  const logError = (msg: string) => {
    console.error(
      `Lua widget error on ${currentPage?.name ?? "(unknown page)"}: ${msg.replace(/\s*\n\s*/g, " ")}`,
    );
  };
  try {
    const tl = new LuaEnv();
    tl.setLocal("currentPage", currentPage);
    if (opts.sourcePage) tl.setLocal("sourcePage", { name: opts.sourcePage });
    const sf = LuaStackFrame.createWithGlobalEnv(sle.env, ctx);
    sf.threadState.budget =
      opts.budget ??
      makeLuaBudget({
        busyLimitMs: BUSY_LIMIT_DEFAULT_MS,
        onLimit: (b) => {
          b.stopped = true;
        },
      });
    sf.threadState.renderDepth = opts.renderDepth;
    const env = new LuaEnv(sle.env);
    env.setLocal("_CTX", tl);
    const rawResult = singleResult(await compute(env, sf));
    if (isTaggedFloat(rawResult) || typeof rawResult === "number") {
      return rawResult;
    }
    if (rawResult instanceof LuaTable) return rawResult;
    return luaValueToJS(rawResult, sf);
  } catch (e: any) {
    if (e instanceof LuaBudgetStopped) {
      logError("timed out; the widget took too long to render and was stopped");
      if (opts.stoppedMessage) return opts.stoppedMessage();
      return LUA_TIMEOUT_MESSAGE;
    }
    logError(e.message);
    if (e instanceof LuaRuntimeError && e.sf?.astCtx) {
      const source = resolveASTReference(e.sf.astCtx);
      if (source) {
        return `**Lua error:** ${e.message} (Origin: [[${encodeRef(source)}]])`;
      }
    }
    return `**Lua error:** ${e.message}`;
  }
}

/**
 * Run a Space Lua computation and convert its result into something the
 * LuaWidget renderer understands (a widget table, markdown string, or number).
 * Shared by the `${...}` directive and Lua code widgets so the conversion +
 * error formatting live in one place.
 */
export async function renderLuaWidgetResult(
  client: Client,
  compute: (env: LuaEnv, sf: LuaStackFrame) => Promise<LuaValue> | LuaValue,
  ctx: ASTCtx,
  currentPageMeta?: { name: string } | undefined,
): Promise<any> {
  const currentPage =
    currentPageMeta ||
    (client.ui.viewState.current
      ? { name: getNameFromPath(client.ui.viewState.current.path) }
      : undefined);
  return evaluateForRender(client.clientSystem.spaceLuaEnv, compute, ctx, {
    currentPage,
    sourcePage: currentPage?.name,
  });
}

/** Evaluate a `${...}`-style expression string and render it as a widget. */
export async function renderLuaExpression(
  client: Client,
  expressionText: string,
  currentPageMeta?: { name: string } | undefined,
): Promise<any> {
  if (expressionText.trim().length === 0) {
    return "**Error:** Empty Lua expression";
  }
  let expr: ReturnType<typeof parseExpressionString>;
  try {
    expr = parseExpressionString(expressionText);
  } catch (e) {
    // Report syntax errors like evaluation errors instead of rendering nothing
    return renderLuaWidgetResult(
      client,
      () => {
        throw e;
      },
      {} as ASTCtx,
      currentPageMeta,
    );
  }
  return renderLuaWidgetResult(
    client,
    (env, sf) => evalExpression(expr, env, sf),
    expr.ctx,
    currentPageMeta,
  );
}

/** Call a stored Lua render function (e.g. a code widget) and render it. */
export async function renderLuaCallback(
  client: Client,
  fn: ILuaFunction,
  args: LuaValue[],
  currentPageMeta?: { name: string } | undefined,
): Promise<any> {
  return renderLuaWidgetResult(
    client,
    (_env, sf) => fn.call(sf, ...args),
    {} as ASTCtx,
    currentPageMeta,
  );
}
