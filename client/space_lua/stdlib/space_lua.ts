import type { LuaFunctionInfo } from "../../../plug-api/types/index.ts";
import { renderApiDocumentationMarkdown } from "../api_documentation.ts";
import type { LuaBlock, LuaExpression } from "../ast.ts";
import { evalExpression } from "../eval.ts";
import { parseBlock, parseExpressionString } from "../parse.ts";
import {
  type PrintOptions,
  prettyPrintBlock,
  prettyPrintExpression,
} from "../pretty_print.ts";
import {
  type ILuaFunction,
  isILuaFunction,
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaEnv,
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
  luaToString,
  luaValueToJS,
  singleResult,
} from "../runtime.ts";
import { isSqlNull } from "../sliq_null.ts";

/**
 * These are Space Lua specific functions that are available to all scripts, but are not part of the standard Lua language.
 */

/**
 * Helper function to create an augmented environment
 */
function createAugmentedEnv(
  sf: LuaStackFrame,
  envAugmentation?: LuaTable,
): LuaEnv {
  const globalEnv = sf.threadLocal.get("_GLOBAL");
  if (!globalEnv) {
    throw new Error("_GLOBAL not defined");
  }
  const env = new LuaEnv(globalEnv);
  if (envAugmentation) {
    env.setLocal("_", envAugmentation);
    for (const key of envAugmentation.keys()) {
      const v = envAugmentation.rawGet(key);
      env.setLocal(key, isSqlNull(v) ? null : v);
    }
  }
  return env;
}

function globalEnv(sf: LuaStackFrame): LuaEnv {
  const env = sf.threadLocal.get("_GLOBAL");
  if (!(env instanceof LuaEnv)) {
    throw new Error("_GLOBAL not defined");
  }
  return env;
}

function resolveApiValue(
  sf: LuaStackFrame,
  path: string,
): ILuaFunction | LuaTable | LuaEnv | null {
  let value: any = globalEnv(sf);
  for (const part of path.split(".")) {
    if (value instanceof LuaEnv || value instanceof LuaTable) {
      value = value.get(part, sf);
    } else {
      return null;
    }
    if (value && typeof value.then === "function") {
      throw new Error("Cannot describe asynchronously resolved API values");
    }
    if (value === null || value === undefined) return null;
  }
  return value;
}

function functionInfo(
  value: unknown,
  resolvedName?: string,
): LuaFunctionInfo | null {
  if (!isILuaFunction(value)) return null;
  return {
    ...(value.info ?? { kind: "builtin" }),
    name: value.info?.name ?? resolvedName,
  };
}

function describeFunction(
  value: unknown,
  resolvedName?: string,
): LuaTable | null {
  const info = functionInfo(value, resolvedName);
  return info ? (jsToLuaValue(info) as LuaTable) : null;
}

function listFunctionInfo(
  sf: LuaStackFrame,
  target?: LuaTable | string,
): LuaFunctionInfo[] {
  let namespace: LuaTable | LuaEnv;
  let prefix = "";
  if (typeof target === "string") {
    const resolved = resolveApiValue(sf, target);
    if (!(resolved instanceof LuaTable) && !(resolved instanceof LuaEnv)) {
      return [];
    }
    namespace = resolved;
    prefix = `${target}.`;
  } else if (target instanceof LuaTable) {
    namespace = target;
  } else {
    namespace = globalEnv(sf);
  }

  const functions: LuaFunctionInfo[] = [];
  for (const key of [...new Set(namespace.keys())].sort()) {
    const value = namespace.get(key, sf);
    if (value && typeof (value as any).then === "function") continue;
    const info = functionInfo(value, `${prefix}${key}`);
    if (info) functions.push(info);
  }
  return functions;
}

function functionNamespace(info: LuaFunctionInfo): string | undefined {
  const separator = info.name?.lastIndexOf(".") ?? -1;
  return separator > 0 ? info.name!.slice(0, separator) : undefined;
}

