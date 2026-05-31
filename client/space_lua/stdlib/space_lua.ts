import { parseBlock, parseExpressionString } from "../parse.ts";
import type { LuaBlock, LuaExpression } from "../ast.ts";
import { evalExpression } from "../eval.ts";
import {
  type PrintOptions,
  prettyPrintBlock,
  prettyPrintExpression,
} from "../pretty_print.ts";
import {
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
  /**
   * Parses a lua expression and returns the parsed expression.
   *
   * @param sf - The current space_lua state.
   * @param luaExpression - The lua expression to parse.
   * @returns The parsed expression.
   */
  parseExpression: new LuaBuiltinFunction((_sf, luaExpression: string) => {
    return parseExpressionString(luaExpression);
  }),
  /**
   * Parses a lua chunk (block) and returns the parsed AST block.
   *
   * @param sf - The current space_lua state.
   * @param code - The lua code to parse.
   * @returns The parsed block.
   */
  parseBlock: new LuaBuiltinFunction((_sf, code: string): LuaBlock => {
    return parseBlock(code);
  }),
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
  ),
  /**
   * Returns your SilverBullet instance's base URL
   */
  baseUrl: new LuaBuiltinFunction(() => {
    //NOTE: Removing trailing slash to stay compatible with original code: `location.protocol + "//" + location.host;`
    return document.baseURI.replace(/\/*$/, "");
  }),
});
