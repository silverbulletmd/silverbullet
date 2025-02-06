import type { SysCallMapping } from "$lib/plugos/system.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import { parse, parseExpressionString } from "../space_lua/parse.ts";
import type { CommonSystem } from "$common/common_system.ts";
import { LuaStackFrame, luaValueToJS } from "$common/space_lua/runtime.ts";

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
    "lua.evalExpression": (_ctx, expression: string) => {
      const ast = parseExpressionString(expression);
      return luaValueToJS(
        evalExpression(
          ast,
          commonSystem.spaceLuaEnv.env,
          LuaStackFrame.lostFrame,
        ),
      );
    },
  };
}
