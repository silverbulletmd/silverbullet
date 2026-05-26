import type { SysCallMapping } from "../system.ts";
import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "../../space_lua/query_collection.ts";

import {
  type ObjectIndex,
  ObjectValidationError,
} from "../../data/object_index.ts";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { Client } from "../../client.ts";
import type { LuaTable } from "../../space_lua/runtime.ts";

export function indexSyscalls(
  objectIndex: ObjectIndex,
  client: Client,
): SysCallMapping {
  return {
    // Query collection API
    "index.tag": (_ctx, tagName: string): LuaQueryCollection => {
      return objectIndex.objectsWithTag(tagName);
    },
    // Alias for tag
    "index.objects": (_ctx, tagName: string): LuaQueryCollection => {
      return objectIndex.objectsWithTag(tagName);
    },
    "index.pages": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.rootTaggedObjects("page", tagName);
    },
    "index.subPages": (_ctx, pageName: string): LuaQueryCollection => {
      return objectIndex.subPages(pageName);
    },
    "index.documents": (): LuaQueryCollection => {
      return objectIndex.objectsWithTag("document");
    },
    "index.links": (): LuaQueryCollection => {
      return objectIndex.objectsWithTag("link");
    },
    "index.relations": (): LuaQueryCollection => {
      return objectIndex.objectsWithTag("relation");
    },
    "index.contentPages": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.contentPages(tagName);
    },
    "index.metaPages": (): LuaQueryCollection => {
      return objectIndex.metaPages();
    },
    "index.tasks": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.rootTaggedObjects("task", tagName);
    },
    "index.headers": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.rootTaggedObjects("header", tagName);
    },
    "index.items": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.rootTaggedObjects("item", tagName);
    },
    "index.paragraphs": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.rootTaggedObjects("paragraph", tagName);
    },
    "index.tables": (_ctx, tagName?: string): LuaQueryCollection => {
      return objectIndex.rootTaggedObjects("table", tagName);
    },
    "index.tags": (): LuaQueryCollection => {
      return objectIndex.objectsWithTag("tag");
    },
    "index.aspiringPages": (): LuaQueryCollection => {
      return objectIndex.aspiringPages();
    },
    // Internals
    "index.aggregates": (): LuaQueryCollection => {
      return objectIndex.aggregates();
    },
    "index.ensureFullIndex": () => {
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
    "index.validateObjects": async (
      _ctx,
      page: string,
      objects: ObjectValue[],
    ): Promise<{ error: string; object: ObjectValue } | null> => {
      try {
        await objectIndex.validateObjects(page, objects);
        return null;
      } catch (e: any) {
        if (e instanceof ObjectValidationError) {
          return {
            error: e.message,
            object: e.object,
          };
        } else {
          throw e;
        }
      }
    },
    "index.previewProcessedObjects": (
      _ctx,
      page: string,
      objects: ObjectValue[],
    ): Promise<{ tag: string; object: ObjectValue }[]> => {
      return objectIndex.previewProcessedObjects(page, objects);
    },
    "index.getObjectByRef": (
      _ctx,
      page: string,
      tag: string,
      ref: string,
    ): Promise<ObjectValue | undefined> => {
      return objectIndex.getObjectByRef(page, tag, ref);
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
    "lua:index.defineTag": (_ctx, tagDef: LuaTable) => {
      // Using 'lua:' prefix to _not_ convert tagDef to a JS version (but keep original LuaTable)
      if (!tagDef.has("name")) {
        throw new Error("A tag name is required");
      }
      const currentTag = client.config.get(["tags", tagDef.get("name")], null);
      if (!currentTag) {
        client.config.set(["tags", tagDef.get("name")], {
          name: tagDef.get("name"),
        });
      }
      client.config.set(
        ["tags", tagDef.get("name"), "metatable"],
        tagDef.get("metatable"),
      );
    },
  };
}
