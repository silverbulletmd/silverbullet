import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaTable,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";

export const jsApi = new LuaTable({
  /**
   * Creates a new instance of a JavaScript class.
   * @param constructorFn - The constructor function.
   * @param args - The arguments to pass to the constructor.
   * @returns The new instance.
   */
  new: new LuaBuiltinFunction(
    (_sf, constructorFn: any, ...args) => {
      console.log("New", constructorFn, args);
      return new constructorFn(
        ...args.map(luaValueToJS),
      );
    },
  ),
  /**
   * Imports a JavaScript module.
   * @param url - The URL of the module to import.
   * @returns The imported module.
   */
  import: new LuaBuiltinFunction(async (_sf, url) => {
    let m = await import(url);
    // Unwrap default if it exists
    if (Object.keys(m).length === 1 && m.default) {
      m = m.default;
    }
    return m;
  }),
  /**
   * Converts a JavaScript value to a Lua value.
   * @param val - The JavaScript value to convert.
   * @returns The Lua value.
   */
  tolua: new LuaBuiltinFunction((_sf, val) => jsToLuaValue(val)),
  /**
   * Converts a Lua value to a JavaScript value.
   * @param val - The Lua value to convert.
   * @returns The JavaScript value.
   */
  tojs: new LuaBuiltinFunction((_sf, val) => luaValueToJS(val)),
  /**
   * Logs a message to the console.
   * @param args - The arguments to log.
   */
  log: new LuaBuiltinFunction((_sf, ...args) => {
    console.log(...args);
  }),
  /**
   * Converts a Lua value to a JSON string.
   * @param val - The Lua value to convert.
   * @returns The JSON string.
   */
  stringify: new LuaBuiltinFunction((_sf, val) => JSON.stringify(val)),
});
