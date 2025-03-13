import { parseExpressionString } from "$common/space_lua/parse.ts";
import type { LuaExpression } from "$common/space_lua/ast.ts";
import { evalExpression } from "$common/space_lua/eval.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
  luaToString,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";

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
      env.setLocal(key, envAugmentation.rawGet(key));
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
      const luaResult = luaValueToJS(
        await evalExpression(parsedExpr, env, sf),
        sf,
      );
      result += luaToString(luaResult);
    } catch (e: any) {
      throw new LuaRuntimeError(
        `Error evaluating "${expr}": ${e.message}`,
        sf,
      );
    }

    currentIndex = endIndex + 1;
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
  parseExpression: new LuaBuiltinFunction(
    (_sf, luaExpression: string) => {
      return parseExpressionString(luaExpression);
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
    (sf, template: string, envAugmentation?: LuaTable) => {
      return interpolateLuaString(sf, template, envAugmentation);
    },
  ),
  /**
   * Returns your SilverBullet instance's base URL, or `undefined` when run on the server
   */
  baseUrl: new LuaBuiltinFunction(
    () => {
      // Deal with Deno
      if (typeof location === "undefined") {
        return null;
      } else {
        return location.protocol + "//" + location.host;
      }
    },
  ),
});
