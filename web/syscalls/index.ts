import type { SysCallMapping } from "$lib/plugos/system.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "../../lib/space_lua/query_collection.ts";
import {
  jsToLuaValue,
  type LuaEnv,
  type LuaStackFrame,
} from "../../lib/space_lua/runtime.ts";

import type { Client } from "../client.ts";

type TagDef = {
  name: string;
  schema?: any;
  metatable?: any;
};

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
              const tagDef = client.config.get<Record<string, TagDef>>(
                "tagDefinitions",
                {},
              )[tag];
              if (!tagDef) {
                // Return as is
                return value;
              }
              console.log("Found this tagDef", tagDef);
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
      client.config.set(tagDef.name, tagDef);
    },
  };
}
