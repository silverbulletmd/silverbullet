/**
 * A property schema's type as the Schema view edits it, read from and written
 * back to JSON Schema without losing what the editor doesn't show. The helper
 * shapes match `Library/Std/APIs/Schema`.
 */
import { deepEqual } from "@silverbulletmd/silverbullet/lib/json";
import {
  helperSchema,
  type JsonSchema,
} from "../../../config_management/schema_lua.ts";

export type JsonType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object"
  | "null";

export const JSON_TYPES: readonly JsonType[] = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
  "null",
];

export type TypeChoice =
  | {
      kind: "type";
      type: JsonType;
      format?: string;
      enum?: string[];
      items?: JsonSchema;
      nullable: boolean;
    }
  | { kind: "ref"; tag?: string; nullable: boolean }
  | { kind: "tags" | "identities"; nullable: boolean }
  | { kind: "advanced"; reason: string };

/** An entry of the type menu: a JSON type, or a shape the editor has controls for */
export type TypeKind = JsonType | "enum" | "ref" | "tags" | "identities";

export const TYPE_KINDS: readonly TypeKind[] = [
  ...JSON_TYPES.filter((t) => t !== "null"),
  "enum",
  "ref",
  "tags",
  "identities",
  "null",
];

export function typeKindOf(c: TypeChoice): TypeKind | null {
  if (c.kind === "advanced") return null;
  if (c.kind !== "type") return c.kind;
  return c.enum ? "enum" : c.type;
}

/** The choice a type menu pick makes, keeping enum values when there are some */
export function choiceFor(
  kind: TypeKind,
  nullable: boolean,
  prev: TypeChoice,
): TypeChoice {
  switch (kind) {
    case "ref":
      return { kind: "ref", nullable };
    case "tags":
    case "identities":
      return { kind, nullable };
    case "enum":
      return {
        kind: "type",
        type: "string",
        enum: prev.kind === "type" && prev.enum ? prev.enum : [],
        nullable,
      };
    case "array":
      return {
        kind: "type",
        type: "array",
        items: { type: "string" },
        nullable,
      };
    default:
      return { kind: "type", type: kind, nullable };
  }
}

/** Keys a type choice owns; everything else is an annotation it keeps */
const STRUCTURAL = new Set(["type", "format", "enum", "items", "anyOf", "tag"]);
const COMPOSITION = ["oneOf", "allOf", "not", "$ref", "if"];

const NULL = helperSchema("null");

function annotations(schema: JsonSchema): JsonSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([k]) => !STRUCTURAL.has(k)),
  );
}

/** A schema with nothing but a type and its type-specific keys */
function readSimple(schema: JsonSchema): TypeChoice {
  if (COMPOSITION.some((k) => k in schema)) {
    return { kind: "advanced", reason: COMPOSITION.find((k) => k in schema)! };
  }
  if (schema.format === "ref") {
    return schema.tag === undefined
      ? { kind: "ref", nullable: false }
      : { kind: "ref", tag: schema.tag, nullable: false };
  }
  if (
    typeof schema.type !== "string" ||
    !(JSON_TYPES as readonly string[]).includes(schema.type)
  ) {
    return { kind: "advanced", reason: "no single type" };
  }
  const choice: TypeChoice = {
    kind: "type",
    type: schema.type as JsonType,
    nullable: false,
  };
  if (typeof schema.format === "string") choice.format = schema.format;
  if (Array.isArray(schema.enum)) choice.enum = [...schema.enum] as string[];
  if (schema.items !== undefined) choice.items = schema.items;
  return choice;
}

export function readTypeChoice(schema: JsonSchema): TypeChoice {
  if (Array.isArray(schema.anyOf)) {
    for (const kind of ["tags", "identities"] as const) {
      if (deepEqual(schema.anyOf, helperSchema(kind).anyOf)) {
        return { kind, nullable: schema.nullable === true };
      }
    }
    const [a, b, ...rest] = schema.anyOf;
    const other = deepEqual(b, NULL) ? a : deepEqual(a, NULL) ? b : undefined;
    // The inner schema must hold nothing the editor would drop
    if (
      rest.length === 0 &&
      other &&
      typeof other === "object" &&
      Object.keys(other).every((k) => STRUCTURAL.has(k))
    ) {
      const base = readSimple(other);
      if (base.kind === "type" || base.kind === "ref") {
        return { ...base, nullable: true };
      }
    }
    return { kind: "advanced", reason: "anyOf" };
  }
  return readSimple(schema);
}

function core(choice: Exclude<TypeChoice, { kind: "advanced" }>): JsonSchema {
  switch (choice.kind) {
    case "ref":
      return choice.tag === undefined
        ? { type: "string", format: "ref" }
        : { type: "string", format: "ref", tag: choice.tag };
    case "tags":
    case "identities":
      return helperSchema(choice.kind);
    case "type": {
      const out: JsonSchema = { type: choice.type };
      if (choice.format !== undefined) out.format = choice.format;
      if (choice.enum !== undefined) out.enum = [...choice.enum];
      if (choice.items !== undefined) out.items = choice.items;
      return out;
    }
  }
}

export function applyTypeChoice(
  schema: JsonSchema,
  choice: TypeChoice,
): JsonSchema {
  if (choice.kind === "advanced") return schema;
  const kept = annotations(schema);
  if (choice.kind === "tags" || choice.kind === "identities") {
    // The helpers take nullable as one of their extra keys
    const { nullable: _, ...rest } = kept;
    return {
      ...core(choice),
      ...rest,
      ...(choice.nullable ? { nullable: true } : {}),
    };
  }
  if (choice.nullable) return { anyOf: [core(choice), NULL], ...kept };
  return { ...core(choice), ...kept };
}

export function typeLabel(schema: JsonSchema): string {
  const choice = readTypeChoice(schema);
  const q = (s: string, nullable: boolean) => (nullable ? `${s}?` : s);
  switch (choice.kind) {
    case "advanced":
      return choice.reason === "no single type" ? "custom" : choice.reason;
    case "ref":
      return q(choice.tag ? `ref → ${choice.tag}` : "ref", choice.nullable);
    case "tags":
    case "identities":
      return choice.kind;
    case "type": {
      if (choice.enum) return q("enum", choice.nullable);
      if (choice.type === "array" && choice.items) {
        return q(`array of ${typeLabel(choice.items)}`, choice.nullable);
      }
      const base = choice.format
        ? `${choice.type} · ${choice.format}`
        : choice.type;
      return q(base, choice.nullable);
    }
  }
}
