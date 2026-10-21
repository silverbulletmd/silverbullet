/**
 * The query builder's field list for a tag: a declared schema merged with one
 * inferred from a sample of the tag's objects.
 */

export type FieldType =
  | "text"
  | "enum"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "list"
  | "pagelink"
  | "url"
  | "record"
  | "mixed";

export type ValueType = Exclude<FieldType, "enum" | "mixed">;

export type FieldSource = "built-in" | "declared" | "inferred";

export type FieldInfo = {
  name: string;
  type: FieldType;
  source: FieldSource;
  system: boolean;
  /** How many sampled objects have a value */
  present: number;
  total: number;
  /** Distinct values (list fields: distinct items), by descending count */
  values: [string, number][];
  enumValues?: string[];
  range?: [number, number];
  /** Counts per value type, when `type` is `"mixed"` */
  mixed?: Record<string, number>;
};

export type DeclaredFields = Record<
  string,
  { type: FieldType; enumValues?: string[] }
>;

/** Indexer bookkeeping, hidden unless asked for */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  "ref",
  "tag",
  "itags",
  "pos",
  "toPos",
  "range",
]);

const MAX_VALUES = 50;
const ENUM_MAX_DISTINCT = 8;
const ENUM_MIN_COVERAGE = 0.8;

export function valueType(v: unknown): ValueType | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return "list";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "object") return "record";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date";
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return "datetime";
  if (/^\[\[.+\]\]$/.test(s)) return "pagelink";
  if (/^https?:\/\//.test(s)) return "url";
  return "text";
}

/** Top-level values plus one level of nested record values, as dotted names */
function flatten(obj: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    out.set(k, v);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out.set(`${k}.${k2}`, v2);
      }
    }
  }
  return out;
}

function countsByDescending(counts: Map<string, number>): [string, number][] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VALUES);
}

export function inferFields(
  samples: Record<string, unknown>[],
  declared: DeclaredFields | null,
  builtIn: boolean,
): FieldInfo[] {
  const flat = samples.map(flatten);
  const names: string[] = [];
  for (const o of flat) {
    for (const k of o.keys()) {
      // A record field is listed through its dotted children
      if (!names.includes(k)) names.push(k);
    }
  }
  for (const k of Object.keys(declared ?? {})) {
    if (!names.includes(k)) names.push(k);
  }

  return names.map((name) => {
    const vals = flat
      .map((o) => o.get(name))
      .filter((v) => v !== null && v !== undefined);
    const typeCounts: Record<string, number> = {};
    const distinct = new Map<string, number>();
    for (const v of vals) {
      const t = valueType(v)!;
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      for (const x of Array.isArray(v) ? v : [v]) {
        if (x === null || typeof x === "object") continue;
        const key = String(x);
        distinct.set(key, (distinct.get(key) ?? 0) + 1);
      }
    }
    const field: FieldInfo = {
      name,
      type: "text",
      source: "inferred",
      system: SYSTEM_FIELDS.has(name),
      present: vals.length,
      total: samples.length,
      values: countsByDescending(distinct),
    };

    const decl = declared?.[name];
    const types = Object.keys(typeCounts);
    // A schema's plain string can still hold dates or links throughout
    const format =
      types.length === 1 &&
      ["date", "datetime", "pagelink", "url"].includes(types[0])
        ? (types[0] as FieldType)
        : null;
    if (decl) {
      field.type = decl.type === "text" && format ? format : decl.type;
      field.source = builtIn ? "built-in" : "declared";
      if (decl.enumValues) field.enumValues = decl.enumValues;
    } else {
      if (types.length > 1) {
        field.type = "mixed";
        field.mixed = typeCounts;
      } else if (types.length === 1) {
        field.type = types[0] as FieldType;
      }
      if (field.type === "text" && isEnum(distinct, vals.length)) {
        field.type = "enum";
        field.enumValues = [...distinct.keys()];
      }
    }

    const nums = vals.filter((v): v is number => typeof v === "number");
    if (nums.length) field.range = [Math.min(...nums), Math.max(...nums)];
    return field;
  });
}

