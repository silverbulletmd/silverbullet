/**
 * Filter operators for the query builder: which ones each field type offers,
 * and the Lua condition each generates.
 */
import type { FieldType } from "./query_fields.ts";

export type OperatorInput =
  | "none"
  | "text"
  | "number"
  | "date"
  | "enum"
  | "multi";

export type FieldFilter = {
  kind: "field";
  field: string;
  op: string;
  /** The operator's values: none, one, two (between), or any number (multi) */
  values: string[];
};

export type ExpressionFilter = { kind: "expr"; expr: string };

export type Filter = FieldFilter | ExpressionFilter;

export type Operator = {
  id: string;
  label: string;
  input: OperatorInput;
  /** How many values the input takes; "multi" takes one or more */
  arity: 0 | 1 | 2;
  /** A condition that can be joined with `and` as is */
  lua(access: string, values: string[]): string;
  /**
   * The value type the condition needs: it would throw for anything else
   * (a missing value, or another type in a mixed field), so it's checked first
   */
  needs?: "string" | "number";
};

export type OperatorType = Exclude<FieldType, "mixed">;

export function luaString(s: string): string {
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

const TODAY = 'os.date("%Y-%m-%d")';

function anyOf(parts: string[]): string {
  return parts.length === 1 ? parts[0] : `(${parts.join(" or ")})`;
}

function op(
  id: string,
  label: string,
  input: OperatorInput,
  lua: Operator["lua"],
  needs?: Operator["needs"],
): Operator {
  return { id, label, input, arity: input === "none" ? 0 : 1, lua, needs };
}

/** An operator taking two values of `input` */
function op2(
  id: string,
  label: string,
  input: "number" | "date",
  lua: Operator["lua"],
  needs: Operator["needs"],
): Operator {
  return { ...op(id, label, input, lua, needs), arity: 2 };
}

const EXISTS = [
  op("exists", "exists", "none", (a) => `${a} ~= nil`),
  op("missing", "doesn't exist", "none", (a) => `${a} == nil`),
];

const TEXT = [
  op("is", "is", "text", (a, [v]) => `${a} == ${luaString(v)}`),
  op("isnot", "is not", "text", (a, [v]) => `${a} ~= ${luaString(v)}`),
  op(
    "contains",
    "contains",
    "text",
    (a, [v]) => `${a}:find(${luaString(v)}, 1, true)`,
    "string",
  ),
  op(
    "starts",
    "starts with",
    "text",
    (a, [v]) => `${a}:startsWith(${luaString(v)})`,
    "string",
  ),
  op("oneof", "one of", "multi", (a, values) =>
    anyOf(values.map((v) => `${a} == ${luaString(v)}`)),
  ),
  op("empty", "is empty", "none", (a) => `(${a} == nil or ${a} == "")`),
];

const comparison = (id: string, label: string, sym: string) =>
  op(id, label, "number", (a, [v]) => `${a} ${sym} ${num(v)}`, "number");

const NUMBER = [
  op("eq", "=", "number", (a, [v]) => `${a} == ${num(v)}`),
  op("ne", "≠", "number", (a, [v]) => `${a} ~= ${num(v)}`),
  comparison("lt", "<", "<"),
  comparison("le", "≤", "<="),
  comparison("gt", ">", ">"),
  comparison("ge", "≥", ">="),
  op2(
    "between",
    "between",
    "number",
    (a, [v, v2]) => `(${a} >= ${num(v)} and ${a} <= ${num(v2)})`,
    "number",
  ),
];

function dateOps(datetime: boolean): Operator[] {
  return [
    op(
      "before",
      "before",
      "date",
      (a, [v]) => `${a} < ${luaString(v)}`,
      "string",
    ),
    op(
      "after",
      "after",
      "date",
      (a, [v]) => `${a} > ${luaString(v)}`,
      "string",
    ),
    datetime
      ? op(
          "on",
          "on",
          "date",
          (a, [v]) => `${a}:sub(1, 10) == ${luaString(v)}`,
          "string",
        )
      : op("on", "on", "date", (a, [v]) => `${a} == ${luaString(v)}`),
    op2(
      "between",
      "between",
      "date",
      (a, [v, v2]) => `(${a} >= ${luaString(v)} and ${a} <= ${luaString(v2)})`,
      "string",
    ),
    op(
      "beforetoday",
      "before today",
      "none",
      (a) => `${a} < ${TODAY}`,
      "string",
    ),
    op("aftertoday", "after today", "none", (a) => `${a} > ${TODAY}`, "string"),
  ];
}

const OPERATORS: Record<OperatorType, Operator[]> = {
  text: TEXT,
  url: TEXT,
  enum: [
    op("is", "is", "enum", (a, [v]) => `${a} == ${luaString(v)}`),
    op("isnot", "is not", "enum", (a, [v]) => `${a} ~= ${luaString(v)}`),
    op("oneof", "one of", "multi", (a, values) =>
      anyOf(values.map((v) => `${a} == ${luaString(v)}`)),
    ),
  ],
  number: NUMBER,
  date: dateOps(false),
  datetime: dateOps(true),
  boolean: [
    op("true", "is true", "none", (a) => a),
    op("false", "is false", "none", (a) => `not ${a}`),
  ],
  list: [
    op(
      "contains",
      "contains",
      "text",
      (a, [v]) => `table.includes(${a}, ${luaString(v)})`,
    ),
    op("any", "contains any of", "multi", (a, values) =>
      anyOf(values.map((v) => `table.includes(${a}, ${luaString(v)})`)),
    ),
    op("empty", "is empty", "none", (a) => `(${a} == nil or #${a} == 0)`),
  ],
  pagelink: [
    op(
      "is",
      "is",
      "text",
      (a, [v]) =>
        `(${a} == ${luaString(`[[${v}]]`)} or ${a} == ${luaString(v)})`,
    ),
  ],
  record: [],
};

export function operatorsFor(type: OperatorType): Operator[] {
  return [...OPERATORS[type], ...EXISTS];
}

export function operatorOf(type: OperatorType, id: string): Operator {
  const ops = operatorsFor(type);
  return ops.find((o) => o.id === id) ?? ops[0];
}

export function filterLua(
  filter: Filter,
  access: string,
  type: OperatorType,
): string {
  if (filter.kind === "expr") return filter.expr;
  const o = operatorOf(type, filter.op);
  const cond = o.lua(access, filter.values);
  return o.needs ? `type(${access}) == "${o.needs}" and ${cond}` : cond;
}

/** Whether the filter has every value its operator needs */
export function filterValid(f: FieldFilter, type: OperatorType): boolean {
  const o = operatorOf(type, f.op);
  if (o.input === "multi") return f.values.length > 0;
  return f.values.length === o.arity && f.values.every((v) => v !== "");
}

/** A filter on `field` with operator `opId`, its values reset (a one-of starts on `first`) */
export function withOperator(
  field: string,
  type: OperatorType,
  opId: string,
  first: string,
): FieldFilter {
  const o = operatorOf(type, opId);
  return {
    kind: "field",
    field,
    op: o.id,
    values: o.input === "enum" ? [first] : [],
  };
}
