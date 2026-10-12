import type { ASTCtx } from "./ast.ts";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import {
  type ILuaFunction,
  type LuaEnv,
  LuaRuntimeError,
  type LuaStackFrame,
  type LuaValue,
  singleResult,
} from "./runtime.ts";
import {
  LUA_TIMEOUT_MESSAGE,
  type LuaBudget,
  LuaBudgetStopped,
} from "./budget.ts";
import { assignmentRenderValue, type PageScope } from "./page_scope.ts";
import { renderThread, toRenderValue } from "./render_thread.ts";
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
  // Page scope to evaluate in; defaults to the space env
  parentEnv?: LuaEnv;
  onPageVarsRead?: (page: string) => void;
};

type PageScopeOpts = Pick<EvalForRenderOptions, "parentEnv" | "onPageVarsRead">;

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
    const { env, sf } = renderThread(sle.env, ctx, {
      currentPage,
      sourcePage: opts.sourcePage,
      budget: opts.budget,
      renderDepth: opts.renderDepth,
      parentEnv: opts.parentEnv,
      pageScope: opts.onPageVarsRead
        ? { chain: [], onRead: opts.onPageVarsRead }
        : undefined,
    });
    return toRenderValue(singleResult(await compute(env, sf)), sf);
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
  opts: PageScopeOpts = {},
): Promise<any> {
  const currentPage =
    currentPageMeta ||
    (client.ui.viewState.current
      ? { name: getNameFromPath(client.ui.viewState.current.path) }
      : undefined);
  return evaluateForRender(client.clientSystem.spaceLuaEnv, compute, ctx, {
    currentPage,
    sourcePage: currentPage?.name,
    ...opts,
  });
}

/** Evaluate a `${...}`-style expression string and render it as a widget. */
export async function renderLuaExpression(
  client: Client,
  expressionText: string,
  currentPageMeta?: { name: string } | undefined,
  opts: PageScopeOpts = {},
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
      opts,
    );
  }
  return renderLuaWidgetResult(
    client,
    (env, sf) => evalExpression(expr, env, sf),
    expr.ctx,
    currentPageMeta,
    opts,
  );
}

/**
 * Render a `${…}` body of a page against that page's scope: an assignment
 * shows its value, anything else evaluates with the page's bindings in reach.
 */
export async function renderPageDirective(
  client: Client,
  expressionText: string,
  currentPageMeta: { name: string } | undefined,
  scope: PageScope | null,
  opts: {
    assignmentName?: string;
    onPageVarsRead?: (page: string) => void;
  } = {},
): Promise<any> {
  if (opts.assignmentName) {
    return assignmentRenderValue(scope, opts.assignmentName);
  }
  return renderLuaExpression(client, expressionText, currentPageMeta, {
    parentEnv: scope?.env,
    onPageVarsRead: opts.onPageVarsRead,
  });
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
