import type { ClientSystem } from "../../client_system.ts";
import type { LuaBlock, LuaExpression } from "../../space_lua/ast.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseBlock, parseExpressionString } from "../../space_lua/parse.ts";
import {
  type PrintOptions,
  prettyPrintBlock,
  prettyPrintExpression,
} from "../../space_lua/pretty_print.ts";
import {
  LuaStackFrame,
  luaToString,
  luaValueToJS,
} from "../../space_lua/runtime.ts";
import { buildThreadLocalEnv } from "../../space_lua_api.ts";
import type { SysCallMapping } from "../system.ts";
import { isSendable } from "../util.ts";

export function luaSyscalls(clientSystem: ClientSystem): SysCallMapping {
  return {
    "lua.parseBlock": {
      callback: (_ctx, code: string): LuaBlock => parseBlock(code),
      description:
        "Parses a Space Lua chunk and returns its AST. Blocks retain comments in source order with their exact text, kind, and source range.",
      parameters: [
        { name: "code", type: "string", description: "Lua code to parse." },
      ],
      returns: [{ type: "table", description: "Parsed Lua block AST." }],
      examples: [
        {
          code: 'local ast = lua.parseBlock("print(\\"Hello\\")")',
        },
      ],
      see: "API/lua",
    },
    // Deprecated alias for `lua.parseBlock`, kept for backwards compatibility.
    "lua.parse": {
      callback: (_ctx, code: string): LuaBlock => parseBlock(code),
      description: "Deprecated alias for lua.parseBlock.",
      parameters: [
        { name: "code", type: "string", description: "Lua code to parse." },
      ],
      returns: [{ type: "table", description: "Parsed Lua block AST." }],
      deprecated: "Use lua.parseBlock instead.",
      see: "API/lua",
    },
    "lua.parseExpression": {
      callback: (_ctx, expression: string): LuaExpression =>
        parseExpressionString(expression),
      description: "Parses a Space Lua expression and returns its AST.",
      parameters: [
        {
          name: "expression",
          type: "string",
          description: "Lua expression to parse.",
        },
      ],
      returns: [{ type: "table", description: "Parsed expression AST." }],
      examples: [
        {
          code: 'local expression = lua.parseExpression("1 + 2 * 3")',
        },
      ],
      see: "API/lua",
    },
    "lua.prettyPrintBlock": {
      callback: (_ctx, block: LuaBlock, opts?: PrintOptions): string =>
        prettyPrintBlock(block, opts),
      description:
        "Pretty-prints a parsed Space Lua block. Comments are preserved while their placement and indentation are normalized.",
      parameters: [
        { name: "block", type: "table", description: "Parsed block AST." },
        {
          name: "options",
          type: "table",
          description:
            "Formatting options: `indentWidth`, `quote`, and `trailingComma`.",
          optional: true,
        },
      ],
      returns: [{ type: "string", description: "Formatted Lua source." }],
      examples: [
        {
          code: 'local formatted = lua.prettyPrintBlock(lua.parseBlock("if a then return 1 end"))',
        },
      ],
      see: "API/lua",
    },
    "lua.prettyPrintExpression": {
      callback: (
        _ctx,
        expression: LuaExpression,
        opts?: PrintOptions,
      ): string => prettyPrintExpression(expression, opts),
      description: "Pretty-prints a parsed Space Lua expression.",
      parameters: [
        {
          name: "expression",
          type: "table",
          description: "Parsed expression AST.",
        },
        {
          name: "options",
          type: "table",
          description:
            "Formatting options: `indentWidth`, `quote`, and `trailingComma`.",
          optional: true,
        },
      ],
      returns: [{ type: "string", description: "Formatted Lua source." }],
      examples: [
        {
          code: 'local formatted = lua.prettyPrintExpression(lua.parseExpression("{a=1,b=2}"))',
        },
      ],
      see: "API/lua",
    },
    /**
     * Evaluates a Lua expression and returns the result as a JavaScript value
     * @param _ctx
     * @param expression
     * @returns
     */
    "lua.evalExpression": {
      callback: async (_ctx, expression: string) => {
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
      description: "Evaluates a Space Lua expression.",
      parameters: [
        {
          name: "expression",
          type: "string",
          description: "Lua expression to evaluate.",
        },
      ],
      returns: [{ description: "Evaluated result." }],
      examples: [
        {
          code: 'local result = lua.evalExpression("1 + 2 * 3")\nprint(result)',
        },
      ],
      see: "API/lua",
    },
  };
}
