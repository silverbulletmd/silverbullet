/**
 * Every model change that touches more than one field of a query builder
 * model, or that the UI would otherwise work out itself. All pure.
 */
import type { FieldInfo, FieldType } from "./query_fields.ts";
import { sourceType } from "./query_from.ts";
import {
  fieldChoices,
  fieldType,
  type GroupColumn,
  newId,
  type QueryModel,
  type TableColumn,
  tableColumns,
} from "./query_model.ts";
import { type FieldFilter, operatorsFor, withOperator } from "./query_ops.ts";
import { type QueryTemplate, templatesFor } from "./query_templates.ts";

export type Dropped = {
  filters: number;
  sorts: number;
  columns: number;
  groups: number;
};

const NOTHING_DROPPED: Dropped = {
  filters: 0,
  sorts: 0,
  columns: 0,
  groups: 0,
};

export function isGrouped(m: QueryModel): boolean {
  return m.group.length > 0;
}

// ---- Filters

/** A new filter on `field`, with its type's first operator */
export function newFieldFilter(
  m: QueryModel,
  fields: FieldInfo[],
  field: string,
): FieldFilter {
  return changeOperator(
    m,
    fields,
    field,
    operatorsFor(fieldType(m, fields, field))[0].id,
  );
}

/** A filter on `field` with operator `op` and fresh values */
export function changeOperator(
  m: QueryModel,
  fields: FieldInfo[],
  field: string,
  op: string,
): FieldFilter {
  return withOperator(
    field,
    fieldType(m, fields, field),
    op,
    fieldChoices(fields, field)[0]?.[0] ?? "",
  );
}

// ---- Group By

export function addGroupKey(m: QueryModel, field: string): QueryModel {
  if (m.group.includes(field)) return m;
  // Key columns come first, in key order
  const keys = m.groupColumns.filter((c) => c.kind === "key").length;
  const groupColumns = [...m.groupColumns];
  groupColumns.splice(keys, 0, {
    id: newId(),
    header: field,
    kind: "key",
    field,
  });
  return { ...m, group: [...m.group, field], groupColumns };
}

export function removeGroupKey(m: QueryModel, field: string): QueryModel {
  const group = m.group.filter((g) => g !== field);
  return {
    ...m,
    group,
    groupColumns: group.length
      ? m.groupColumns.filter((c) => !(c.kind === "key" && c.field === field))
      : [],
    // A sort on this key goes with it; sorts on keys or columns mean
    // nothing once ungrouped
    sorts: m.sorts.filter(({ by }) =>
      group.length
        ? !(by.kind === "groupKey" && by.field === field)
        : by.kind === "field" || by.kind === "expr",
    ),
  };
}

/** Removes a group column, and any sort on it */
export function removeGroupColumn(m: QueryModel, id: string): QueryModel {
  return {
    ...m,
    groupColumns: m.groupColumns.filter((c) => c.id !== id),
    sorts: m.sorts.filter((s) => !(s.by.kind === "column" && s.by.id === id)),
  };
}

/** The `agg` choice that turns a group column into a group key */
export const GROUP_KEY_CHOICE = "";

/** Makes `c` a group key (`GROUP_KEY_CHOICE`) or aggregate `agg`, keeping what still applies */
export function changeGroupColumn(
  m: QueryModel,
  c: GroupColumn,
  agg: string,
  firstField: string,
): GroupColumn {
  const { id, header } = c;
  if (agg === GROUP_KEY_CHOICE) {
    return { id, header, kind: "key", field: m.group[0] };
  }
  return c.kind === "agg"
    ? { ...c, agg }
    : { id, header, kind: "agg", agg, field: firstField, sorted: false };
}

// ---- Select

/**
 * Switches to a table of every field, or to a list: with the template that
 * best fits the tag, or a custom one when the space has none
 */
