import {
  type ILuaFunction,
  LuaBuiltinFunction,
  LuaTable,
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
});
