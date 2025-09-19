import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { evalExpression } from "../../lib/space_lua/eval.ts";
import { parse, parseExpressionString } from "../../lib/space_lua/parse.ts";
import {
  LuaStackFrame,
  luaToString,
  luaValueToJS,
} from "../../lib/space_lua/runtime.ts";
import { buildThreadLocalEnv } from "../space_lua_api.ts";
import { isSendable } from "../../lib/plugos/util.ts";
import type { LuaBlock, LuaExpression } from "../../lib/space_lua/ast.ts";
import type { ClientSystem } from "../client_system.ts";

export function luaSyscalls(clientSystem: ClientSystem): SysCallMapping {
  return {
    "lua.parse": (_ctx, code: string): LuaBlock => {
      return parse(code);
    },
    "lua.parseExpression": (_ctx, expression: string): LuaExpression => {
      return parseExpressionString(expression);
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
          clientSystem.system,
          clientSystem.spaceLuaEnv.env,
        );
        const sf = new LuaStackFrame(env, null);
        const luaResult = await evalExpression(
          ast,
          clientSystem.spaceLuaEnv.env,
          sf,
        );
        const jsResult = luaValueToJS(luaResult, sf);
        if (isSendable(jsResult)) {
          return jsResult;
        } else {
          // This may evaluate to e.g. a function, which is not sendable, in this case we'll console.warn and return a stringified version of the result
          console.warn(
            "Lua eval result is not sendable, returning stringified version",
            jsResult,
          );
          return luaToString(luaResult);
        }
      } catch (e: any) {
        console.error("Lua eval error: ", e.message, e.sf?.astCtx);
        throw e;
      }
    },
  };
}
