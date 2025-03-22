import type { SysCallMapping } from "$lib/plugos/system.ts";
import {
  type LuaCollectionQuery,
  type LuaQueryCollection,
  queryLua,
} from "$common/space_lua/query_collection.ts";
import type { LuaEnv, LuaStackFrame } from "$common/space_lua/runtime.ts";

import type { KvPrimitives } from "$lib/data/kv_primitives.ts";

export function indexSyscalls(kv: KvPrimitives): SysCallMapping {
  return {
    "index.tag": (_ctx, tagName: string): LuaQueryCollection => {
      return {
        query: (
          query: LuaCollectionQuery,
          env: LuaEnv,
          sf: LuaStackFrame,
        ): Promise<any[]> => {
          return queryLua(kv, ["idx", tagName], query, env, sf);
        },
      };
    },
  };
}
