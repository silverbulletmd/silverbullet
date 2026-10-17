import { Button } from "@silverbulletmd/silverbullet/ui";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Client } from "../../client.ts";
import type { QueryBuilder } from "../query_builder.ts";
import {
  addGroupKey,
  isGrouped,
  newFieldFilter,
  removeGroupKey,
} from "../query_edits.ts";
import {
  objectVar,
  type QueryModel,
  type Sort,
  type SortBy,
} from "../query_model.ts";
import { type Filter, operatorOf } from "../query_ops.ts";
import { LuaLineInput } from "./lua_line_input.tsx";
import { FilterEditor } from "./query_filter_editor.tsx";

export type RowProps = {
  client: Client;
  builder: QueryBuilder;
  model: QueryModel;
};

export function Clause({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <>
      <span className="sb-wbq-label">{label}</span>
      <div className="sb-wbq-row" role="group" aria-label={label}>
        {children}
      </div>
    </>
  );
}

function Pill({
  children,
  onClick,
  onRemove,
  removeLabel,
  editing,
  title,
}: {
  children: ComponentChildren;
  onClick?: () => void;
  onRemove: () => void;
  removeLabel: string;
  editing?: boolean;
  title?: string;
}) {
  return (
    <span className={`sb-wbq-pill${editing ? " sb-wbq-pill-editing" : ""}`}>
      {onClick ? (
        <button
          type="button"
          className="sb-wbq-pill-body"
          title={title}
          onClick={onClick}
        >
          {children}
        </button>
      ) : (
        <span className="sb-wbq-pill-body">{children}</span>
      )}
      <button
        type="button"
        className="sb-wbq-x"
        aria-label={removeLabel}
        onClick={onRemove}
      >
        ✕
      </button>
    </span>
  );
}

export function AddButton({
  children,
  onClick,
}: {
  children: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="sb-wbq-add" onClick={onClick}>
      {children}
    </button>
  );
}

// ---- Where

export function WhereRow({ client, builder, model }: RowProps) {
  const [editing, setEditing] = useState<{
    index: number;
    draft: Filter;
  } | null>(null);
  const apply = () => {
    if (!editing) return;
    const { index, draft } = editing;
    builder.update((m) => ({
      ...m,
      filters:
        index < 0
          ? [...m.filters, draft]
          : m.filters.map((f, i) => (i === index ? draft : f)),
    }));
    setEditing(null);
  };

  return (
    <Clause label="Where">
      {model.filters.map((f, i) => (
        <Pill
          key={i}
          editing={editing?.index === i}
          onClick={() => setEditing({ index: i, draft: f })}
          removeLabel="Remove filter"
          onRemove={() => {
            builder.update((m) => ({
              ...m,
              filters: m.filters.filter((_, j) => j !== i),
            }));
            setEditing(null);
          }}
        >
          {f.kind === "expr" ? (
            <>
              <span className="sb-wbq-op">expression</span>
              <span className="sb-wbq-expr">{f.expr}</span>
            </>
          ) : (
            <>
              <span className="sb-wbq-field">{f.field}</span>
              <span className="sb-wbq-op">
                {operatorOf(builder.typeOf(f.field), f.op).label}
              </span>
              {f.values.map((v, j) => (
                <span key={j} className="sb-wbq-value">
                  {v}
                </span>
              ))}
            </>
          )}
        </Pill>
      ))}
      {editing ? (
        <FilterEditor
          key={editing.index}
          client={client}
          builder={builder}
          draft={editing.draft}
          isNew={editing.index < 0}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onApply={apply}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
          <AddButton
            onClick={() =>
              setEditing({
                index: -1,
                draft: newFieldFilter(
                  model,
                  builder.fields,
                  builder.firstField(),
                ),
              })
            }
          >
            + Filter
          </AddButton>
          <AddButton
            onClick={() =>
              setEditing({ index: -1, draft: { kind: "expr", expr: "" } })
            }
          >
            + Expression
          </AddButton>
        </>
      )}
    </Clause>
  );
}

// ---- Group By

