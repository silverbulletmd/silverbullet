import type { SysCallMapping } from "$lib/plugos/system.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { parse, parseExpressionString } from "../space_lua/parse.ts";
import type { CommonSystem } from "$common/common_system.ts";
import { LuaStackFrame, luaValueToJS } from "$common/space_lua/runtime.ts";
import { buildThreadLocalEnv } from "$common/space_lua_api.ts";

export function luaSyscalls(commonSystem: CommonSystem): SysCallMapping {
  return {
    "lua.parse": (_ctx, code: string) => {
      return parse(code);
    },
    /**
     * Evaluates a Lua expression and returns the result as a JavaScript value
     * @param _ctx
     * @param expression
     * @returns
     */
    "lua.evalExpression": async (_ctx, expression: string) => {
      try {
        const ast = parseExpressionString(expression);
        const env = await buildThreadLocalEnv(
          commonSystem.system,
          commonSystem.spaceLuaEnv.env,
        );
        const sf = new LuaStackFrame(env, null);
        return luaValueToJS(
          evalExpression(ast, commonSystem.spaceLuaEnv.env, sf),
        );
      } catch (e: any) {
        console.error("Lua eval error: ", e.message, e.sf?.astCtx);
        throw e;
      }
    },
  };
}
