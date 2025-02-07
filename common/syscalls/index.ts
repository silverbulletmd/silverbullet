import type { SysCallMapping } from "$lib/plugos/system.ts";
import {
  findAllQueryVariables,
  type LuaCollectionQuery,
  type LuaQueryCollection,
} from "$common/space_lua/query_collection.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  type LuaStackFrame,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";
import type { CommonSystem } from "$common/common_system.ts";

// These are just wrappers around the system.invokeFunction calls, but they make it easier to use the index

export function indexSyscalls(commonSystem: CommonSystem): SysCallMapping {
  return {
    "index.tag": (_ctx, tagName: string): LuaQueryCollection => {
      return {
        query: async (
          query: LuaCollectionQuery,
          env: LuaEnv,
          sf: LuaStackFrame,
        ): Promise<any[]> => {
          const global = commonSystem.spaceLuaEnv.env;
          const localVars = findAllQueryVariables(query).filter((v) =>
            !global.has(v) && v !== "_"
          );
          const scopedVariables: Record<string, any> = {};
          for (const v of localVars) {
            try {
              let value = env.get(v);
              if (value instanceof LuaEnv) {
                // We don't want to include the global environment in the serialized value
                value = value.toJSON(["_GLOBAL"]);
              }
              const jsonValue = await luaValueToJS(value);
              // Ensure this is JSON serializable
              JSON.stringify(jsonValue);
              scopedVariables[v] = jsonValue;
            } catch (e: any) {
              console.error(
                "Failed to JSON serialize variable",
                v,
                e,
              );
              throw new LuaRuntimeError(
                `Failed to JSON serialize variable ${v} in query`,
                sf,
              );
            }
          }
          return (await global.get("datastore").get("queryLua").call(
            sf,
            [
              "idx",
              tagName,
            ],
            query,
            scopedVariables,
          )).toJSArray();
        },
      };
    },
  };
}
