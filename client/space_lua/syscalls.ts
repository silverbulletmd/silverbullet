import type { ASTCtx, LuaBlock, LuaExpression } from "./ast.ts";
import { evalExpression } from "./eval.ts";
import { parseBlock, parseExpressionString } from "./parse.ts";
import {
  type PrintOptions,
  prettyPrintBlock,
  prettyPrintExpression,
} from "./pretty_print.ts";
import {
  isILuaFunction,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaGet,
  luaKeys,
  luaToString,
  luaTypeOf,
  luaValueToJS,
} from "./runtime.ts";
import { buildThreadLocalEnv } from "../space_lua_api.ts";
import type { SysCallMapping, System } from "../plugos/system.ts";
import { isSendable } from "../plugos/util.ts";
import type {
  LuaFunctionInfo,
  LuaPropertyInspection,
  LuaValueInspection,
} from "../../plug-api/types/index.ts";
import { encodeRef } from "../../plug-api/lib/ref.ts";
import { resolveASTReference } from "../space_lua.ts";

async function inspectValue(
  value: unknown,
  path: string[],
): Promise<Omit<LuaValueInspection, "properties">> {
  const type = value instanceof LuaEnv ? "table" : await luaTypeOf(value);
  if (!isILuaFunction(value)) {
    return { type };
  }
  const functionInfo: LuaFunctionInfo = {
    ...(value.info ?? { kind: "builtin" }),
    name: value.info?.name ?? path.join("."),
  };
  const definitionRef =
    functionInfo.kind === "lua" && functionInfo.source
      ? resolveASTReference(functionInfo.source as ASTCtx)
      : null;
  return {
    type,
    functionInfo,
    definition: definitionRef ? encodeRef(definitionRef) : undefined,
  };
}

async function inspectLuaPath(
  env: LuaEnv,
  path: string[],
): Promise<LuaValueInspection | null> {
  const sf = LuaStackFrame.createWithGlobalEnv(env);
  let value: unknown = env;
  for (const key of path) {
    value = await luaGet(value, key, null, sf);
    if (value === null || value === undefined) {
      return null;
    }
  }

  const properties: LuaPropertyInspection[] = [];
  const keys =
    value instanceof LuaEnv
      ? value.keys()
      : value instanceof LuaTable ||
          Array.isArray(value) ||
          (typeof value === "object" && value !== null)
        ? luaKeys(value)
        : [];
  for (const key of [...new Set(keys)]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .sort()) {
    const child = await luaGet(value, key, null, sf);
    if (child === null || child === undefined) continue;
    properties.push({
      key,
      ...(await inspectValue(child, [...path, key])),
    });
  }

  return {
    ...(await inspectValue(value, path)),
    properties,
  };
}

export function luaSyscalls(
  system: System<any>,
  getEnvironment: () => LuaEnv,
): SysCallMapping {
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
          const globalEnv = getEnvironment();
          const env = await buildThreadLocalEnv(system, globalEnv);
          const sf = new LuaStackFrame(env, null);
          const luaResult = await evalExpression(ast, globalEnv, sf);
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
    "lua.inspect": {
      callback: (_ctx, path: string[] = []) =>
        inspectLuaPath(getEnvironment(), path),
      description:
        "Inspects a value in the live Space Lua environment and returns serializable type, function, definition, and property metadata.",
      parameters: [
        {
          name: "path",
          type: "table",
          description:
            "Sequence of property names from the global environment; omit to inspect globals.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "table|nil",
          description:
            "Inspection metadata, or nil when the requested path does not exist.",
        },
      ],
      examples: [
        {
          code: 'local info = lua.inspect({"editor", "getText"})',
        },
      ],
      see: "API/lua",
    },
  };
}
