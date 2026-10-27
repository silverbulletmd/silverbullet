/**
 * Every model change that touches more than one part of a query builder
 * model, or that the UI would otherwise work out itself. All pure.
 */
import type { AttributeInfo, AttributeType } from "./query_attributes.ts";
import { sourceType } from "./query_from.ts";
import {
  attributeChoices,
  attributeType,
  type GroupColumn,
  newId,
  type QueryModel,
  type TableColumn,
  tableColumns,
} from "./query_model.ts";
import {
  type AttributeFilter,
  operatorsFor,
  withOperator,
} from "./query_ops.ts";
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

/** A new filter on `attribute`, with its type's first operator */
export function newAttributeFilter(
  m: QueryModel,
  attributes: AttributeInfo[],
  attribute: string,
): AttributeFilter {
  return changeOperator(
    m,
    attributes,
    attribute,
    operatorsFor(attributeType(m, attributes, attribute))[0].id,
  );
}

/** A filter on `attribute` with operator `op` and fresh values */
export function changeOperator(
  m: QueryModel,
  attributes: AttributeInfo[],
  attribute: string,
  op: string,
): AttributeFilter {
  return withOperator(
    attribute,
    attributeType(m, attributes, attribute),
    op,
    attributeChoices(attributes, attribute)[0]?.[0] ?? "",
  );
}

// ---- Group By

export function addGroupKey(m: QueryModel, attribute: string): QueryModel {
  if (m.group.includes(attribute)) return m;
  // Key columns come first, in key order
  const keys = m.groupColumns.filter((c) => c.kind === "key").length;
  const groupColumns = [...m.groupColumns];
  groupColumns.splice(keys, 0, {
    id: newId(),
    header: attribute,
    kind: "key",
    attribute,
  });
  return { ...m, group: [...m.group, attribute], groupColumns };
}

export function removeGroupKey(m: QueryModel, attribute: string): QueryModel {
  const group = m.group.filter((g) => g !== attribute);
  return {
    ...m,
    group,
    groupColumns: group.length
      ? m.groupColumns.filter(
          (c) => !(c.kind === "key" && c.attribute === attribute),
        )
      : [],
    // A sort on this key goes with it; sorts on keys or columns mean
    // nothing once ungrouped
    sorts: m.sorts.filter(({ by }) =>
      group.length
        ? !(by.kind === "groupKey" && by.attribute === attribute)
        : by.kind === "attribute" || by.kind === "expr",
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
  firstAttribute: string,
): GroupColumn {
  const { id, header } = c;
  if (agg === GROUP_KEY_CHOICE) {
    return { id, header, kind: "key", attribute: m.group[0] };
  }
  return c.kind === "agg"
    ? { ...c, agg }
    : {
        id,
        header,
        kind: "agg",
        agg,
        attribute: firstAttribute,
        sorted: false,
      };
}

// ---- Select

/**
 * Switches to a table of every attribute, or to a list: with the template that
 * best fits the tag, or a custom one when the space has none
 */
export function changeSelectMode(
  m: QueryModel,
  mode: "table" | "list",
  attributes: AttributeInfo[],
  templates: QueryTemplate[],
): QueryModel {
  if (mode === m.select.mode) return m;
  if (mode === "table") {
    return { ...m, select: { mode, columns: tableColumns(attributes) } };
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

/** Makes `c` show its attribute, a link to it, or an expression (`v` is the binding) */
export function changeColumnKind(
  c: TableColumn,
  kind: TableColumn["kind"],
  v: string,
  firstAttribute: string,
): TableColumn {
  if (kind === c.kind) return c;
  if (kind === "expr") return { ...c, kind, value: `${v}.${c.value}` };
  return { ...c, kind, value: c.kind === "expr" ? firstAttribute : c.value };
}

// ---- Attributes

export function dropAttributeUses(
  m: QueryModel,
  attribute: string,
): { model: QueryModel; dropped: Dropped } {
  const filters = m.filters.filter(
    (f) => !(f.kind === "attribute" && f.attribute === attribute),
  );
  const sorts = m.sorts.filter(
    ({ by }) =>
      !(
        (by.kind === "attribute" || by.kind === "groupKey") &&
        by.attribute === attribute
      ),
  );
  const select =
    m.select.mode === "table"
      ? {
          ...m.select,
          columns: m.select.columns.filter(
            (c) => c.kind === "expr" || c.value !== attribute,
          ),
        }
      : m.select;
  let model: QueryModel = { ...m, filters, sorts, select };
  let groups = 0;
  if (m.group.includes(attribute)) {
    model = removeGroupKey(model, attribute);
    groups = 1;
  }
  model = {
    ...model,
    groupColumns: model.groupColumns.filter(
      (c) => c.kind === "key" || c.attribute !== attribute,
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

/** Treats `attribute` as `type` (its own type clears the override), dropping filters the new type has no operator for */
export function setAttributeType(
  m: QueryModel,
  attribute: AttributeInfo,
  type: AttributeType,
): { model: QueryModel; dropped: Dropped } {
  const overrides = { ...m.overrides };
  if (type !== attribute.type) overrides[attribute.name] = type;
  else delete overrides[attribute.name];
  const model = { ...m, overrides };
  const ops = new Set(
    operatorsFor(attributeType(model, [attribute], attribute.name)).map(
      (o) => o.id,
    ),
  );
  const filters = m.filters.filter(
    (f) =>
      f.kind !== "attribute" || f.attribute !== attribute.name || ops.has(f.op),
  );
  return {
    model: { ...model, filters },
    dropped: { ...NOTHING_DROPPED, filters: m.filters.length - filters.length },
  };
}

/** Drops every use of the system attributes, as when they're hidden */
export function dropSystemAttributeUses(
  m: QueryModel,
  attributes: AttributeInfo[],
): { model: QueryModel; dropped: Dropped } {
  const total = { ...NOTHING_DROPPED };
  let model = m;
  for (const f of attributes.filter((x) => x.system)) {
    const result = dropAttributeUses(model, f.name);
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
export function droppedMessage(attribute: string, d: Dropped): string | null {
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
  return `Removed ${list} that used ${attribute}`;
}
