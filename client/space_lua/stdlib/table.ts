import {
  getMetatable,
  type ILuaFunction,
  LuaBuiltinFunction,
  luaCall,
  type LuaEnv,
  luaEquals,
  luaGet,
  LuaMultiRes,
  LuaRuntimeError,
  luaSet,
  LuaTable,
  type LuaValue,
  luaValueToJS,
  singleResult,
} from "../runtime.ts";
import { asyncQuickSort, evalPromiseValues } from "../util.ts";
import { isTaggedFloat } from "../numeric.ts";

// For `LuaTable` honor `__len` when present; otherwise use raw array
// length.  For JS arrays use `.length`.
function luaLenForTableLib(
  sf: any,
  tbl: LuaTable | any[],
): number | Promise<number> {
  if (Array.isArray(tbl)) {
    return tbl.length;
  }
  if (!(tbl instanceof LuaTable)) {
    return 0;
  }

  const mt = getMetatable(tbl, sf);
  const mm = mt ? mt.rawGet("__len") : null;
  if (!(mm === undefined || mm === null)) {
    const r = luaCall(mm, [tbl], sf.astCtx ?? {}, sf);
    if (r instanceof Promise) {
      return r.then((v: any) => Number(singleResult(v)));
    }
    return Number(singleResult(r));
  }

  return tbl.length;
}

