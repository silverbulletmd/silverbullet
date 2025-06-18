import {
  type ILuaFunction,
  LuaBuiltinFunction,
  type LuaEnv,
  luaEquals,
  luaGet,
  LuaMultiRes,
  LuaRuntimeError,
  LuaTable,
  type LuaValue,
  luaValueToJS,
} from "../runtime.ts";
import { asyncQuickSort } from "../util.ts";

export const tableApi = new LuaTable({
  /**
   * Concatenates the elements of a table into a string, using a separator.
   * @param tbl - The table to concatenate.
   * @param sep - The separator to use between elements.
   * @param i - The start index.
   * @param j - The end index.
   * @returns The concatenated string.
   */
  concat: new LuaBuiltinFunction(
    (_sf, tbl: LuaTable | any[], sep?: string, i?: number, j?: number) => {
      sep = sep ?? "";
      i = i ?? 1;
      j = j ?? tbl.length;
      if (Array.isArray(tbl)) {
        return tbl.slice(i - 1, j).join(sep);
      }
      const result = [];
      for (let k = i; k <= j; k++) {
        result.push(tbl.get(k));
      }
      return result.join(sep);
    },
  ),
  /**
   * Inserts an element into a table at a specified position.
   * @param tbl - The table to insert the element into.
   * @param posOrValue - The position or value to insert.
   * @param value - The value to insert.
   */
  insert: new LuaBuiltinFunction(
    (sf, tbl: LuaTable | any[], posOrValue: number | any, value?: any) => {
      if (Array.isArray(tbl)) {
        // Since we're inserting/appending to a native JS array, we'll also convert the value to a JS value on the fly
        // this seems like a reasonable heuristic
        if (value === undefined) {
          tbl.push(luaValueToJS(posOrValue, sf));
        } else {
          tbl.splice(posOrValue - 1, 0, luaValueToJS(value, sf));
        }
      } else if (tbl instanceof LuaTable) {
        if (value === undefined) {
          value = posOrValue;
          posOrValue = tbl.length + 1;
        }
        tbl.insert(value, posOrValue);
      }
    },
  ),
  /**
   * Removes an element from a table at a specified position.
   * @param tbl - The table to remove the element from.
   * @param pos - The position of the element to remove.
   */
  remove: new LuaBuiltinFunction((_sf, tbl: LuaTable | any[], pos?: number) => {
    pos = pos ?? tbl.length;
    if (Array.isArray(tbl)) {
      tbl.splice(pos - 1, 1);
    } else if (tbl instanceof LuaTable) {
      tbl.remove(pos);
    }
  }),
  /**
   * Sorts a table.
   * @param tbl - The table to sort.
   * @param comp - The comparison function.
   * @returns The sorted table.
   */
  sort: new LuaBuiltinFunction(
    async (sf, tbl: LuaTable | any[], comp?: ILuaFunction) => {
      if (Array.isArray(tbl)) {
        tbl = await asyncQuickSort(tbl, async (a, b) => {
          if (comp) {
            return (await comp.call(sf, a, b)) ?? 0;
          } else {
            return a - b;
          }
        });
      } else {
        await tbl.sort(comp, sf);
      }
      return tbl;
    },
  ),
  /**
   * Returns the keys of a table.
   * @param tbl - The table to get the keys from.
   * @returns The keys of the table.
   */
  keys: new LuaBuiltinFunction((_sf, tbl: LuaTable | LuaEnv | any) => {
    if (tbl.keys) {
      return tbl.keys();
    } else {
      return Object.keys(tbl);
    }
  }),
  /**
   * Checks if a table (used as an array) contains a value.
   * @param tbl - The table to check.
   * @param value - The value to check for.
   * @returns True if the value is in the table, false otherwise.
   */
  includes: new LuaBuiltinFunction(
    (sf, tbl: LuaTable | any[], value: LuaValue) => {
      if (!tbl) {
        return false;
      }
      if (tbl instanceof LuaTable) {
        // Iterate over the table
        for (const key of tbl.keys()) {
          if (luaEquals(tbl.get(key), value)) {
            return true;
          }
        }
        return false;
      } else if (Array.isArray(tbl)) {
        return !!tbl.find((item) => luaEquals(item, value));
      } else {
        throw new LuaRuntimeError(
          `Cannot use includes on a non-table or non-array value`,
          sf,
        );
      }
    },
  ),
  pack: new LuaBuiltinFunction((_sf, ...args: any[]) => {
    const tbl = new LuaTable();
    for (let i = 0; i < args.length; i++) {
      tbl.set(i + 1, args[i]);
    }
    tbl.set("n", args.length);
    return tbl;
  }),
  unpack: new LuaBuiltinFunction(
    (_sf, tbl: LuaTable, i?: number, j?: number) => {
      i = i ?? 1;
      j = j ?? tbl.length;
      const result = [];
      for (let k = i; k <= j; k++) {
        result.push(tbl.get(k));
      }
      return new LuaMultiRes(result);
    },
  ),

  // Non-standard Lua functions
  /**
   * Finds an element in a table that matches a criteria function. Returns the first matching element.
   * @param tbl - The table to search.
   * @param criteriaFn - The criteria function.
   * @param fromIndex - The index to start searching from.
   * @returns Lua multi value of index, value, or nil if no element is found.
   */
  find: new LuaBuiltinFunction(
    async (
      sf,
      tbl: LuaTable | any[],
      criteriaFn: ILuaFunction,
      fromIndex = 1,
    ) => {
      const startIndex = fromIndex < 1 ? 1 : fromIndex;
      for (let i = startIndex; i <= tbl.length; i++) {
        const val = await luaGet(tbl, i, sf);
        if (await criteriaFn.call(sf, val)) {
          return new LuaMultiRes([i, val]);
        }
      }
      return null;
    },
  ),
});
