/**
 * The Schema view's rows: a tag's declared attributes merged with those
 * inferred from a sample of its objects.
 */
import type { JsonSchema } from "../../../config_management/schema_lua.ts";
import { validateObject } from "../../../plugos/syscalls/jsonschema.ts";
import type { AttributeInfo } from "../../query/query_attributes.ts";

export type AttributeOrigin = "inherited" | "declared" | "local" | "inferred";

export type AttributeRow = {
  name: string;
  /** null for an inferred attribute not yet declared */
  schema: JsonSchema | null;
  /** What declaring an inferred attribute would start from */
  suggested: JsonSchema | null;
  required: boolean;
  origin: AttributeOrigin;
  present: number;
  sampled: number;
  invalid: number;
};

export type RowsInput = {
  /** The tag's schema as loaded */
  effective: JsonSchema | null;
  /** For a user tag, the schema of the root tag its objects are */
  rootSchema: JsonSchema | null;
  /** Properties the schemas block sets for this tag */
  localPaths: Set<string>;
  inferred: AttributeInfo[];
  samples: Record<string, unknown>[];
};

const SCALARS: Record<string, JsonSchema> = {
  text: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  date: { type: "string", format: "date" },
  datetime: { type: "string", format: "date-time" },
  pagelink: { type: "string", format: "ref" },
  url: { type: "string", format: "uri" },
  list: { type: "array", items: { type: "string" } },
  record: { type: "object" },
};

export function inferredSchema(info: AttributeInfo): JsonSchema {
  if (info.type === "enum") {
    return { type: "string", enum: [...(info.enumValues ?? [])] };
  }
  if (info.type === "mixed") {
    return {
      anyOf: Object.keys(info.mixed ?? {}).map((t) => ({
        ...(SCALARS[t] ?? { type: "string" }),
      })),
    };
  }
  return { ...(SCALARS[info.type] ?? { type: "string" }) };
}

function propertiesOf(schema: JsonSchema | null): Record<string, JsonSchema> {
  return schema?.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
}

function invalidCount(
  name: string,
  schema: JsonSchema | null,
  samples: Record<string, unknown>[],
): number {
  if (!schema) return 0;
  const wrapper = { type: "object", properties: { [name]: schema } };
  let invalid = 0;
  for (const s of samples) {
    if (s[name] === undefined || s[name] === null) continue;
    if (validateObject(wrapper, { [name]: s[name] })) invalid++;
  }
  return invalid;
}

export function buildRows(input: RowsInput): AttributeRow[] {
  const { effective, rootSchema, localPaths, inferred, samples } = input;
  const declared = propertiesOf(effective);
  const rootProps = propertiesOf(rootSchema);
  const required = new Set<string>(
    Array.isArray(effective?.required) ? effective.required : [],
  );
  const inferredByName = new Map(inferred.map((i) => [i.name, i]));
  const names: string[] = [...Object.keys(declared)];
  for (const i of inferred) {
    if (i.system || names.includes(i.name)) continue;
    // A record attribute is listed once, not through its dotted children
    const parent = i.name.split(".")[0];
    if (i.name.includes(".") && inferredByName.has(parent)) continue;
    names.push(i.name);
  }
  const rows = names.map((name) => {
    const schema = declared[name] ?? null;
    const guess = inferredByName.get(name);
    const origin: AttributeOrigin = localPaths.has(name)
      ? "local"
      : name in rootProps
        ? "inherited"
        : schema
          ? "declared"
          : "inferred";
    return {
      name,
      schema,
      suggested: schema ? null : guess ? inferredSchema(guess) : null,
      required: required.has(name),
      origin,
      present: samples.filter((s) => s[name] !== undefined && s[name] !== null)
        .length,
      sampled: samples.length,
      invalid: invalidCount(name, schema, samples),
    };
  });
  // The tag's own attributes first; what its root tag brings comes last
  return [
    ...rows.filter((r) => r.origin !== "inherited"),
    ...rows.filter((r) => r.origin === "inherited"),
  ];
}

/** A row as the Schema view shows it, with the tag's unsaved edits applied */
export type DraftRow = AttributeRow & {
  edited?: boolean;
  removed?: boolean;
  added?: boolean;
  renamedFrom?: string;
  reset?: boolean;
};

/** The minimal draft shape this needs (see `SchemaDrafts`) */
type Draft = {
  rules: Map<string, JsonSchema | null>;
  renamed: Map<string, string>;
  required: Map<string, boolean>;
  resets: Set<string>;
};

export function withDraft(rows: AttributeRow[], draft?: Draft): DraftRow[] {
  if (!draft) return rows;
  const out: DraftRow[] = rows.map((r) => {
    const name = draft.renamed.get(r.name) ?? r.name;
    const row: DraftRow = { ...r, name };
    if (name !== r.name) row.renamedFrom = r.name;
    const rule = draft.rules.get(name);
    if (rule === null) row.removed = true;
    else if (rule !== undefined) {
      row.schema = rule;
      row.edited = true;
    }
    const required = draft.required.get(name);
    if (required !== undefined) row.required = required;
    if (draft.resets.has(r.name)) row.reset = true;
    return row;
  });
  const names = new Set(out.map((r) => r.name));
  for (const [name, rule] of draft.rules) {
    if (rule === null || names.has(name)) continue;
    out.push({
      name,
      schema: rule,
      suggested: null,
      required: draft.required.get(name) ?? false,
      origin: "local",
      present: 0,
      sampled: rows[0]?.sampled ?? 0,
      invalid: 0,
      added: true,
    });
  }
  return out;
}

/**
 * The tag's own schema as its rows show it, without what its root tag brings.
 * Inferred attributes count only where `declare` picks them, with the type
 * their values suggest.
 */
export function schemaFor(
  rows: DraftRow[],
  declare: (row: DraftRow) => boolean = () => false,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const row of rows) {
    if (row.removed || row.origin === "inherited") continue;
    const schema = row.schema ?? (declare(row) ? row.suggested : null);
    if (schema) properties[row.name] = schema;
  }
  const required = rows
    .filter((r) => r.required && !r.removed)
    .map((r) => r.name);
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
  };
}