function apiDocumentationTarget(
  sf: LuaStackFrame,
  target?: ILuaFunction | LuaTable | string,
): { functions: LuaFunctionInfo[]; context?: string } {
  if (typeof target === "string") {
    const resolved = resolveApiValue(sf, target);
    const info = functionInfo(resolved, target);
    if (info) {
      return { functions: [info], context: functionNamespace(info) };
    }
    if (resolved instanceof LuaTable || resolved instanceof LuaEnv) {
      return { functions: listFunctionInfo(sf, target), context: target };
    }
    return { functions: [], context: target };
  }

  const info = functionInfo(target);
  if (info) {
    return { functions: [info], context: functionNamespace(info) };
  }
  if (target instanceof LuaTable) {
    return { functions: listFunctionInfo(sf, target) };
  }
  return { functions: listFunctionInfo(sf) };
}

/**
 * Interpolates a string with lua expressions and returns the result.
 *
 * @param sf - The current space_lua state.
 * @param template - The template string to interpolate.
 * @param envAugmentation - An optional environment to augment the global environment with.
 * @returns The interpolated string.
 */
export async function interpolateLuaString(
  sf: LuaStackFrame,
  template: string,
  envAugmentation?: LuaTable,
): Promise<string> {
  let result = "";
  let currentIndex = 0;

  while (true) {
    const startIndex = template.indexOf("${", currentIndex);
    if (startIndex === -1) {
      result += template.slice(currentIndex);
      break;
    }

    result += template.slice(currentIndex, startIndex);

    // Find matching closing brace by counting nesting
    let nestLevel = 1;
    let endIndex = startIndex + 2;
    while (nestLevel > 0 && endIndex < template.length) {
      if (template[endIndex] === "{") {
        nestLevel++;
      } else if (template[endIndex] === "}") {
        nestLevel--;
      }
      if (nestLevel > 0) {
        endIndex++;
      }
    }

    if (nestLevel > 0) {
      throw new LuaRuntimeError("Unclosed interpolation expression", sf);
    }

    const expr = template.slice(startIndex + 2, endIndex);
    try {
      const parsedExpr = parseExpressionString(expr);
      const env = createAugmentedEnv(sf, envAugmentation);
      // Do `luaToString` before `luaValueToJS` to preserve tagged float
      // formatting.
      const luaResult = singleResult(await evalExpression(parsedExpr, env, sf));
      result += await luaToString(luaResult);
    } catch (e: any) {
      throw new LuaRuntimeError(`Error evaluating "${expr}": ${e.message}`, sf);
    }

    currentIndex = endIndex + 1;
  }

  return result;
}

/**
 * Converts an optional Lua options table into a `PrintOptions` object,
 * keeping only the recognised keys with the expected types.
 */
function toPrintOptions(
  sf: LuaStackFrame,
  opts?: LuaTable,
): PrintOptions | undefined {
  if (!opts) return undefined;
  const js = luaValueToJS(opts, sf) as Record<string, unknown>;
  const result: PrintOptions = {};
  if (typeof js.indentWidth === "number") result.indentWidth = js.indentWidth;
  if (js.quote === "double" || js.quote === "single") result.quote = js.quote;
  if (typeof js.trailingComma === "boolean") {
    result.trailingComma = js.trailingComma;
  }
  return result;
}

