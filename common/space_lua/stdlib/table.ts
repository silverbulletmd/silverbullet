import {
  type ILuaFunction,
  LuaBuiltinFunction,
  luaEquals,
  LuaRuntimeError,
  LuaTable,
  type LuaValue,
} from "$common/space_lua/runtime.ts";

export const tableApi = new LuaTable({
  concat: new LuaBuiltinFunction(
    (_sf, tbl: LuaTable, sep?: string, i?: number, j?: number) => {
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
  remove: new LuaBuiltinFunction((_sf, tbl: LuaTable, pos?: number) => {
    pos = pos ?? tbl.length;
    tbl.remove(pos);
  }),
  sort: new LuaBuiltinFunction((sf, tbl: LuaTable, comp?: ILuaFunction) => {
    return tbl.sort(comp, sf);
  }),
  keys: new LuaBuiltinFunction((_sf, tbl: LuaTable) => {
    return tbl.keys();
  }),
  includes: new LuaBuiltinFunction(
    (sf, tbl: LuaTable | Record<string, any>, value: LuaValue) => {
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
