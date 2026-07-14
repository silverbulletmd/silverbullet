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
import {
  classifyResult,
  renderResultToCleanMarkdown,
} from "./render_lua_markdown.ts";

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
        return `**Lua error:** ${e.message} (Origin: [[${encodeRef(source)}]])`;
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

export type PortableMarkdownResult =
  | { ok: true; markdown: string }
  | { ok: false; reason: string };

/**
 * Evaluate a `${...}`-style expression and produce portable GFM markdown — the
 * same clean rendering the Copy button uses — or report why it can't be baked.
 * - nil/empty → ok with empty markdown
 * - Lua error → not ok (the eval error string)
 * - widget object: portable only if it exposes a `markdown` rendering;
 *   html-only widgets are not bakeable
 * - scalars / tables / arrays / strings → clean GFM
 */
export async function expressionToPortableMarkdown(
  client: Client,
  expressionText: string,
  currentPageMeta?: { name: string } | undefined,
): Promise<PortableMarkdownResult> {
  const rawResult = await renderLuaExpression(
    client,
    expressionText,
    currentPageMeta,
  );
  if (rawResult === null || rawResult === undefined) {
    return { ok: true, markdown: "" };
  }
  // renderLuaExpression returns eval failures as markdown error strings.
  if (
    typeof rawResult === "string" &&
    (rawResult.startsWith("**Lua error:**") ||
      rawResult.startsWith("**Error:**"))
  ) {
    return { ok: false, reason: rawResult };
  }
  // Widget objects: portable only when they expose a `markdown` rendering.
  if (typeof rawResult === "object" && (rawResult as any)._isWidget) {
    const md = (rawResult as any).markdown;
    if (typeof md === "string") {
      return { ok: true, markdown: md.trim() };
    }
    return { ok: false, reason: "html-only widget (no markdown rendering)" };
  }
  // Scalars, tables, arrays, plain strings → clean GFM markdown.
  const markdown = await renderResultToCleanMarkdown(
    rawResult,
    classifyResult(rawResult),
  );
  return { ok: true, markdown };
}
