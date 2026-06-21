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
import { isTaggedFloat } from "./numeric.ts";
import {
  encodeRef,
  getNameFromPath,
} from "@silverbulletmd/silverbullet/lib/ref";
import { resolveASTReference } from "../space_lua.ts";
import type { Client } from "../client.ts";

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
  try {
    const tl = new LuaEnv();
    tl.setLocal(
      "currentPage",
      currentPageMeta ||
        (client.ui.viewState.current
          ? { name: getNameFromPath(client.ui.viewState.current.path) }
          : undefined),
    );
    const sf = LuaStackFrame.createWithGlobalEnv(
      client.clientSystem.spaceLuaEnv.env,
      ctx,
    );
    const env = new LuaEnv(client.clientSystem.spaceLuaEnv.env);
    env.setLocal("_CTX", tl);
    const rawResult = singleResult(await compute(env, sf));
    if (isTaggedFloat(rawResult) || typeof rawResult === "number") {
      return rawResult;
    }
    if (rawResult instanceof LuaTable) {
      if (rawResult.rawGet("_isWidget")) {
        return luaValueToJS(rawResult, sf);
      }
      return rawResult;
    }
    return luaValueToJS(rawResult, sf);
  } catch (e: any) {
    if (e instanceof LuaRuntimeError && e.sf?.astCtx) {
      const source = resolveASTReference(e.sf.astCtx);
      if (source) {
        return `**Lua error:** ${e.message} (Origin: [[${
          encodeRef(source)
        }]])`;
      }
    }
    return `**Lua error:** ${e.message}`;
  }
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
  const expr = parseExpressionString(expressionText);
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
