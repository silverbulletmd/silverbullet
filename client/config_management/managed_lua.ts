/**
 * Conversion between JS values and the Lua source of CONFIG's managed blocks,
 * which are read structurally, never evaluated.
 */
import type {
  LuaExpression,
  LuaFunctionCallExpression,
  LuaTableField,
} from "../space_lua/ast.ts";
import { parseBlock } from "../space_lua/parse.ts";
import { prettyPrintExpression } from "../space_lua/pretty_print.ts";
import type { JsonSchema } from "./schema_lua.ts";

/** What reading a Lua expression that isn't a literal yields */
export const UNREADABLE = Symbol("unreadable");

/** Lua expressions beyond plain literals that a codec reads and writes */
export type LiteralExtension = {
  /** The value of a non-literal expression, or UNREADABLE */
  read: (e: LuaExpression, read: (e: LuaExpression) => unknown) => unknown;
  /** An expression for a value, or undefined to write it as a plain literal */
  write: (
    value: unknown,
    write: (value: unknown) => LuaExpression,
  ) => LuaExpression | undefined;
};

const ctx = {};

/** Build the AST of a Lua literal for a JS value. */
export function toLuaAst(
  value: unknown,
  ext?: LiteralExtension,
): LuaExpression {
  const write = (v: unknown) => toLuaAst(v, ext);
  const custom = ext?.write(value, write);
  if (custom) return custom;
  if (value === null || value === undefined) return { type: "Nil", ctx };
  if (typeof value === "boolean") return { type: "Boolean", value, ctx };
  if (typeof value === "number") {
    // Lua literals have no syntax for NaN or the infinities
    if (!Number.isFinite(value)) return { type: "Nil", ctx };
    const numericType = Number.isInteger(value) ? "int" : "float";
    return { type: "Number", value, numericType, ctx };
  }
  if (typeof value === "string") return { type: "String", value, ctx };
  if (Array.isArray(value)) {
    // Note: [] becomes `{}`, which parses back as {}: Lua cannot tell an
    // empty array from an empty table
    const fields: LuaTableField[] = value.map((v) => ({
      type: "ExpressionField",
      value: write(v),
      ctx,
    }));
    return { type: "TableConstructor", fields, ctx };
  }
  if (typeof value === "object") {
    const fields: LuaTableField[] = Object.entries(value)
      .filter(([_, v]) => v !== null && v !== undefined)
      .map(([key, v]) => ({ type: "PropField", key, value: write(v), ctx }));
    return { type: "TableConstructor", fields, ctx };
  }
  return { type: "Nil", ctx };
}

/**
 * Serialize a JavaScript value to Lua source code.
 */
export function toLua(value: unknown, ext?: LiteralExtension): string {
  return prettyPrintExpression(toLuaAst(value, ext));
}

/**
 * Convert a literal expression AST (strings, numbers, booleans, nil, tables
 * of literals, and what `ext` reads) to a JS value. Returns UNREADABLE for
 * anything else.
 */
export function fromLuaAst(e: LuaExpression, ext?: LiteralExtension): unknown {
  const read = (x: LuaExpression) => fromLuaAst(x, ext);
  switch (e.type) {
    case "Nil":
      return undefined;
    case "Boolean":
    case "String":
    case "Number":
      return e.value;
    case "Unary":
      return e.operator === "-" && e.argument.type === "Number"
        ? -e.argument.value
        : UNREADABLE;
    case "TableConstructor": {
      const items: unknown[] = [];
      const entries: Record<string, unknown> = {};
      for (const f of e.fields) {
        const v = read(f.value);
        if (typeof v === "symbol") return UNREADABLE;
        if (f.type === "ExpressionField") items.push(v);
        else if (f.type === "PropField") entries[f.key] = v;
        else if (f.key.type === "String") entries[f.key.value] = v;
        else return UNREADABLE;
      }
      const keyed = items.length < e.fields.length;
      if (keyed && items.length > 0) return UNREADABLE;
      return keyed ? entries : items.length > 0 ? items : {};
    }
    default:
      return ext ? ext.read(e, read) : UNREADABLE;
  }
}

/** The `<object>.<method>` a call names, if it is one */
export function calleeOf(
  call: LuaFunctionCallExpression,
): { object: string; method: string } | null {
  const { prefix, name } = call;
  if (
    !name &&
    prefix.type === "PropertyAccess" &&
    prefix.object.type === "Variable"
  ) {
    return { object: prefix.object.name, method: prefix.property };
  }
  return null;
}

export type CommandOverride = {
  key?: string | string[];
  mac?: string | string[];
};

function isStringOrList(v: unknown): v is string | string[] {
  return (
    typeof v === "string" ||
    (Array.isArray(v) && v.every((item) => typeof item === "string"))
  );
}

