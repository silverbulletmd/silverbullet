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
import { describeSchemas, tagSchema } from "./schema_introspection.ts";

export function indexSyscalls(
  objectIndex: ObjectIndex,
  client: Client,
): SysCallMapping {
  return {
    // Query collection API
    "index.tag": {
      callback: (_ctx, tagName: string): LuaQueryCollection => {
        return objectIndex.objectsWithTag(tagName);
      },
      description: "Returns objects carrying a tag as a query collection.",
      signatures: ["index.tag(tagName)"],
    },
    // Alias for tag
    "index.objects": {
      callback: (_ctx, tagName: string): LuaQueryCollection => {
        return objectIndex.objectsWithTag(tagName);
      },
      description: "Returns objects carrying a tag as a query collection.",
      signatures: ["index.objects(tagName)"],
    },
    "index.pages": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.rootTaggedObjects("page", tagName);
      },
      description:
        "Returns all pages, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.pages(tagName?)"],
    },
    "index.subPages": {
      callback: (_ctx, pageName: string): LuaQueryCollection => {
        return objectIndex.subPages(pageName);
      },
      description:
        "Returns pages nested below a page name as a query collection.",
      signatures: ["index.subPages(pageName)"],
    },
    "index.documents": {
      callback: (): LuaQueryCollection => {
        return objectIndex.objectsWithTag("document");
      },
      description: "Returns all indexed documents as a query collection.",
    },
    "index.links": {
      callback: (): LuaQueryCollection => {
        return objectIndex.objectsWithTag("link");
      },
      description: "Returns all indexed links as a query collection.",
    },
    "index.relations": {
      callback: (): LuaQueryCollection => {
        return objectIndex.objectsWithTag("relation");
      },
      description: "Returns all indexed relations as a query collection.",
    },
    "index.contentPages": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.contentPages(tagName);
      },
      description:
        "Returns non-meta pages, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.contentPages(tagName?)"],
    },
    "index.metaPages": {
      callback: (): LuaQueryCollection => {
        return objectIndex.metaPages();
      },
      description: "Returns all meta pages as a query collection.",
    },
    "index.tasks": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.rootTaggedObjects("task", tagName);
      },
      description:
        "Returns all tasks, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.tasks(tagName?)"],
    },
    "index.headers": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.rootTaggedObjects("header", tagName);
      },
      description:
        "Returns all headers, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.headers(tagName?)"],
    },
    "index.items": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.rootTaggedObjects("item", tagName);
      },
      description:
        "Returns all list items, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.items(tagName?)"],
    },
    "index.paragraphs": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.rootTaggedObjects("paragraph", tagName);
      },
      description:
        "Returns indexed paragraphs, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.paragraphs(tagName?)"],
    },
    "index.tables": {
      callback: (_ctx, tagName?: string): LuaQueryCollection => {
        return objectIndex.rootTaggedObjects("table", tagName);
      },
      description:
        "Returns indexed table rows, optionally filtered by an additional tag, as a query collection.",
      signatures: ["index.tables(tagName?)"],
    },
    "index.tags": {
      callback: (): LuaQueryCollection => {
        return objectIndex.objectsWithTag("tag");
      },
      description: "Returns all indexed tag objects as a query collection.",
    },
    // Schema introspection: indexed object-type / tag schemas
    "index.describeSchema": {
      callback: (): Record<string, unknown> => {
        return describeSchemas(client.config.get(["tags"], {}));
      },
      description:
        "Returns raw JSON Schemas for every configured tag that declares one.",
    },
    "index.tagSchema": {
      callback: (_ctx, tagName: string): unknown | null => {
        return tagSchema(client.config.get(["tags"], {}), tagName);
      },
      description:
        "Returns the raw JSON Schema for a tag, or nil when none is declared.",
      signatures: ["index.tagSchema(tagName)"],
    },
    "index.aspiringPages": {
      callback: (): LuaQueryCollection => {
        return objectIndex.aspiringPages();
      },
      description:
        "Returns linked but not yet created pages as a query collection.",
    },
    // Internals
    "index.aggregates": {
      callback: (): LuaQueryCollection => {
        return objectIndex.aggregates();
      },
      description: "Returns stored aggregate records as a query collection.",
    },
    "index.ensureFullIndex": {
      callback: () => {
        return objectIndex.ensureFullIndex(client.space);
      },
      description:
        "Ensures the complete object index is available and current.",
    },
    "index.reindexSpace": {
      callback: () => {
        return objectIndex.reindexSpace(client.space);
      },
      description: "Rebuilds the object index for the entire space.",
    },
    "index.indexObjects": {
      callback: (_ctx, page: string, objects: ObjectValue[]): Promise<void> => {
        return objectIndex.indexObjects(page, objects);
      },
      description: "Indexes a collection of objects for a page.",
      signatures: ["index.indexObjects(page, objects)"],
    },
    "index.validateObjects": {
      callback: async (
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
      description:
        "Validates objects for a page and returns the first validation error, if any.",
      signatures: ["index.validateObjects(page, objects)"],
    },
    "index.previewProcessedObjects": {
      callback: (
        _ctx,
        page: string,
        objects: ObjectValue[],
      ): Promise<{ tag: string; object: ObjectValue }[]> => {
        return objectIndex.previewProcessedObjects(page, objects);
      },
      description:
        "Runs the indexing pipeline without writing and returns processed tag/object pairs.",
      signatures: ["index.previewProcessedObjects(page, objects)"],
    },
    "index.getObjectByRef": {
      callback: (
        _ctx,
        page: string,
        tag: string,
        ref: string,
      ): Promise<ObjectValue | undefined> => {
        return objectIndex.getObjectByRef(page, tag, ref);
      },
      description:
        "Returns an indexed object identified by page, tag, and reference.",
      signatures: ["index.getObjectByRef(page, tag, ref)"],
    },
    "index.queryLuaObjects": {
      callback: (
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
      description:
        "Executes a structured Lua collection query against indexed objects.",
      signatures: ["index.queryLuaObjects(tag, query, scopedVariables?)"],
    },

    "index.deleteObject": {
      callback: (
        _ctx,
        page: string,
        tag: string,
        ref: string,
      ): Promise<void> => {
        return objectIndex.deleteObject(page, tag, ref);
      },
      description:
        "Deletes an indexed object identified by page, tag, and reference.",
      signatures: ["index.deleteObject(page, tag, ref)"],
    },
    "lua:index.defineTag": {
      callback: (_ctx, tagDef: LuaTable) => {
        // Using 'lua:' prefix to _not_ convert tagDef to a JS version (but keep original LuaTable)
        if (!tagDef.has("name")) {
          throw new Error("A tag name is required");
        }
        const currentTag = client.config.get(
          ["tags", tagDef.get("name")],
          null,
        );
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
      description: "Defines or updates a tag and its Lua metatable.",
      signatures: ["index.defineTag(tagDefinition)"],
    },
  };
}
