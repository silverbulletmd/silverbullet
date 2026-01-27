import type { SysCallMapping } from "../system.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "../../space_lua/query_collection.ts";
import type { LuaTable } from "../../space_lua/runtime.ts";

import type { ObjectIndex } from "../../data/object_index.ts";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Client } from "../../client.ts";

export function indexSyscalls(
  objectIndex: ObjectIndex,
  client: Client,
): SysCallMapping {
  return {
    "index.tag": (_ctx, tagName: string): LuaQueryCollection => {
      return objectIndex.tag(tagName);
    },
    "index.ensureFullIndex": (_ctx) => {
      return objectIndex.ensureFullIndex(client.space);
    },
    "index.reindexSpace": () => {
      return objectIndex.reindexSpace(client.space);
    },
    "index.indexObjects": (
      _ctx,
      page: string,
      objects: ObjectValue[],
    ): Promise<void> => {
      return objectIndex.indexObjects(page, objects);
    },
    "index.getObjectByRef": (
      _ctx,
      page: string,
      tag: string,
      ref: string,
    ): Promise<ObjectValue | undefined> => {
      return objectIndex.getObjectByRef(ref, page, tag);
    },
    "index.queryLuaObjects": (
      _ctx,
      tag: string,
      query: LuaCollectionQuery,
      scopedVariables?: Record<string, any>,
    ): Promise<ObjectValue[]> => {
      return objectIndex.queryLuaObjects(
        client.clientSystem.spaceLuaEnv.env,
        tag,
        query,
        scopedVariables,
      );
    },

    "index.deleteObject": (
      _ctx,
      page: string,
      tag: string,
      ref: string,
    ): Promise<void> => {
      return objectIndex.deleteObject(page, tag, ref);
    },
  };
}