export type Statement =
  /** `config.set(path, value)`; value is UNREADABLE when not a literal */
  | { kind: "set"; path: string | string[]; value: unknown }
  /** `command.update { name = …, key = …, mac = … }` */
  | { kind: "command"; name: string; override: CommandOverride }
  | {
      kind: "define";
      tag: string;
      /** null when there is no schema field or its value can't be read */
      schema: JsonSchema | null;
      /** Names of the definition's other fields (tagPage, …) */
      other: string[];
      /** Where the schema field's value is, when there is one */
      schemaRange?: { start: number; end: number };
    }
  | { kind: "require"; tag: string; attribute: string; required: boolean }
  | { kind: "opaque" };

export type ScannedStatement = Statement & { start: number; end: number };

const OPAQUE = { kind: "opaque" } as const;

function readCall(
  call: LuaFunctionCallExpression,
  ext: LiteralExtension | undefined,
): Statement {
  const callee = calleeOf(call);
  const { args } = call;
  switch (`${callee?.object}.${callee?.method}`) {
    case "config.set": {
      if (args.length !== 2) return OPAQUE;
      const path = fromLuaAst(args[0]);
      if (
        typeof path !== "string" &&
        !(Array.isArray(path) && path.every((p) => typeof p === "string"))
      ) {
        return OPAQUE;
      }
      return { kind: "set", path, value: fromLuaAst(args[1], ext) };
    }
    case "command.update": {
      const [spec] = args;
      if (args.length !== 1 || spec.type !== "TableConstructor") return OPAQUE;
      const fields: Record<string, unknown> = {};
      for (const f of spec.fields) {
        if (f.type !== "PropField") continue;
        const v = fromLuaAst(f.value);
        if (v !== UNREADABLE) fields[f.key] = v;
      }
      if (typeof fields.name !== "string") return OPAQUE;
      const override: CommandOverride = {};
      if (isStringOrList(fields.key)) override.key = fields.key;
      if (isStringOrList(fields.mac)) override.mac = fields.mac;
      return { kind: "command", name: fields.name, override };
    }
    case "tag.define": {
      const [spec] = args;
      if (args.length !== 1 || spec.type !== "TableConstructor") return OPAQUE;
      let tag: string | undefined;
      let schema: JsonSchema | null = null;
      let schemaRange: { start: number; end: number } | undefined;
      const other: string[] = [];
      for (const f of spec.fields) {
        if (f.type !== "PropField") return OPAQUE;
        if (f.key === "name") {
          if (f.value.type !== "String") return OPAQUE;
          tag = f.value.value;
        } else if (f.key === "schema") {
          const v = fromLuaAst(f.value, ext);
          if (v && typeof v === "object" && !Array.isArray(v)) schema = v;
          schemaRange = { start: f.value.ctx.from!, end: f.value.ctx.to! };
        } else {
          other.push(f.key);
        }
      }
      if (tag === undefined) return OPAQUE;
      return schemaRange
        ? { kind: "define", tag, schema, other, schemaRange }
        : { kind: "define", tag, schema, other };
    }
    case "tag.setRequired": {
      const [t, a, r] = args;
      if (
        args.length === 3 &&
        t.type === "String" &&
        a.type === "String" &&
        r.type === "Boolean"
      ) {
        return {
          kind: "require",
          tag: t.value,
          attribute: a.value,
          required: r.value,
        };
      }
      return OPAQUE;
    }
    default:
      return OPAQUE;
  }
}

/**
 * Every top-level statement of a chunk, with its source range; values are
 * read with `ext`. Throws if the text is not valid Lua.
 */
export function scanStatements(
  text: string,
  ext?: LiteralExtension,
): ScannedStatement[] {
  return parseBlock(text).statements.map((stmt) => ({
    ...(stmt.type === "FunctionCallStatement"
      ? readCall(stmt.call, ext)
      : OPAQUE),
    start: stmt.ctx.from!,
    end: stmt.ctx.to!,
  }));
}

/**
 * Parse the body of the managed block of CONFIG back into the structured
 * form the UI consumes: `config.set` with a string path (its value undefined
 * when not a literal) and `command.update`. A block that is not valid Lua
 * yields no overrides and the parse error in `error`; callers must then not
 * rewrite the block from these (empty) overrides.
 */
export function parseManagedBlock(blockContent: string): {
  configOverrides: Record<string, any>;
  commandOverrides: Record<string, CommandOverride>;
  error?: string;
} {
  const configOverrides: Record<string, any> = {};
  const commandOverrides: Record<string, CommandOverride> = {};
  let statements: ScannedStatement[];
  try {
    statements = scanStatements(blockContent);
  } catch (e: any) {
    return {
      configOverrides,
      commandOverrides,
      error: e?.message ?? String(e),
    };
  }
  for (const st of statements) {
    if (st.kind === "set" && typeof st.path === "string") {
      configOverrides[st.path] = st.value === UNREADABLE ? undefined : st.value;
    } else if (st.kind === "command") {
      commandOverrides[st.name] = st.override;
    }
  }
  return { configOverrides, commandOverrides };
}
