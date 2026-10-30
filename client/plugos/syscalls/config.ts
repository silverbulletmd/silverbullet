import type { Config } from "../../config.ts";
import { persistConfigValue } from "../../config_management/config_page.ts";
import { LuaStackFrame, luaValueToJS } from "../../space_lua/runtime.ts";
import type { SysCallMapping } from "../system.ts";
import { stripFunctions } from "../util.ts";

export function configSyscalls(config: Config): SysCallMapping {
  return {
    "config.get": {
      callback: (_ctx, path: string, defaultValue: any) => {
        return config.get(path, defaultValue);
      },
      description:
        "Gets a configuration value by path, with dot notation support.",
      parameters: [
        { name: "path", type: "string", description: "Configuration path." },
        {
          name: "defaultValue",
          description: "Value returned when the path is absent.",
        },
      ],
      returns: [{ description: "Configured value or the supplied default." }],
      examples: [{ code: 'local theme = config.get("theme", "light")' }],
    },
    "config.set": {
      callback: (
        _ctx,
        keyOrValues: string | string[] | Record<string, any>,
        value?: any,
      ) => {
        config.set(keyOrValues as any, value);
      },
      description: "Sets one configuration value or multiple values at once.",
      signatures: ["config.set(path, value)", "config.set(values)"],
      parameters: [
        {
          name: "pathOrValues",
          description: "Configuration path or table of values.",
        },
        {
          name: "value",
          description: "Value to set when a path is supplied.",
          optional: true,
        },
      ],
      examples: [
        { code: 'config.set("theme", "dark")' },
        { code: 'config.set({theme = "dark", fontSize = 14})' },
      ],
    },
    "lua:config.setLuaValue": {
      callback: async (
        _ctx,
        keyOrValues: string | string[] | Record<string, any>,
        value?: any,
      ) => {
        // This is for special cases where we explicitly want to NOT convert a value to a JS value, but maintain its Lua version (mostly for LuaTables) — main use case: metatable
        keyOrValues = await luaValueToJS(keyOrValues, LuaStackFrame.lostFrame);
        config.set(keyOrValues as any, value);
      },
      description:
        "Sets configuration while preserving the supplied Lua value representation.",
      signatures: [
        "config.setLuaValue(path, value)",
        "config.setLuaValue(values)",
      ],
      parameters: [
        {
          name: "pathOrValues",
          description: "Configuration path or table of values.",
        },
        {
          name: "value",
          description: "Lua value to preserve.",
          optional: true,
        },
      ],
    },
    "config.merge": {
      callback: (
        _ctx,
        path: string | string[],
        values: Record<string, any>,
      ) => {
        config.merge(path, values);
      },
      description:
        "Shallow-merges a table into the table at a path: given fields replace existing ones, fields set to config.unset are removed, and other existing fields are kept.",
      parameters: [
        { name: "path", description: "Configuration path." },
        { name: "values", type: "table", description: "Fields to merge in." },
      ],
      examples: [
        {
          code: 'config.merge({"commands", "Say hello"}, {key = "Ctrl-Alt-h"})',
        },
        {
          code: 'config.merge({"commands", "Say hello"}, {key = config.unset})',
        },
      ],
    },
    "config.insert": {
      callback: (_ctx, key: string | string[], value: any) => {
        config.insert(key, value);
      },
      description: "Appends a value to the configuration array at a path.",
      parameters: [
        { name: "path", description: "Configuration path." },
        { name: "value", description: "Value to append." },
      ],
    },
    "config.has": {
      callback: (_ctx, path: string) => {
        return config.has(path);
      },
      description: "Checks whether a configuration path exists.",
      parameters: [
        { name: "path", type: "string", description: "Configuration path." },
      ],
      returns: [{ type: "boolean", description: "Whether the path exists." }],
    },
    "config.define": {
      callback: (_ctx, key: string, schema: any) => {
        config.define(key, schema);
      },
      description: "Defines a JSON schema for a configuration key.",
      parameters: [
        { name: "key", type: "string", description: "Configuration key." },
        {
          name: "schema",
          type: "table",
          description:
            "JSON Schema definition; default applies a missing value and ui annotations expose it in the Configuration tab of the Workbench.",
        },
      ],
      examples: [
        {
          code: 'config.define("shortWikiLinks", {\n  description = "Render short wiki link labels",\n  type = "boolean",\n  default = true,\n  ui = {category = "Editor", label = "Short wiki links", priority = 1},\n})',
        },
      ],
    },
    "config.defineCategory": {
      callback: (_ctx, definition: any) => {
        config.defineCategory(definition);
      },
      description:
        "Defines or updates a category of the Workbench Configuration tab.",
      parameters: [
        {
          name: "definition",
          type: "table",
          description: "Category name, description, and priority.",
        },
      ],
      examples: [
        {
          code: 'config.defineCategory {\n  name = "Editor",\n  description = "Page editor behavior.",\n  priority = 50,\n}',
        },
      ],
    },
    "config.getValues": {
      callback: () => {
        return stripFunctions(config.values);
      },
      description: "Gets all configuration values as a single table.",
      returns: [{ type: "table", description: "All configuration values." }],
    },
    "config.getSchemas": {
      callback: () => {
        return stripFunctions(config.schemas);
      },
      description: "Gets all defined configuration schemas.",
      returns: [
        {
          type: "table",
          description: "Schemas keyed by configuration path.",
        },
      ],
    },
    "config.getCategories": {
      callback: () => {
        return { ...config.categories };
      },
      description: "Gets all categories of the Workbench Configuration tab.",
      returns: [
        { type: "table", description: "Category definitions keyed by name." },
      ],
    },
  };
}

/** Config syscalls that write the space: registered only when it's writable. */
export function configWriteSyscalls(): SysCallMapping {
  return {
    "config.persist": {
      callback: (_ctx, path: string, value: any) => {
        return persistConfigValue(path, value);
      },
      description:
        "Persists one configuration value: writes or replaces its `config.set` line in the managed block of CONFIG, then reloads configuration.",
      parameters: [
        { name: "path", type: "string", description: "Configuration path." },
        { name: "value", description: "Value to persist." },
      ],
      examples: [
        {
          code: 'config.persist("share.silverbullet.spaces", {"https://example.com/notes"})',
        },
      ],
    },
  };
}