export function changeSelectMode(
  m: QueryModel,
  mode: "table" | "list",
  fields: FieldInfo[],
  templates: QueryTemplate[],
): QueryModel {
  if (mode === m.select.mode) return m;
  if (mode === "table") {
    return { ...m, select: { mode, columns: tableColumns(fields) } };
  }
  const best = templatesFor(templates, sourceType(m.source))[0];
  return {
    ...m,
    select: {
      mode,
      list: best ? { template: best.id } : { custom: "* [[${name}]]" },
    },
  };
}

/** Makes `c` show its field, a link to it, or an expression (`v` is the binding) */
export function changeColumnKind(
  c: TableColumn,
  kind: TableColumn["kind"],
  v: string,
  firstField: string,
): TableColumn {
  if (kind === c.kind) return c;
  if (kind === "expr") return { ...c, kind, value: `${v}.${c.value}` };
  return { ...c, kind, value: c.kind === "expr" ? firstField : c.value };
}

// ---- Fields

export function dropFieldUses(
  m: QueryModel,
  field: string,
): { model: QueryModel; dropped: Dropped } {
  const filters = m.filters.filter(
    (f) => !(f.kind === "field" && f.field === field),
  );
  const sorts = m.sorts.filter(
    ({ by }) =>
      !((by.kind === "field" || by.kind === "groupKey") && by.field === field),
  );
  const select =
    m.select.mode === "table"
      ? {
          ...m.select,
          columns: m.select.columns.filter(
            (c) => c.kind === "expr" || c.value !== field,
          ),
        }
      : m.select;
  let model: QueryModel = { ...m, filters, sorts, select };
  let groups = 0;
  if (m.group.includes(field)) {
    model = removeGroupKey(model, field);
    groups = 1;
  }
  model = {
    ...model,
    groupColumns: model.groupColumns.filter(
      (c) => c.kind === "key" || c.field !== field,
    ),
  };
  // Count only the columns on show: aggregates while grouped, else the table's
  const shown = (x: QueryModel) =>
    isGrouped(m)
      ? x.groupColumns.filter((c) => c.kind === "agg").length
      : x.select.mode === "table"
        ? x.select.columns.length
        : 0;
  return {
    model,
    dropped: {
      filters: m.filters.length - filters.length,
      sorts: m.sorts.length - sorts.length,
      columns: shown(m) - shown(model),
      groups,
    },
  };
}

/** Treats `field` as `type` (its own type clears the override), dropping filters the new type has no operator for */
export function setFieldType(
  m: QueryModel,
  field: FieldInfo,
  type: FieldType,
): { model: QueryModel; dropped: Dropped } {
  const overrides = { ...m.overrides };
  if (type !== field.type) overrides[field.name] = type;
  else delete overrides[field.name];
  const model = { ...m, overrides };
  const ops = new Set(
    operatorsFor(fieldType(model, [field], field.name)).map((o) => o.id),
  );
  const filters = m.filters.filter(
    (f) => f.kind !== "field" || f.field !== field.name || ops.has(f.op),
  );
  return {
    model: { ...model, filters },
    dropped: { ...NOTHING_DROPPED, filters: m.filters.length - filters.length },
  };
}

/** Drops every use of the system fields, as when they're hidden */
export function dropSystemFieldUses(
  m: QueryModel,
  fields: FieldInfo[],
): { model: QueryModel; dropped: Dropped } {
  const total = { ...NOTHING_DROPPED };
  let model = m;
  for (const f of fields.filter((x) => x.system)) {
    const result = dropFieldUses(model, f.name);
    model = result.model;
    for (const k of Object.keys(total) as (keyof Dropped)[]) {
      total[k] += result.dropped[k];
    }
  }
  return { model, dropped: total };
}

const counted = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Removed 1 filter, 1 sort and 1 column that used due", or null */
export function droppedMessage(field: string, d: Dropped): string | null {
  const parts = [
    d.filters && counted(d.filters, "filter"),
    d.sorts && counted(d.sorts, "sort"),
    d.columns && counted(d.columns, "column"),
    d.groups && counted(d.groups, "group key"),
  ].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Removed ${list} that used ${field}`;
}
