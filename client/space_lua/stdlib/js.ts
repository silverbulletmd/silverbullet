import {
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaTable,
  luaValueToJS,
} from "../runtime.ts";
import { fsEndpoint } from "../../spaces/constants.ts";

export const jsApi = new LuaTable({
  /**
   * Creates a new instance of a JavaScript class.
   * @param constructorFn - The constructor function.
   * @param args - The arguments to pass to the constructor.
   * @returns The new instance.
   */
  new: new LuaBuiltinFunction((sf, constructorFn: any, ...args) => {
    return new constructorFn(...args.map((v) => luaValueToJS(v, sf)));
  }),
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
   * Like `js.import`, but takes a path to a file in the current space (e.g.
   * "Library/foo/bar.js") and resolves it to its full same-origin `/.fs` URL
   * before importing.
   * @param path - Space-relative path to the JS module (leading "/" optional).
   * @returns The imported module (with a sole `default` export unwrapped).
   */
  importFromSpace: new LuaBuiltinFunction(async (_sf, path: string) => {
    const base = document.baseURI.replace(/\/*$/, "/");
    const rel = String(path).replace(/^\/+/, "");
    let m = await import(base + fsEndpoint.slice(1) + "/" + rel);
    // Unwrap default if it exists (same contract as `js.import`).
    if (Object.keys(m).length === 1 && m.default) {
      m = m.default;
    }
    return m;
  }),
  eachIterable: new LuaBuiltinFunction((_sf, val) => {
    const iterator = val[Symbol.asyncIterator]();
    return async () => {
      const result = await iterator.next();
      if (result.done) {
        return;
      }
      return result.value;
    };
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
  tojs: new LuaBuiltinFunction((sf, val) => luaValueToJS(val, sf)),
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

  // Expose the global window object
  window: globalThis,
});