export const spaceluaApi = new LuaTable({
  describe: new LuaBuiltinFunction(
    (sf, target: ILuaFunction | string) => {
      const value =
        typeof target === "string" ? resolveApiValue(sf, target) : target;
      return describeFunction(
        value,
        typeof target === "string" ? target : undefined,
      );
    },
    {
      kind: "builtin",
      description:
        "Returns structured documentation for a Lua function value or dotted API name.",
      parameters: [
        {
          name: "functionOrName",
          type: "function|string",
          description: "Function value or dotted API name to inspect.",
        },
      ],
      returns: [
        {
          type: "table|nil",
          description:
            "Structured function metadata, or `nil` when the target is not a function.",
        },
      ],
      examples: [
        {
          code: 'local info = spacelua.describe(editor.getText)\nprint(info.name, info.kind, info.see)\n\nlocal sameInfo = spacelua.describe("editor.getText")',
        },
      ],
      see: "API/spacelua",
    },
  ),
  listFunctions: new LuaBuiltinFunction(
    (sf, target?: LuaTable | string) =>
      jsToLuaValue(listFunctionInfo(sf, target)),
    {
      kind: "builtin",
      description:
        "Lists documented functions in the global environment or an API namespace.",
      parameters: [
        {
          name: "namespace",
          type: "table|string",
          description: "Namespace table or dotted name; omit for globals.",
          optional: true,
        },
      ],
      returns: [{ type: "table", description: "Function metadata records." }],
      examples: [
        {
          code: 'for info in each(spacelua.listFunctions("editor")) do\n  print(info.name, info.description or info.see)\nend',
        },
      ],
      see: "API/spacelua",
    },
  ),
  renderApiDocumentation: new LuaBuiltinFunction(
    (sf, target?: ILuaFunction | LuaTable | string): string => {
      const selection = apiDocumentationTarget(sf, target);
      return renderApiDocumentationMarkdown(
        selection.functions,
        selection.context,
      );
    },
    {
      kind: "builtin",
      description:
        "Renders API documentation for a function, namespace, or the global environment as Markdown.",
      parameters: [
        {
          name: "target",
          type: "function|table|string",
          description:
            "Function value, namespace table, or dotted API name to document; omit for globals.",
          optional: true,
        },
      ],
      returns: [{ type: "string", description: "Rendered Markdown." }],
      examples: [
        {
          code: '${spacelua.renderApiDocumentation("lua")}',
          description: "Render a namespace as a live API-page directive.",
          language: "markdown",
        },
        {
          code: '${spacelua.renderApiDocumentation("editor.getText")}',
          description: "Render one function by its dotted API name.",
          language: "markdown",
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Parses a lua expression and returns the parsed expression.
   *
   * @param sf - The current space_lua state.
   * @param luaExpression - The lua expression to parse.
   * @returns The parsed expression.
   */
  parseExpression: new LuaBuiltinFunction(
    (_sf, luaExpression: string) => {
      return parseExpressionString(luaExpression);
    },
    {
      kind: "builtin",
      description: "Parses a Lua expression and returns its AST.",
      parameters: [
        {
          name: "luaExpression",
          type: "string",
          description: "Lua expression to parse.",
        },
      ],
      returns: [{ type: "table", description: "Parsed expression AST." }],
      examples: [
        {
          code: 'local parsed = spacelua.parseExpression("1 + 1")',
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Parses a lua chunk (block) and returns the parsed AST block.
   *
   * @param sf - The current space_lua state.
   * @param code - The lua code to parse.
   * @returns The parsed block.
   */
  parseBlock: new LuaBuiltinFunction(
    (_sf, code: string): LuaBlock => {
      return parseBlock(code);
    },
    {
      kind: "builtin",
      description:
        "Parses a Lua chunk and returns its AST. Blocks retain comments in source order with their exact text, kind, and source range.",
      parameters: [
        { name: "code", type: "string", description: "Lua code to parse." },
      ],
      returns: [{ type: "table", description: "Parsed block AST." }],
      examples: [
        {
          code: 'local parsed = spacelua.parseBlock("local x = 1\\nreturn x + 2")',
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Pretty-prints a parsed lua block AST back to formatted source.
   *
   * @param sf - The current space_lua state.
   * @param block - The parsed lua block.
   * @param opts - Optional formatting options.
   * @returns The formatted lua source.
   */
  prettyPrintBlock: new LuaBuiltinFunction(
    (sf, block: LuaBlock, opts?: LuaTable): string => {
      return prettyPrintBlock(block, toPrintOptions(sf, opts));
    },
    {
      kind: "builtin",
      description:
        "Pretty-prints a parsed Lua block AST. Comments are preserved while their placement and indentation are normalized.",
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
          code: 'local formatted = spacelua.prettyPrintBlock(spacelua.parseBlock("if a then return 1 end"))\nprint(formatted)',
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Pretty-prints a parsed lua expression AST back to formatted source.
   *
   * @param sf - The current space_lua state.
   * @param expr - The parsed lua expression.
   * @param opts - Optional formatting options.
   * @returns The formatted lua source.
   */
  prettyPrintExpression: new LuaBuiltinFunction(
    (sf, expr: LuaExpression, opts?: LuaTable): string => {
      return prettyPrintExpression(expr, toPrintOptions(sf, opts));
    },
    {
      kind: "builtin",
      description: "Pretty-prints a parsed Lua expression AST.",
      parameters: [
        {
          name: "parsedExpr",
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
          code: 'local parsed = spacelua.parseExpression("{a=1,b=2}")\nprint(spacelua.prettyPrintExpression(parsed))',
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Evaluates a parsed lua expression and returns the result.
   *
   * @param sf - The current space_lua state.
   * @param parsedExpr - The parsed lua expression to evaluate.
   * @param envAugmentation - An optional environment to augment the global environment with.
   * @returns The result of the evaluated expression.
   */
  evalExpression: new LuaBuiltinFunction(
    async (sf, parsedExpr: LuaExpression, envAugmentation?: LuaTable) => {
      const env = createAugmentedEnv(sf, envAugmentation);
      return luaValueToJS(await evalExpression(parsedExpr, env, sf), sf);
    },
    {
      kind: "builtin",
      description:
        "Evaluates a parsed Lua expression, optionally with additional environment values.",
      parameters: [
        {
          name: "parsedExpr",
          type: "table",
          description: "Parsed expression AST.",
        },
        {
          name: "envAugmentation",
          type: "table",
          description: "Values added to the expression environment.",
          optional: true,
        },
      ],
      returns: [{ description: "Evaluated result." }],
      examples: [
        {
          code: 'local parsed = spacelua.parseExpression("x + y")\nlocal result = spacelua.evalExpression(parsed, {x = 1, y = 2})\nprint(result)',
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Interpolates a string with lua expressions and returns the result.
   */
  interpolate: new LuaBuiltinFunction(
    (sf, template: string, envAugmentation?: LuaTable | any) => {
      if (envAugmentation && !(envAugmentation instanceof LuaTable)) {
        envAugmentation = jsToLuaValue(envAugmentation);
      }
      return interpolateLuaString(sf, template, envAugmentation);
    },
    {
      kind: "builtin",
      description:
        "Interpolates `${...}` Lua expressions in a string, optionally with additional environment values.",
      parameters: [
        {
          name: "template",
          type: "string",
          description: "Template containing `${...}` expressions.",
        },
        {
          name: "envAugmentation",
          type: "table",
          description: "Values added to the interpolation environment.",
          optional: true,
        },
      ],
      returns: [{ type: "string", description: "Interpolated string." }],
      examples: [
        {
          code: 'local greeting = spacelua.interpolate("Hello ${name}!", {name = "Pete"})\nprint(greeting)',
        },
      ],
      see: "API/spacelua",
    },
  ),
  /**
   * Returns your SilverBullet instance's base URL
   */
  baseUrl: new LuaBuiltinFunction(
    () => {
      //NOTE: Removing trailing slash to stay compatible with original code: `location.protocol + "//" + location.host;`
      return document.baseURI.replace(/\/*$/, "");
    },
    {
      kind: "builtin",
      description:
        "Returns the SilverBullet instance's base URL, or `nil` when run on the server.",
      returns: [{ type: "string|nil" }],
      examples: [{ code: "local url = spacelua.baseUrl()\nprint(url)" }],
      see: "API/spacelua",
    },
  ),
});
