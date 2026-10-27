/**
 * The query builder's model: what the user picked, from which the query text
 * is generated (`query_text.ts`).
 */
import {
  effectiveType,
  type AttributeInfo,
  type AttributeType,
  isLuaName,
} from "./query_attributes.ts";
import { type QuerySource, sourceType } from "./query_from.ts";
import type { Filter, OperatorType } from "./query_ops.ts";

/** What a sort orders by */
export type SortBy =
  | { kind: "attribute"; attribute: string }
  | { kind: "expr"; lua: string }
  /** While grouped: the group key of this attribute */
  | { kind: "groupKey"; attribute: string }
  /** While grouped: the group column with this id */
  | { kind: "column"; id: string };

export type Sort = { by: SortBy; desc: boolean; nulls?: "first" | "last" };

export type TableColumn = {
  /** Stable while the column is edited or moved */
  id: string;
  header: string;
  kind: "attribute" | "link" | "expr";
  value: string;
};

/** A column of grouped results: a group key, or an aggregate over each group */
export type GroupColumn = {
  /** Stable while the column is renamed or moved, so a sort can refer to it */
  id: string;
  header: string;
} & (
  | { kind: "key"; attribute: string }
  | {
      kind: "agg";
      agg: string;
      attribute: string;
      sorted: boolean;
      where?: string;
    }
);

export type ListSelect = { template: string } | { custom: string };

export type QuerySelect =
  | { mode: "table"; columns: TableColumn[] }
  | { mode: "list"; list: ListSelect };

export type QueryModel = {
  source: QuerySource;
  /** The objects' variable (`from t = …`); null for `from index.tasks()`, where `_` is the object */
  binding: string | null;
  filters: Filter[];
  /** The group keys; a group key needn't have a column */
  group: string[];
  sorts: Sort[];
  select: QuerySelect;
  /** Used instead of `select` while grouped */
  groupColumns: GroupColumn[];
  limit: number | null;
  overrides: Record<string, AttributeType>;
};

/** The variable the query's Lua uses for each object */
export function objectVar(m: QueryModel): string {
  return m.binding ?? "_";
}

export function bindingVar(tag: string): string {
  if (tag === "task") return "t";
  const first = tag[0]?.toLowerCase() ?? "";
  return /[a-z]/.test(first) ? first : "o";
}

let lastId = 0;

/** An id for a column, unique for the session */
export function newId(): string {
  return `c${++lastId}`;
}

/**
 * Lua reading `path` from the object `v`. A nested path reads each record
 * first, `(t.a and t.a.b)`, so an object without the record gives nil
 * rather than an error.
 */
export function attributeAccess(v: string, path: string): string {
  const steps = path
    .split(".")
    .map((seg) => (isLuaName(seg) ? `.${seg}` : `[${JSON.stringify(seg)}]`));
  if (steps.length === 1) return v + steps[0];
  const prefixes = steps.map((_, i) => v + steps.slice(0, i + 1).join(""));
  return `(${prefixes.join(" and ")})`;
}

/** The type `name` is treated as: its override, else its inferred type */
export function attributeType(
  m: QueryModel,
  attributes: AttributeInfo[],
  name: string,
): OperatorType {
  const f = attributes.find((x) => x.name === name);
  return f ? effectiveType(f, m.overrides[name]) : "text";
}

/** Values to pick from: one-of values, list items or seen values, with counts */
export function attributeChoices(
  attributes: AttributeInfo[],
  name: string,
): [string, number][] {
  const f = attributes.find((x) => x.name === name);
  if (!f) return [];
  if (f.enumValues) {
    const counts = new Map(f.values);
    return f.enumValues.map((v) => [v, counts.get(v) ?? 0]);
  }
  return f.values;
}

export function attributeColumn(attribute: string): TableColumn {
  return {
    id: newId(),
    header: attribute,
    kind: "attribute",
    value: attribute,
  };
}

export function tableColumns(attributes: AttributeInfo[]): TableColumn[] {
  return attributes
    .filter((f) => !f.system)
    .map((f) => attributeColumn(f.name));
}

export function emptyModel(
  source: QuerySource,
  attributes: AttributeInfo[],
): QueryModel {
  // Declared attributes no sampled object has would only add empty columns
  const sampled = attributes.some((f) => f.present > 0);
  return {
    source,
    binding: bindingVar(sourceType(source)),
    filters: [],
    group: [],
    sorts: [],
    select: {
      mode: "table",
      columns: tableColumns(
        sampled ? attributes.filter((f) => f.present > 0) : attributes,
      ),
    },
    groupColumns: [],
    limit: null,
    overrides: {},
  };
}