function isEnum(distinct: Map<string, number>, present: number): boolean {
  if (present === 0 || distinct.size > ENUM_MAX_DISTINCT) return false;
  let repeated = 0;
  for (const n of distinct.values()) if (n >= 2) repeated += n;
  return repeated / present >= ENUM_MIN_COVERAGE;
}

/** Mixed fields are offered text operators */
export function effectiveType(
  f: FieldInfo,
  override?: FieldType,
): Exclude<FieldType, "mixed"> {
  const t = override ?? f.type;
  return t === "mixed" ? "text" : t;
}

function schemaFieldType(prop: any): {
  type: FieldType;
  enumValues?: string[];
} {
  if (Array.isArray(prop?.anyOf)) {
    const nonNull = prop.anyOf.find((p: any) => p?.type !== "null");
    return schemaFieldType(nonNull);
  }
  if (Array.isArray(prop?.enum)) {
    return { type: "enum", enumValues: prop.enum.map(String) };
  }
  switch (prop?.type) {
    case "string":
      if (prop.format === "date") return { type: "date" };
      if (prop.format === "date-time") return { type: "datetime" };
      return { type: "text" };
    case "number":
    case "integer":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "array":
      return { type: "list" };
    case "object":
      return { type: "record" };
    default:
      return { type: "text" };
  }
}

export function declaredFieldsFromSchema(
  schema: unknown,
): DeclaredFields | null {
  const props = (schema as any)?.properties;
  if (!props || typeof props !== "object") return null;
  const out: DeclaredFields = {};
  for (const [name, prop] of Object.entries(props)) {
    out[name] = schemaFieldType(prop);
  }
  return out;
}

// Lua's reserved words, plus the query clause words, are never bare names
const RESERVED = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
  "from",
  "where",
  "select",
  "limit",
  "offset",
  "order",
  "group",
  "by",
  "having",
  "desc",
  "asc",
  "nulls",
]);

/** Whether `s` can be written as a bare Lua name (`t.s`, `{ s = … }`) */
export function isLuaName(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !RESERVED.has(s);
}

/** `header` as a table key: bare when it can be, else quoted */
export function tableKey(header: string): string {
  return isLuaName(header) ? header : `[${JSON.stringify(header)}]`;
}

function mixedNote(mixed: Record<string, number>): string {
  return Object.entries(mixed)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
}

/** A `tag.define` snippet giving `tag` a declared schema from these fields */
export function tagDefineSnippet(
  tag: string,
  fields: FieldInfo[],
  overrides: Record<string, FieldType>,
): string {
  const props = fields
    .filter((f) => !f.system)
    .map((f) => {
      const t = overrides[f.name] ?? f.type;
      let schema = "schema.string()";
      let note = "";
      switch (t) {
        case "number":
          schema = "schema.number()";
          break;
        case "boolean":
          schema = "schema.boolean()";
          break;
        case "list":
          schema = 'schema.array("string")';
          break;
        case "enum":
          schema = `{ type = "string", enum = { ${(f.enumValues ?? [])
            .map((v) => JSON.stringify(v))
            .join(", ")} } }`;
          break;
        case "date":
          note = " -- date, YYYY-MM-DD";
          break;
        case "datetime":
          note = " -- date-time";
          break;
        case "pagelink":
          note = " -- page link";
          break;
        case "mixed":
          note = ` -- seen as ${mixedNote(f.mixed ?? {})}`;
          break;
      }
      return `      ${tableKey(f.name)} = ${schema},${note}`;
    });
  return [
    "tag.define {",
    `  name = ${JSON.stringify(tag)},`,
    "  schema = {",
    '    type = "object",',
    "    properties = {",
    ...props,
    "    },",
    "  },",
    "}",
  ].join("\n");
}
