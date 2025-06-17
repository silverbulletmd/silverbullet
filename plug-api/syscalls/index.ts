import type { LuaCollectionQuery } from "../../lib/space_lua/query_collection.ts";
import { syscall } from "@silverbulletmd/silverbullet/syscall";
import type { ObjectValue } from "../../type/index.ts";

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