export function GroupByRow({ builder, model }: RowProps) {
  const [adding, setAdding] = useState(false);
  return (
    <Clause label="Group By">
      {model.group.map((g) => (
        <Pill
          key={g}
          removeLabel={`Remove group key ${g}`}
          onRemove={() => builder.update((m) => removeGroupKey(m, g))}
        >
          <span className="sb-wbq-field">{g}</span>
        </Pill>
      ))}
      {adding ? (
        <div className="sb-wbq-editor">
          <select
            className="sb-select"
            aria-label="Field"
            value=""
            onChange={(e) => {
              const field = e.currentTarget.value;
              if (field) builder.update((m) => addGroupKey(m, field));
              setAdding(false);
            }}
          >
            <option value="">choose a field</option>
            {builder.offeredFields().map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <>
          <AddButton onClick={() => setAdding(true)}>+ Group by</AddButton>
          {isGrouped(model) ? null : (
            <span className="sb-wbq-note">
              optional: one result per distinct value
            </span>
          )}
        </>
      )}
    </Clause>
  );
}

// ---- Order By

const DIRECTIONS: Record<string, [string, string]> = {
  date: ["earliest first", "latest first"],
  datetime: ["oldest first", "newest first"],
  number: ["low to high", "high to low"],
  boolean: ["false first", "true first"],
};

function directionLabel(builder: QueryBuilder, s: Sort): string {
  const words =
    s.by.kind === "field"
      ? (DIRECTIONS[builder.typeOf(s.by.field)] ?? ["A–Z", "Z–A"])
      : ["ascending", "descending"];
  return s.desc ? words[1] : words[0];
}

/** A sort target as a select's value; an expression's text isn't part of it */
function choiceOf(by: SortBy): string {
  return by.kind === "expr" ? "expr" : JSON.stringify(by);
}

function byChoice(value: string): SortBy {
  return value === "expr" ? { kind: "expr", lua: "" } : JSON.parse(value);
}

/** What a sort can order by: fields and expressions, or while grouped the group keys and columns */
function sortChoices(
  builder: QueryBuilder,
  m: QueryModel,
): { by: SortBy; label: string }[] {
  if (!isGrouped(m)) {
    return [
      ...builder.offeredFields().map((f) => ({
        by: { kind: "field", field: f.name } as const,
        label: f.name,
      })),
      { by: { kind: "expr", lua: "" }, label: "Expression…" },
    ];
  }
  return [
    ...m.group.map((g) => ({
      by: { kind: "groupKey", field: g } as const,
      label: `${g} (group key)`,
    })),
    ...m.groupColumns.flatMap((c) =>
      c.kind === "agg"
        ? [
            {
              by: { kind: "column", id: c.id } as const,
              label: c.header || c.agg,
            },
          ]
        : [],
    ),
  ];
}

/** What a sort pill names: a field, an expression, a group key or a column */
function sortName(m: QueryModel, { by }: Sort): string {
  switch (by.kind) {
    case "field":
      return by.field;
    case "expr":
      return by.lua;
    case "groupKey":
      return `${by.field} (group key)`;
    case "column": {
      const c = m.groupColumns.find((x) => x.id === by.id);
      if (!c) return "(removed column)";
      return c.header || (c.kind === "agg" ? c.agg : c.field);
    }
  }
}

export function OrderByRow({ client, builder, model }: RowProps) {
  const [draft, setDraft] = useState<Sort | null>(null);
  const choices = sortChoices(builder, model);
  const update = (sorts: Sort[]) => builder.update((m) => ({ ...m, sorts }));
  const add = () => {
    if (!draft || (draft.by.kind === "expr" && !draft.by.lua.trim())) return;
    update([...model.sorts, draft]);
    setDraft(null);
  };

  return (
    <Clause label="Order By">
      {model.sorts.map((s, i) => (
        <Pill
          key={i}
          title="Flip direction"
          onClick={() =>
            update(
              model.sorts.map((x, j) =>
                j === i ? { ...x, desc: !x.desc } : x,
              ),
            )
          }
          removeLabel="Remove sort"
          onRemove={() => update(model.sorts.filter((_, j) => j !== i))}
        >
          <span
            className={s.by.kind === "expr" ? "sb-wbq-expr" : "sb-wbq-field"}
          >
            {sortName(model, s)}
          </span>
          <span className="sb-wbq-op">{directionLabel(builder, s)}</span>
          {s.nulls ? <span className="sb-wbq-op">nulls {s.nulls}</span> : null}
        </Pill>
      ))}
      {draft ? (
        <div className="sb-wbq-editor">
          <select
            className="sb-select"
            aria-label="Field"
            value={choiceOf(draft.by)}
            onChange={(e) =>
              setDraft({ ...draft, by: byChoice(e.currentTarget.value) })
            }
          >
            {choices.map((c) => (
              <option key={choiceOf(c.by)} value={choiceOf(c.by)}>
                {c.label}
              </option>
            ))}
          </select>
          {draft.by.kind === "expr" ? (
            <LuaLineInput
              client={client}
              label="Sort expression"
              initial={draft.by.lua}
              placeholder={`#${objectVar(model)}.tags`}
              autoFocus
              onChange={(lua) =>
                setDraft({ ...draft, by: { kind: "expr", lua } })
              }
              onEnter={add}
            />
          ) : null}
          <select
            className="sb-select"
            aria-label="Direction"
            value={draft.desc ? "desc" : "asc"}
            onChange={(e) =>
              setDraft({ ...draft, desc: e.currentTarget.value === "desc" })
            }
          >
            <option value="asc">
              {directionLabel(builder, { ...draft, desc: false })}
            </option>
            <option value="desc">
              {directionLabel(builder, { ...draft, desc: true })}
            </option>
          </select>
          <select
            className="sb-select"
            aria-label="Nulls"
            value={draft.nulls ?? ""}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setDraft({
                ...draft,
                nulls: v === "first" || v === "last" ? v : undefined,
              });
            }}
          >
            <option value="">nulls: default</option>
            <option value="first">nulls first</option>
            <option value="last">nulls last</option>
          </select>
          <span className="sb-wbq-spacer" />
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="primary" onClick={add}>
            Add
          </Button>
        </div>
      ) : (
        <AddButton
          onClick={() =>
            choices.length && setDraft({ by: choices[0].by, desc: false })
          }
        >
          + Order by
        </AddButton>
      )}
    </Clause>
  );
}

// ---- Limit

export function LimitRow({ builder, model }: RowProps) {
  return (
    <Clause label="Limit">
      <input
        className="sb-wbq-input sb-wbq-number"
        aria-label="Limit"
        type="number"
        min={1}
        placeholder="all"
        value={model.limit ?? ""}
        onInput={(e) => {
          const n = Number.parseInt(e.currentTarget.value, 10);
          builder.update((m) => ({
            ...m,
            limit: Number.isFinite(n) && n > 0 ? n : null,
          }));
        }}
      />
      <span className="sb-wbq-note">
        {isGrouped(model) ? "groups" : "results"}
      </span>
    </Clause>
  );
}
