/**
 * Tag schemas as Space Lua: read structurally (never evaluated) and written
 * back as readable Lua that uses the `schema.*` helpers where a schema has
 * their exact shape.
 */
import { deepEqual } from "@silverbulletmd/silverbullet/lib/json";
import { CONFIG_UNSET } from "../config.ts";
import type { LuaExpression } from "../space_lua/ast.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import {
  calleeOf,
  fromLuaAst,
  type LiteralExtension,
  toLua,
  UNREADABLE,
} from "./managed_lua.ts";

/** A JSON Schema as SilverBullet stores it in tag definitions */
export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  tag?: string;
  description?: string;
  nullable?: boolean;
  [keyword: string]: any;
};

type SchemaHelper = {
  name: string;
  /** What the Lua helper returns for these arguments; undefined when that can't be read */
  build: (args: unknown[]) => JsonSchema | undefined;
  /** Arguments that might build this schema, which build confirms; never written without */
  argsFor?: (s: JsonSchema) => unknown[] | undefined;
};

const isObject = (v: unknown): v is JsonSchema =>
  !!v && typeof v === "object" && !Array.isArray(v);

function typeOrSchema(a: unknown): JsonSchema | undefined {
  if (typeof a === "string") return { type: a };
  return isObject(a) ? a : undefined;
}

/** `"number"` for a bare `{type = "number"}`, else the schema itself */
const typeArg = (s: unknown) =>
  isObject(s) && typeof s.type === "string" && Object.keys(s).length === 1
    ? s.type
    : s;

function constant(name: string, schema: () => JsonSchema): SchemaHelper {
  return {
    name,
    build: (args) => (args.length === 0 ? schema() : undefined),
    argsFor: () => [],
  };
}

function listOrString(name: string, item: string, list: string): SchemaHelper {
  return {
    name,
    build: ([extra]) =>
      extra === undefined || isObject(extra)
        ? {
            anyOf: [
              { type: "array", items: { type: "string", format: item } },
              { type: "string", format: list },
            ],
            ...extra,
          }
        : undefined,
    argsFor: ({ anyOf: _, ...extra }) =>
      Object.keys(extra).length ? [extra] : [],
  };
}

/**
 * The `schema.*` helpers of `Library/Std/APIs/Schema`, in the order they are
 * preferred when writing a schema back.
 */
const HELPERS: SchemaHelper[] = [
  constant("string", () => ({ type: "string" })),
  constant("number", () => ({ type: "number" })),
  constant("boolean", () => ({ type: "boolean" })),
  constant("null", () => ({ type: "null" })),
  constant("object", () => ({ type: "object" })),
  constant("date", () => ({ type: "string", format: "date" })),
  {
    name: "ref",
    build: (args) => {
      if (args.length === 0) return { type: "string", format: "ref" };
      return typeof args[0] === "string"
        ? { type: "string", format: "ref", tag: args[0] }
        : undefined;
    },
    argsFor: (s) => (s.tag === undefined ? [] : [s.tag]),
  },
  {
    name: "enum",
    build: ([values]) =>
      Array.isArray(values) ? { type: "string", enum: values } : undefined,
    argsFor: (s) =>
      Array.isArray(s.enum) && s.enum.every((v) => typeof v === "string")
        ? [s.enum]
        : undefined,
  },
  listOrString("tags", "tag", "tags"),
  listOrString("identities", "identity", "identities"),
  {
    name: "nullableArray",
    build: ([typ]) => {
      const items = typeOrSchema(typ);
      return items && { anyOf: [{ type: "array", items }, { type: "null" }] };
    },
    argsFor: (s) => [typeArg(s.anyOf?.[0]?.items)],
  },
  {
    name: "nullable",
    build: ([typ]) => {
      const inner = typeOrSchema(typ);
      return inner && { anyOf: [inner, { type: "null" }] };
    },
    argsFor: (s) => [typeArg(s.anyOf?.[0])],
  },
  {
    name: "array",
    build: ([typ]) => {
      const items = typeOrSchema(typ);
      return items && { type: "array", items };
    },
    argsFor: (s) => [typeArg(s.items)],
  },
  constant("schema", () => ({ type: "object" })),
  { name: "func", build: (args) => (args.length === 0 ? {} : undefined) },
];

/** The schema `schema.<name>(…args)` returns */
export function helperSchema(name: string, ...args: unknown[]): JsonSchema {
  const schema = HELPERS.find((h) => h.name === name)?.build(args);
  if (!schema) throw new Error(`Not a schema helper call: schema.${name}`);
  return schema;
}

function helperValue(name: string, args: unknown[]): unknown {
  if (args.some((a) => typeof a === "symbol")) return UNREADABLE;
  return HELPERS.find((h) => h.name === name)?.build(args) ?? UNREADABLE;
}

const ctx = {};

/** `config.unset` and `schema.*` helper calls, read and written */
export const SCHEMA_LITERALS: LiteralExtension = {
  read(e, read) {
    if (
      e.type === "PropertyAccess" &&
      e.object.type === "Variable" &&
      e.object.name === "config" &&
      e.property === "unset"
    ) {
      return CONFIG_UNSET;
    }
    const callee = e.type === "FunctionCall" ? calleeOf(e) : null;
    if (e.type !== "FunctionCall" || callee?.object !== "schema") {
      return UNREADABLE;
    }
    return helperValue(callee.method, e.args.map(read));
  },
  write(value, write) {
    if (value === CONFIG_UNSET) {
      return {
        type: "PropertyAccess",
        object: { type: "Variable", name: "config", ctx },
        property: "unset",
        ctx,
      };
    }
    if (!isObject(value)) return undefined;
    for (const { name, build, argsFor } of HELPERS) {
      const args = argsFor?.(value);
      if (args && deepEqual(build(args), value)) {
        return {
          type: "FunctionCall",
          prefix: {
            type: "PropertyAccess",
            object: { type: "Variable", name: "schema", ctx },
            property: name,
            ctx,
          },
          args: args.map(write),
          ctx,
        };
      }
    }
    return undefined;
  },
};

/** The JSON Schema a Lua expression builds, or undefined when it can't be read safely */
export function schemaFromLua(expr: LuaExpression): JsonSchema | undefined {
  const v = fromLuaAst(expr, SCHEMA_LITERALS);
  return isObject(v) ? v : undefined;
}

/** A schema typed in as Lua, read the same way as the managed block (never evaluated) */
export function schemaFromLuaText(
  text: string,
): { schema: JsonSchema } | { error: string } {
  let expr: LuaExpression;
  try {
    expr = parseExpressionString(text);
  } catch (e: any) {
    return { error: `Not valid Lua: ${e?.message ?? e}` };
  }
  const schema = schemaFromLua(expr);
  return schema
    ? { schema }
    : {
        error:
          "Only a table and schema.* helpers can be read here, not other Lua",
      };
}

export function schemaToLua(schema: JsonSchema): string {
  return toLua(schema, SCHEMA_LITERALS);
}

export function defineStatement(tag: string, schema: JsonSchema): string {
  return `tag.define ${toLua({ name: tag, schema }, SCHEMA_LITERALS)}`;
}

export function setStatement(path: string[], value: unknown): string {
  return `config.set(${toLua(path)}, ${toLua(value, SCHEMA_LITERALS)})`;
}

export function requireStatement(
  tag: string,
  attribute: string,
  required: boolean,
): string {
  return `tag.setRequired(${toLua(tag)}, ${toLua(attribute)}, ${required})`;
}
