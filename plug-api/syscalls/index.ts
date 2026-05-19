import type {
  LuaCollectionQuery,
  LuaQueryCollection,
} from "../../client/space_lua/query_collection.ts";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import type { ObjectValue } from "../../plug-api/types/index.ts";

/**
 * Exposes the SilverBullet object indexing system
 * @module
 */

/**
 * Indexes objects for a specific page
 * @param page - The page identifier where objects will be indexed
 * @param objects - Array of objects to be indexed
 * @returns Promise that resolves when indexing is complete
 */
export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  return syscall("index.indexObjects", page, objects);
}

export function validateObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<{ error: string; object: ObjectValue } | null> {
  return syscall("index.validateObjects", page, objects);
}

/**
 * Run the full indexing pipeline (validation, multi-tag expansion,
 * tag transforms) and return the resulting objects each paired with
 * the tag they're indexed under. Read-only — no DB writes.
 */
export function previewProcessedObjects(
  page: string,
  objects: ObjectValue[],
): Promise<{ tag: string; object: ObjectValue }[]> {
  return syscall("index.previewProcessedObjects", page, objects);
}

/**
 * Returns objects carrying the given tag as a query collection.
 */
export function objects(tagName: string): Promise<LuaQueryCollection> {
  return syscall("index.objects", tagName);
}

/**
 * Returns all pages (optionally filtered by an additional tag) as a query collection.
 */
export function pages(tagName?: string): Promise<LuaQueryCollection> {
  return syscall("index.pages", tagName);
}

/**
 * Returns all sub-pages of the given page (pages whose name starts with `<pageName>/`)
 * as a query collection.
 */
export function subPages(pageName: string): Promise<LuaQueryCollection> {
  return syscall("index.subPages", pageName);
}

/**
 * Returns all documents as a query collection.
 */
export function documents(): Promise<LuaQueryCollection> {
  return syscall("index.documents");
}

/**
 * Returns all links as a query collection.
 */
export function links(): Promise<LuaQueryCollection> {
  return syscall("index.links");
}

/**
 * Returns all tasks (optionally filtered by an additional tag) as a query collection.
 */
export function tasks(tagName?: string): Promise<LuaQueryCollection> {
  return syscall("index.tasks", tagName);
}

/**
 * Returns all headers (optionally filtered by an additional tag) as a query collection.
 */
export function headers(tagName?: string): Promise<LuaQueryCollection> {
  return syscall("index.headers", tagName);
}

/**
 * Returns all list items (optionally filtered by an additional tag) as a query collection.
 */
export function items(tagName?: string): Promise<LuaQueryCollection> {
  return syscall("index.items", tagName);
}

/**
 * Returns all paragraphs (optionally filtered by an additional tag) as a query collection.
 */
export function paragraphs(tagName?: string): Promise<LuaQueryCollection> {
  return syscall("index.paragraphs", tagName);
}

/**
 * Returns all tables (optionally filtered by an additional tag) as a query collection.
 */
export function tables(tagName?: string): Promise<LuaQueryCollection> {
  return syscall("index.tables", tagName);
}

/**
 * Returns all aspiring (referenced but not yet created) pages as a query collection.
 */
export function aspiringPages(): Promise<LuaQueryCollection> {
  return syscall("index.aspiringPages");
}

/**
 * Returns all tag objects as a query collection.
 */
export function tags(): Promise<LuaQueryCollection> {
  return syscall("index.tags");
}

/**
 * Queries objects using a Lua-based collection query
 * @param tag - The tag to filter objects by
 * @param query - Lua query parameters to filter objects
 * @param scopedVariables - Optional variables to be used in the Lua query
 * @returns Promise that resolves with an array of matching objects
 */
export function queryLuaObjects<T>(
  tag: string,
  query: LuaCollectionQuery,
  scopedVariables?: Record<string, any>,
): Promise<ObjectValue<T>[]> {
  return syscall("index.queryLuaObjects", tag, query, scopedVariables);
}

/**
 * Retrieves a specific object by its reference
 * @param page - The page identifier where the object is located
 * @param tag - The tag of the object
 * @param ref - The reference identifier of the object
 * @returns Promise that resolves with the matching object or undefined if not found
 */
export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<ObjectValue<T> | undefined> {
  return syscall("index.getObjectByRef", page, tag, ref);
}

/**
 * Ensures that the full index is built and up-to-date
 */
export function ensureFullIndex(): Promise<void> {
  return syscall("index.ensureFullIndex");
}

export function reindexSpace(): Promise<void> {
  return syscall("index.reindexSpace");
}

export function deleteObject(
  page: string,
  tag: string,
  ref: string,
): Promise<void> {
  return syscall("index.deleteObject", page, tag, ref);
}

export type {
  AnchorHit,
  ResolveAnchorResult,
} from "../../plugs/index/types.ts";
import type { ResolveAnchorResult } from "../../plugs/index/types.ts";

/**
 * Resolves a `$name` anchor to its host. Returns `ok: true` with page +
 * hostTag + range on success, or `ok: false` with `missing`/`duplicate`
 * reason. When `page` is provided, the lookup is filtered to that page.
 */
export function resolveAnchor(
  name: string,
  page?: string,
): Promise<ResolveAnchorResult> {
  return syscall("index.resolveAnchor", name, page);
}
