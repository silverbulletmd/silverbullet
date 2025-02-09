import {
  type ILuaFunction,
  LuaBuiltinFunction,
  type LuaEnv,
  luaEquals,
  LuaRuntimeError,
  LuaTable,
  type LuaValue,
} from "$common/space_lua/runtime.ts";

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
      if (Array.isArray(tbl)) {
        return tbl.join(sep);
      }
      sep = sep ?? "";
      i = i ?? 1;
      j = j ?? tbl.length;
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
    (_sf, tbl: LuaTable, posOrValue: number | any, value?: any) => {
      if (value === undefined) {
        let pos = 1;
        while (tbl.get(pos) !== null) {
          pos++;
        }
        tbl.set(pos, posOrValue);
      } else {
        tbl.insert(posOrValue, value);
      }
    },
  ),
  /**
   * Removes an element from a table at a specified position.
   * @param tbl - The table to remove the element from.
   * @param pos - The position of the element to remove.
   */
  remove: new LuaBuiltinFunction((_sf, tbl: LuaTable, pos?: number) => {
    pos = pos ?? tbl.length;
    tbl.remove(pos);
  }),
  /**
   * Sorts a table.
   * @param tbl - The table to sort.
   * @param comp - The comparison function.
   * @returns The sorted table.
   */
  sort: new LuaBuiltinFunction((sf, tbl: LuaTable, comp?: ILuaFunction) => {
    return tbl.sort(comp, sf);
  }),
  /**
   * Returns the keys of a table.
   * @param tbl - The table to get the keys from.
   * @returns The keys of the table.
   */
  keys: new LuaBuiltinFunction((_sf, tbl: LuaTable | LuaEnv) => {
    return tbl.keys();
  }),
  /**
   * Checks if a table (used as an array) contains a value.
   * @param tbl - The table to check.
   * @param value - The value to check for.
   * @returns True if the value is in the table, false otherwise.
   */
  includes: new LuaBuiltinFunction(
    (sf, tbl: LuaTable | Record<string, any>, value: LuaValue) => {
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
});
