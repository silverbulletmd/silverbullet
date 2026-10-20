/**
 * Conversion between JS values and the Lua source of the configuration
 * manager's managed block, built on the native Space Lua parser and pretty
 * printer. These are reached through the `lua.*` syscalls rather than
 * imported, which would bundle the whole Space Lua runtime into this plug.
 */
import { lua } from "@silverbulletmd/silverbullet/syscalls";
import type {
  LuaBlock,
  LuaExpression,
  LuaFunctionCallExpression,
  LuaTableField,
} from "../../client/space_lua/ast.ts";

/** Build the AST of a Lua literal for a JS value. */
function toLuaAst(value: unknown): LuaExpression {
  const ctx = {};
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
      value: toLuaAst(v),
      ctx,
    }));
    return { type: "TableConstructor", fields, ctx };
  }
  if (typeof value === "object") {
    const fields: LuaTableField[] = Object.entries(value)
      .filter(([_, v]) => v !== null && v !== undefined)
      .map(([key, v]) => ({ type: "PropField", key, value: toLuaAst(v), ctx }));
    return { type: "TableConstructor", fields, ctx };
  }
  return { type: "Nil", ctx };
}

/**
 * Serialize a JavaScript value to Lua source code.
 */
export function toLua(value: unknown): Promise<string> {
  return lua.prettyPrintExpression(toLuaAst(value));
}

const UNPARSEABLE = Symbol("unparseable");

/**
 * Convert a literal expression AST (strings, numbers, booleans, nil, tables
 * of literals) to a JS value. Returns UNPARSEABLE for anything else.
 */
function fromLuaAst(e: LuaExpression): any {
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
        : UNPARSEABLE;
    case "TableConstructor": {
      const items: any[] = [];
      const entries: Record<string, any> = {};
      for (const f of e.fields) {
        const v = fromLuaAst(f.value);
        if (v === UNPARSEABLE) return UNPARSEABLE;
        if (f.type === "ExpressionField") items.push(v);
        else if (f.type === "PropField") entries[f.key] = v;
        else if (f.key.type === "String") entries[f.key.value] = v;
        else return UNPARSEABLE;
      }
      const keyed = items.length < e.fields.length;
      if (keyed && items.length > 0) return UNPARSEABLE;
      return keyed ? entries : items.length > 0 ? items : {};
    }
    default:
      return UNPARSEABLE;
  }
}

async function tryParseBlock(
  code: string,
): Promise<{ block: LuaBlock; error?: undefined } | { error: string }> {
  try {
    return { block: await lua.parseBlock(code) };
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

/** Source range of a statement: start index, end index (exclusive) */
type Range = { start: number; end: number };

/** Top-level `<object>.<method>(...)` call statements of a parsed chunk. */
function methodCalls(
  block: LuaBlock,
  object: string,
  method: string,
): ({ call: LuaFunctionCallExpression } & Range)[] {
  const result = [];
  for (const stmt of block.statements) {
    if (stmt.type !== "FunctionCallStatement") continue;
    const { prefix, name } = stmt.call;
    if (
      !name &&
      prefix.type === "PropertyAccess" &&
      prefix.property === method &&
      prefix.object.type === "Variable" &&
      prefix.object.name === object
    ) {
      result.push({
        call: stmt.call,
        start: stmt.ctx.from!,
        end: stmt.ctx.to!,
      });
    }
  }
  return result;
}

/**
 * Top-level `config.set("path", value)` statements, with the value as a JS
 * value: undefined for nil or non-literal expressions.
 */
function configSets(block: LuaBlock): ({ path: string; value: any } & Range)[] {
  const result: ({ path: string; value: any } & Range)[] = [];
  for (const { call, start, end } of methodCalls(block, "config", "set")) {
    const [path, valueExpr] = call.args;
    if (call.args.length !== 2 || path.type !== "String") continue;
    const value = fromLuaAst(valueExpr);
    result.push({
      path: path.value,
      value: value === UNPARSEABLE ? undefined : value,
      start,
      end,
    });
  }
  return result;
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

/**
 * Top-level `command.update { name = "...", key = ..., mac = ... }`
 * statements, where key/mac are strings or string lists. Other fields, and
 * fields that are not literals, are ignored.
 */
function commandUpdates(
  block: LuaBlock,
): ({ name: string; override: CommandOverride } & Range)[] {
  const result: ({ name: string; override: CommandOverride } & Range)[] = [];
  for (const { call, start, end } of methodCalls(block, "command", "update")) {
    const [spec] = call.args;
    if (call.args.length !== 1 || spec.type !== "TableConstructor") continue;
    const fields: Record<string, any> = {};
    for (const f of spec.fields) {
      if (f.type !== "PropField") continue;
      const v = fromLuaAst(f.value);
      if (v !== UNPARSEABLE) fields[f.key] = v;
    }
    if (typeof fields.name !== "string") continue;
    const override: CommandOverride = {};
    if (isStringOrList(fields.key)) override.key = fields.key;
    if (isStringOrList(fields.mac)) override.mac = fields.mac;
    result.push({ name: fields.name, override, start, end });
  }
  return result;
}

/** A statement of the managed block that sets one override. */
export type ManagedStatement = {
  kind: "config" | "command";
  /** The config path or command name */
  key: string;
} & Range;

/**
 * Every top-level override statement of a managed block, with its source
 * range. Throws if the text is not valid Lua.
 */
export async function scanManagedStatements(
  text: string,
): Promise<ManagedStatement[]> {
  const block = await lua.parseBlock(text);
  return [
    ...configSets(block).map(({ path, start, end }) => ({
      kind: "config" as const,
      key: path,
      start,
      end,
    })),
    ...commandUpdates(block).map(({ name, start, end }) => ({
      kind: "command" as const,
      key: name,
      start,
      end,
    })),
  ];
}

/**
 * Parse the body of the configuration-manager managed block back into the
 * structured form the UI consumes (see configSets and commandUpdates). A
 * block that is not valid Lua yields no overrides and the parse error in
 * `error`; callers must then not rewrite the block from these (empty)
 * overrides.
 */
export async function parseManagedBlock(blockContent: string): Promise<{
  configOverrides: Record<string, any>;
  commandOverrides: Record<string, CommandOverride>;
  error?: string;
}> {
  const configOverrides: Record<string, any> = {};
  const commandOverrides: Record<string, CommandOverride> = {};
  const parsed = await tryParseBlock(blockContent);
  if (parsed.error !== undefined) {
    return { configOverrides, commandOverrides, error: parsed.error };
  }
  for (const { path, value } of configSets(parsed.block)) {
    configOverrides[path] = value;
  }
  for (const { name, override } of commandUpdates(parsed.block)) {
    commandOverrides[name] = override;
  }
  return { configOverrides, commandOverrides };
}
