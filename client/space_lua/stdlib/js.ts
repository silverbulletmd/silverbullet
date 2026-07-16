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
  new: new LuaBuiltinFunction({
    callback: (sf, constructorFn: any, ...args) => {
      return new constructorFn(...args.map((v) => luaValueToJS(v, sf)));
    },
    description: "Creates an instance of a JavaScript class.",
    signatures: ["js.new(constructor, ...): userdata"],
    parameters: [
      {
        name: "constructor",
        type: "userdata",
        description: "JavaScript constructor function.",
      },
      {
        name: "...",
        description: "Constructor arguments converted to JavaScript values.",
      },
    ],
    returns: [{ type: "userdata", description: "New JavaScript instance." }],
    examples: [{ code: 'local value = js.new(js.window.Date, "2024-03-14")' }],
  }),
  /**
   * Imports a JavaScript module.
   * @param url - The URL of the module to import.
   * @returns The imported module.
   */
  import: new LuaBuiltinFunction({
    callback: async (_sf, url) => {
      let m = await import(url);
      // Unwrap default if it exists
      if (Object.keys(m).length === 1 && m.default) {
        m = m.default;
      }
      return m;
    },
    description: "Dynamically imports a JavaScript module from a URL.",
    parameters: [{ name: "url", type: "string", description: "Module URL." }],
    returns: [
      {
        type: "userdata",
        description: "Imported module, with a sole default export unwrapped.",
      },
    ],
    examples: [
      { code: 'local lib = js.import("https://esm.sh/lodash@4.17.21")' },
    ],
  }),
  /**
   * Like `js.import`, but takes a path to a file in the current space (e.g.
   * "Library/foo/bar.js") and resolves it to its full same-origin `/.fs` URL
   * before importing.
   * @param path - Space-relative path to the JS module (leading "/" optional).
   * @returns The imported module (with a sole `default` export unwrapped).
   */
  importFromSpace: new LuaBuiltinFunction({
    callback: async (_sf, path: string) => {
      const base = document.baseURI.replace(/\/*$/, "/");
      const rel = String(path).replace(/^\/+/, "");
      let m = await import(base + fsEndpoint.slice(1) + "/" + rel);
      // Unwrap default if it exists (same contract as `js.import`).
      if (Object.keys(m).length === 1 && m.default) {
        m = m.default;
      }
      return m;
    },
    description:
      "Imports a JavaScript module from a file in the current space.",
    parameters: [
      {
        name: "path",
        type: "string",
        description:
          "Space-relative module path, with an optional leading slash.",
      },
    ],
    returns: [
      {
        type: "userdata",
        description: "Imported module, with a sole default export unwrapped.",
      },
    ],
    examples: [
      { code: 'local acme = js.importFromSpace("Library/acme/acme.js")' },
    ],
  }),
  eachIterable: new LuaBuiltinFunction({
    callback: (_sf, val) => {
      const iterator = val[Symbol.asyncIterator]();
      return async () => {
        const result = await iterator.next();
        if (result.done) {
          return;
        }
        return result.value;
      };
    },
    description: "Creates a Lua iterator over a JavaScript async iterable.",
    parameters: [
      {
        name: "iterable",
        type: "userdata",
        description: "JavaScript async iterable.",
      },
    ],
    returns: [
      {
        type: "function",
        description: "Iterator yielding successive JavaScript values.",
      },
    ],
    examples: [
      {
        code: "for value in js.eachIterable(someJsAsyncIterable) do\n  print(value)\nend",
      },
    ],
  }),
  /**
   * Converts a JavaScript value to a Lua value.
   * @param val - The JavaScript value to convert.
   * @returns The Lua value.
   */
  tolua: new LuaBuiltinFunction({
    callback: (_sf, val) => jsToLuaValue(val),
    description: "Converts a JavaScript value to its Lua representation.",
    parameters: [
      { name: "value", description: "JavaScript value to convert." },
    ],
    returns: [{ description: "Converted Lua value." }],
    examples: [{ code: "local luaTable = js.tolua(jsArray)" }],
  }),
  /**
   * Converts a Lua value to a JavaScript value.
   * @param val - The Lua value to convert.
   * @returns The JavaScript value.
   */
  tojs: new LuaBuiltinFunction({
    callback: (sf, val) => luaValueToJS(val, sf),
    description: "Converts a Lua value to its JavaScript representation.",
    parameters: [{ name: "value", description: "Lua value to convert." }],
    returns: [{ description: "Converted JavaScript value." }],
    examples: [{ code: "local jsArray = js.tojs({1, 2, 3})" }],
  }),
  /**
   * Logs a message to the console.
   * @param args - The arguments to log.
   */
  log: new LuaBuiltinFunction({
    callback: (_sf, ...args) => {
      console.log(...args);
    },
    description: "Logs values to the JavaScript console.",
    parameters: [{ name: "...", description: "Values to log." }],
    examples: [{ code: 'js.log("User data:", {name = "Ada"})' }],
  }),
  /**
   * Converts a Lua value to a JSON string.
   * @param val - The Lua value to convert.
   * @returns The JSON string.
   */
  stringify: new LuaBuiltinFunction({
    callback: (_sf, val) => JSON.stringify(val),
    description: "Serializes a value as JSON using JavaScript semantics.",
    parameters: [{ name: "value", description: "Value to serialize." }],
    returns: [{ type: "string", description: "JSON representation." }],
    examples: [{ code: "print(js.stringify({1, 2, 3})) -- [1,2,3]" }],
  }),

  // Expose the global window object
  window: globalThis,
});
