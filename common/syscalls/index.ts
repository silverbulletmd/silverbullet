import type {
  KvQuery,
  ObjectQuery,
  ObjectValue,
} from "@silverbulletmd/silverbullet/types";
import type { SysCallMapping, System } from "$lib/plugos/system.ts";
import type { LuaCollectionQuery } from "$common/space_lua/query_collection.ts";

// These are just wrappers around the system.invokeFunction calls, but they make it easier to use the index

export function indexSyscalls(system: System<any>): SysCallMapping {
  return {
    "index.indexObjects": (_ctx, page: string, objects: ObjectValue<any>[]) => {
      return system.invokeFunction("index.indexObjects", [page, objects]);
    },
    "index.queryObjects": (
      _ctx,
      tag: string,
      query: ObjectQuery,
      ttlSecs?: number,
    ) => {
      return system.invokeFunction("index.queryObjects", [
        tag,
        query,
        ttlSecs,
      ]);
    },
    "index.queryLuaObjects": (
      _ctx,
      tag: string,
      query: LuaCollectionQuery,
      scopedVariables?: Record<string, any>,
    ) => {
      return system.invokeFunction(
        "index.queryLuaObjects",
        [tag, query, scopedVariables],
      );
    },
    "index.queryDeleteObjects": (_ctx, tag: string, query: ObjectQuery) => {
      return system.invokeFunction("index.queryDeleteObjects", [tag, query]);
    },
    "index.query": (_ctx, query: KvQuery, variables?: Record<string, any>) => {
      return system.invokeFunction("index.query", [query, variables]);
    },
    "index.getObjectByRef": (_ctx, page: string, tag: string, ref: string) => {
      return system.invokeFunction("index.getObjectByRef", [page, tag, ref]);
    },
  };
}