async function luaLenForTableLibAsync(sf: any, tbl: LuaTable | any[]) {
  const r = luaLenForTableLib(sf, tbl);
  return r instanceof Promise ? await r : r;
}

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
    async (sf, tbl: LuaTable | any[], sep?: string, i?: number, j?: number) => {
      sep = sep ?? "";
      i = i ?? 1;
      if (j === undefined || j === null) {
        j = await luaLenForTableLibAsync(sf, tbl);
      }

      const luaConcatElemToString = (v: any, idx: number): string => {
        // Concat errors on nil and non-string or non-number values.
        if (v === null || v === undefined) {
          throw new LuaRuntimeError(
            `invalid value (nil) at index ${idx} in table for 'concat'`,
            sf,
          );
        }
        if (typeof v === "string") {
          return v;
        }
        if (typeof v === "number") {
          return String(v);
        }
        if (isTaggedFloat(v)) {
          return String(v.value);
        }

        const ty = typeof v === "object" && v instanceof LuaTable
          ? "table"
          : typeof v;
        throw new LuaRuntimeError(
          `invalid value (${ty}) at index ${idx} in table for 'concat'`,
          sf,
        );
      };

      if (Array.isArray(tbl)) {
        const out: string[] = [];
        for (let k = i; k <= j; k++) {
          const v = tbl[k - 1];
          out.push(luaConcatElemToString(v, k));
        }
        return out.join(sep);
      }

      const out: string[] = [];
      for (let k = i; k <= j; k++) {
        const v = await luaGet(tbl, k, sf.astCtx ?? null, sf);
        out.push(luaConcatElemToString(v, k));
      }
      return out.join(sep);
    },
  ),

  /**
   * Inserts an element into a table at a specified position.
   * @param tbl - The table to insert the element into.
   * @param posOrValue - The position or value to insert.
   * @param value - The value to insert.
   */
  insert: new LuaBuiltinFunction(
    async (
      sf,
      tbl: LuaTable | any[],
      posOrValue: number | any,
      value?: any,
    ) => {
      if (Array.isArray(tbl)) {
        // Since we're inserting/appending to a native JS array, we'll also convert the value to a JS value on the fly
        // this seems like a reasonable heuristic
        if (value === undefined) {
          tbl.push(luaValueToJS(posOrValue, sf));
        } else {
          tbl.splice(posOrValue - 1, 0, luaValueToJS(value, sf));
        }
        return;
      }

      if (!(tbl instanceof LuaTable)) {
        return;
      }

      let pos: number;
      let v: any;

      if (value === undefined) {
        v = posOrValue;
        pos = (await luaLenForTableLibAsync(sf, tbl)) + 1;
      } else {
        pos = posOrValue;
        v = value;
      }

      const n = await luaLenForTableLibAsync(sf, tbl);

      // Shift up: for k = n, pos, -1 do t[k+1] = t[k] end
      for (let k = n; k >= pos; k--) {
        const cur = await luaGet(tbl, k, sf.astCtx ?? null, sf);
        await luaSet(tbl, k + 1, cur, sf);
      }

      await luaSet(tbl, pos, v, sf);
    },
  ),

  /**
   * Removes an element from a table at a specified position.
   * @param tbl - The table to remove the element from.
   * @param pos - The position of the element to remove.
   */
  remove: new LuaBuiltinFunction(
    async (sf, tbl: LuaTable | any[], pos?: number) => {
      if (Array.isArray(tbl)) {
        const n = tbl.length;
        const p = pos ?? n;
        if (p < 1 || p > n) {
          throw new LuaRuntimeError("position out of bounds", sf);
        }
        const idx = p - 1;
        const v = tbl[idx];
        tbl.splice(idx, 1);
        return v;
      }

      if (!(tbl instanceof LuaTable)) {
        return null;
      }

      const n = await luaLenForTableLibAsync(sf, tbl);
      const p = pos ?? n;

      if (p < 1 || p > n) {
        throw new LuaRuntimeError("position out of bounds", sf);
      }

      const v = await luaGet(tbl, p, sf.astCtx ?? null, sf);

      // Shift down: for k = p, n-1 do t[k] = t[k+1] end; t[n] = nil
      for (let k = p; k < n; k++) {
        const next = await luaGet(tbl, k + 1, sf.astCtx ?? null, sf);
        await luaSet(tbl, k, next, sf);
      }
      await luaSet(tbl, n, null, sf);

      return v;
    },
  ),

  /**
   * Sorts a table.
   * @param tbl - The table to sort.
   * @param comp - The comparison function.
   * @returns The sorted table.
   */
  sort: new LuaBuiltinFunction(
    async (sf, tbl: LuaTable | any[], comp?: ILuaFunction) => {
      if (Array.isArray(tbl)) {
        return await asyncQuickSort(tbl, async (a, b) => {
          if (comp) {
            return (await comp.call(sf, a, b)) ? -1 : 1;
          }
          return (a as any) < (b as any) ? -1 : 1;
        });
      }

      if (!(tbl instanceof LuaTable)) {
        return tbl;
      }

      const n = await luaLenForTableLibAsync(sf, tbl);

      const values: any[] = [];
      for (let i = 1; i <= n; i++) {
        values.push(await luaGet(tbl, i, sf.astCtx ?? null, sf));
      }

      const cmp = async (a: any, b: any): Promise<number> => {
        if (comp) {
          const r = await luaCall(comp, [a, b], sf.astCtx ?? {}, sf);
          return r ? -1 : 1;
        }

        const av = isTaggedFloat(a) ? a.value : a;
        const bv = isTaggedFloat(b) ? b.value : b;

        if (typeof av === "number" && typeof bv === "number") {
          return av < bv ? -1 : 1;
        }
        if (typeof av === "string" && typeof bv === "string") {
          return av < bv ? -1 : 1;
        }

        const ta = typeof av;
        const tb = typeof bv;
        throw new LuaRuntimeError(
          `attempt to compare ${ta} with ${tb}`,
          sf,
        );
      };

      const sorted = await asyncQuickSort(values, cmp);

      for (let i = 1; i <= n; i++) {
        await luaSet(tbl, i, sorted[i - 1], sf);
      }

      return tbl;
    },
  ),

  /**
   * Returns the keys of a table.
   * Note: Space Lua specific
   * @param tbl - The table to get the keys from.
   * @returns The keys of the table.
   */
  keys: new LuaBuiltinFunction((_sf, tbl: LuaTable | LuaEnv | any) => {
    if (tbl.keys) {
      return tbl.keys();
    }
    return Object.keys(tbl);
  }),

  /**
   * Checks if a table (used as an array) contains a value.
   * Note: Space Lua specific
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
      }
      if (Array.isArray(tbl)) {
        return !!tbl.find((item) => luaEquals(item, value));
      }
      throw new LuaRuntimeError(
        `Cannot use includes on a non-table or non-array value`,
        sf,
      );
    },
  ),

  /**
   * Returns a new table from an old one, only with selected keys
   * @param tbl a Lua table or JS object
   * @param keys a list of keys to select from the table, if keys[0] is a table or array, assumed to contain the keys to select
   * @returns a new table with only the selected keys
   */
  select: new LuaBuiltinFunction(
    (sf, tbl: LuaTable | Record<string, any>, ...keys: LuaValue[]) => {
      // Normalize arguments
      if (Array.isArray(keys[0])) {
        // First argument is key array, let's unpack
        keys = keys[0];
      } else if (keys[0] instanceof LuaTable) {
        keys = keys[0].toJSArray();
      }
      const resultTable = new LuaTable();
      const setPromises: (void | Promise<void>)[] = [];
      for (const key of keys) {
        setPromises.push(resultTable.set(key, luaGet(tbl, key, null, sf)));
      }
      const promised = evalPromiseValues(setPromises);
      if (promised instanceof Promise) {
        return promised.then(() => resultTable);
      }
      return resultTable;
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
    async (sf, tbl: LuaTable | any[], i?: number, j?: number) => {
      i = i ?? 1;
      if (j === undefined || j === null) {
        j = Array.isArray(tbl)
          ? tbl.length
          : await luaLenForTableLibAsync(sf, tbl);
      }

      const result: LuaValue[] = [];
      for (let k = i; k <= j; k++) {
        const v = Array.isArray(tbl)
          ? tbl[k - 1]
          : await luaGet(tbl, k, sf.astCtx ?? null, sf);
        result.push(v);
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
      if (!tbl) {
        return null;
      }
      const startIndex = fromIndex < 1 ? 1 : fromIndex;
      const n = Array.isArray(tbl)
        ? tbl.length
        : await luaLenForTableLibAsync(sf, tbl);
      for (let i = startIndex; i <= n; i++) {
        const val = await luaGet(tbl, i, sf.astCtx ?? null, sf);
        if (await luaCall(criteriaFn, [val], sf.astCtx!, sf)) {
          return new LuaMultiRes([i, val]);
        }
      }
      return null;
    },
  ),
});
