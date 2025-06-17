import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "../../lib/space_lua/query_collection.ts";
import {
  jsToLuaValue,
  type LuaEnv,
  type LuaStackFrame,
  type LuaTable,
} from "../../lib/space_lua/runtime.ts";

import type { Client } from "../client.ts";

export function indexSyscalls(client: Client): SysCallMapping {
  return {
    "index.tag": (_ctx, tagName: string): LuaQueryCollection => {
      return {
        query: (
          query: LuaCollectionQuery,
          env: LuaEnv,
          sf: LuaStackFrame,
        ): Promise<any[]> => {
          return client.ds.luaQuery(
            ["idx", tagName],
            query,
            env,
            sf,
            (key, value: any) => {
              const tag = key[1];
              const tagDef = client.config.get<LuaTable | undefined>(
                ["tagDefinitions", tag],
                undefined,
              );
              if (!tagDef || !tagDef.has("metatable")) {
                // Return as is
                return value;
              }
              // Convert to LuaTable
              value = jsToLuaValue(value);
              value.metatable = tagDef.get("metatable");
              return value;
            },
          );
        },
      };
    },
    "lua:index.defineTag": (_ctx, tagDef: LuaTable) => {
      // Using 'lua:' prefix to _not_ convert tagDef to a JS version (but keep original LuaTable)
      if (!tagDef.has("name")) {
        throw new Error("A tag name is required");
      }
      client.config.set(["tagDefinitions", tagDef.get("name")], tagDef);
    },
  };
}
