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
    "index.indexObjects": (ctx, page: string, objects: ObjectValue<any>[]) => {
      return system.syscall(ctx, "system.invokeFunction", [
        "index.indexObjects",
        page,
        objects,
      ]);
    },
    "index.queryObjects": (
      ctx,
      tag: string,
      query: ObjectQuery,
      ttlSecs?: number,
    ) => {
      return system.syscall(ctx, "system.invokeFunction", [
        "index.queryObjects",
        tag,
        query,
        ttlSecs,
      ]);
    },
    "index.queryLuaObjects": (
      ctx,
      tag: string,
      query: LuaCollectionQuery,
      scopedVariables?: Record<string, any>,
    ) => {
      return system.syscall(ctx, "system.invokeFunction", [
        "index.queryLuaObjects",
        tag,
        query,
        scopedVariables,
      ]);
    },
    "index.queryDeleteObjects": (ctx, tag: string, query: ObjectQuery) => {
      return system.syscall(ctx, "system.invokeFunction", [
        "index.queryDeleteObjects",
        tag,
        query,
      ]);
    },
    "index.query": (ctx, query: KvQuery, variables?: Record<string, any>) => {
      return system.syscall(ctx, "system.invokeFunction", [
        "index.query",
        query,
        variables,
      ]);
    },
    "index.getObjectByRef": (ctx, page: string, tag: string, ref: string) => {
      return system.syscall(ctx, "system.invokeFunction", [
        "index.getObjectByRef",
        page,
        tag,
        ref,
      ]);
    },
  };
}
