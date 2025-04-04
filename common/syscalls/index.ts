import type { SysCallMapping } from "$lib/plugos/system.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "$common/space_lua/query_collection.ts";
import {
  jsToLuaValue,
  type LuaEnv,
  type LuaStackFrame,
} from "$common/space_lua/runtime.ts";

import type { Client } from "../../web/client.ts";
import type { TagDef } from "$common/space_script.ts";

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
              const tagDef = client.clientSystem.scriptEnv.tagDefs[tag];
              if (!tagDef) {
                // Return as is
                return value;
              }
              // Convert to LuaTable
              value = jsToLuaValue(value);
              value.metatable = tagDef.metatable;
              return value;
            },
          );
        },
      };
    },
    "index.defineTag": (_ctx, tagDef: TagDef) => {
      client.clientSystem.scriptEnv.registerTag(tagDef);
    },
  };
}
